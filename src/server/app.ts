import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { createDatabase, type Database } from "./db.js";
import { Catalogue } from "./catalogue.js";
import { Store, AppError, policy } from "./store.js";
import { Agent, type ModelClient } from "./agent.js";
import type { Config } from "./config.js";
const id = z.string().uuid();
export async function buildApp(
  config: Config,
  options: { db?: Database; modelClient?: ModelClient; logger?: boolean } = {},
) {
  const db =
    options.db ||
    (await createDatabase(config.DATABASE_URL, config.LOCAL_DB_PATH));
  const catalogue = await Catalogue.load(
    db,
    config.OPEN_LIBRARY_CONTACT,
    config.LIVE_BOOK_SEARCH === "true",
  );
  const store = new Store(db, catalogue);
  const app = Fastify({
    logger: options.logger
      ? {
          redact: ["req.headers.cookie", "req.headers.authorization"],
          serializers: {
            req: (req) => ({ method: req.method, url: req.url?.split("?")[0] }),
          },
        }
      : false,
    bodyLimit: 16_384,
    trustProxy:
      config.NODE_ENV === "production" ? (_address, hop) => hop === 0 : false,
  });
  const agent = new Agent(store, config, options.modelClient, (usage) =>
    app.log.info(usage, "Model usage"),
  );
  await app.register(cookie);
  await app.register(rateLimit, { max: 90, timeWindow: "1 minute" });
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Frame-Options", "DENY");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' https://covers.openlibrary.org data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    if (req.url.startsWith("/api")) reply.header("Cache-Control", "no-store");
    if (["POST", "PATCH", "DELETE"].includes(req.method)) {
      if (req.headers.origin && req.headers.origin !== config.PUBLIC_ORIGIN)
        throw new AppError(
          403,
          "ORIGIN",
          "This request is not from the bookshop.",
        );
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw new AppError(415, "CONTENT_TYPE", "Send JSON requests.");
    }
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        error: {
          code: "VALIDATION",
          message: "Some request fields are invalid.",
          details: error.issues.map((i) => ({
            path: i.path,
            message: i.message,
          })),
        },
      });
    if (error instanceof AppError)
      return reply
        .code(error.status)
        .send({ error: { code: error.code, message: error.message } });
    const e = error as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500)
      return reply
        .code(e.statusCode)
        .send({ error: { code: "REQUEST_ERROR", message: e.message } });
    app.log.error({ code: "INTERNAL_ERROR" }, "Request failed");
    return reply.code(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong. Please try again.",
      },
    });
  });
  const session = (req: { cookies: Record<string, string | undefined> }) =>
    store.authenticate(req.cookies.bookshop_session);
  const busy = new Set<string>();
  async function exclusive<T>(sessionId: string, work: () => Promise<T>) {
    if (busy.has(sessionId))
      throw new AppError(
        409,
        "SESSION_BUSY",
        "Please wait for your current request to finish.",
      );
    busy.add(sessionId);
    try {
      return await work();
    } finally {
      busy.delete(sessionId);
    }
  }
  app.get("/api/health", async () => {
    await db.query("SELECT 1");
    return {
      status: "ok",
      mode: agent.mode,
      catalogueCount: catalogue.books.length,
    };
  });
  app.get("/api/v1/config", async () => ({
    storeName: policy.storeName,
    mode: agent.mode,
    categories: [...new Set(catalogue.books.map((b) => b.category))],
    simulated: true,
    currency: "USD",
    liveSearch: config.LIVE_BOOK_SEARCH === "true",
  }));
  app.post(
    "/api/v1/sessions",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { reset } = z
        .object({ reset: z.boolean().default(false) })
        .parse(req.body || {});
      if (!reset) {
        try {
          const existing = await session(req);
          return {
            messages: existing.messages,
            cart: store.cart(existing),
            mode: agent.mode,
            orders: await store.orders(existing.id),
          };
        } catch (e) {
          if (!(e instanceof AppError && e.status === 401)) throw e;
        }
      }
      if (reset && req.cookies.bookshop_session) {
        try {
          const existing = await session(req);
          await exclusive(existing.id, () =>
            db.query("DELETE FROM sessions WHERE id=$1", [existing.id]),
          );
        } catch (e) {
          if (!(e instanceof AppError && e.status === 401)) throw e;
        }
      }
      const result = await store.createSession();
      reply.setCookie("bookshop_session", result.token, {
        httpOnly: true,
        sameSite: "strict",
        secure: config.NODE_ENV === "production",
        path: "/",
        maxAge: 7 * 24 * 60 * 60,
      });
      return {
        messages: [],
        cart: store.cart(result.state),
        mode: agent.mode,
        orders: [],
      };
    },
  );
  app.get("/api/v1/books", async (req) => {
    const input = z
      .object({
        query: z.string().max(200).optional(),
        category: z.string().max(50).optional(),
        maxPriceCents: z.coerce.number().int().nonnegative().optional(),
        inStockOnly: z.enum(["true", "false"]).optional(),
        limit: z.coerce.number().int().min(1).max(24).default(12),
      })
      .parse(req.query);
    const state = await session(req);
    let books = catalogue.search({
      ...input,
      inStockOnly: input.inStockOnly === "true",
    });
    const warning: string | undefined = undefined;
    return {
      books: books.map((b) => ({
        ...b,
        stock: b.stocked ? store.available(state, b.id) : 0,
      })),
      warning,
    };
  });
  app.get(
    "/api/v1/discover",
    { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } },
    async (req) => {
      const input = z
        .object({
          query: z.string().trim().min(2).max(200),
          kind: z.enum(["all", "title", "author", "topic"]).default("all"),
          page: z.coerce.number().int().min(1).max(20).default(1),
          maxPriceCents: z.coerce.number().int().nonnegative().optional(),
        })
        .parse(req.query);
      const state = await session(req);
      const result = await catalogue.discover(input);
      return {
        ...result,
        books: result.books.map((b) => ({
          ...b,
          stock: b.stocked ? store.available(state, b.id) : 0,
        })),
      };
    },
  );
  app.get("/api/v1/books/:id", async (req) => {
    const state = await session(req);
    const { id } = z
      .object({ id: z.string().regex(/^OL\d+[MW]$/) })
      .parse(req.params);
    const book = await catalogue.details(id);
    if (!book) throw new AppError(404, "NOT_FOUND", "Edition not found.");
    return { ...book, stock: store.available(state, id) };
  });
  app.get("/api/v1/cart", async (req) => store.cart(await session(req)));
  app.patch("/api/v1/cart", async (req) => {
    const input = z
      .object({
        bookId: z.string().regex(/^OL\d+M$/),
        quantity: z.number().int().min(0).max(5),
      })
      .parse(req.body);
    const state = await session(req);
    return exclusive(state.id, () =>
      store.updateCart(state.id, input.bookId, input.quantity),
    );
  });
  app.post("/api/v1/quotes", async (req) => {
    const state = await session(req);
    return exclusive(state.id, () => store.quote(state.id));
  });
  app.post("/api/v1/orders/confirm", async (req) => {
    const input = z
      .object({
        quoteId: id,
        idempotencyKey: z.string().min(8).max(120),
        confirmed: z.literal(true),
      })
      .parse(req.body);
    const state = await session(req);
    return exclusive(state.id, () =>
      store.confirm(state.id, input.quoteId, input.idempotencyKey),
    );
  });
  app.get("/api/v1/orders", async (req) =>
    store.orders((await session(req)).id),
  );
  app.post(
    "/api/v1/chat",
    { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const { message, stream } = z
        .object({
          message: z.string().trim().min(1).max(2000),
          stream: z.boolean().default(false),
        })
        .parse(req.body);
      const state = await session(req);
      return exclusive(state.id, async () => {
        const start = Date.now();
        if (!stream) return agent.chat(state.id, message);
        reply.hijack();
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
          "X-Content-Type-Options": "nosniff",
        });
        const emit = (event: string, data: unknown) => {
          if (!reply.raw.destroyed)
            reply.raw.write(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            );
        };
        try {
          const result = await agent.chat(state.id, message, (text) =>
            emit("status", { text }),
          );
          emit("result", result);
        } catch (e) {
          emit("error", {
            code: e instanceof AppError ? e.code : "CHAT_ERROR",
            message:
              e instanceof AppError
                ? e.message
                : "The bookseller could not complete this request. Please try again.",
          });
        } finally {
          app.log.info(
            { latencyMs: Date.now() - start, mode: agent.mode },
            "Chat completed",
          );
          reply.raw.end();
        }
      });
    },
  );
  app.get("/api/openapi.json", async (_req, reply) =>
    reply
      .type("application/json")
      .send(
        await readFile(
          new URL("../../docs/openapi.json", import.meta.url),
          "utf8",
        ),
      ),
  );
  const staticRoot = resolve("dist/client");
  if (existsSync(staticRoot)) {
    await app.register(staticFiles, {
      root: staticRoot,
      prefix: "/",
      index: "index.html",
      list: false,
    });
  } else
    app.get("/", async (_req, reply) =>
      reply
        .type("text/plain")
        .send(
          "Bookshop API is running. Run npm run build for the UI, or npm run dev:ui for the Vite development server.",
        ),
    );
  await store.cleanup();
  const cleanup = setInterval(() => {
    store.cleanup().catch(() => app.log.error("Session cleanup failed"));
  }, 60 * 60_000);
  cleanup.unref();
  app.addHook("onClose", async () => {
    clearInterval(cleanup);
    if (!options.db) await db.close();
  });
  return { app, db, store, catalogue, agent };
}
