import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createDatabase, type Database } from "../src/server/db.js";
import { Catalogue } from "../src/server/catalogue.js";
import { OpenLibrary, matchesISBN } from "../src/server/open-library.js";
import { Store } from "../src/server/store.js";
import { buildApp } from "../src/server/app.js";
import { config } from "../src/server/config.js";
let db: Database, catalogue: Catalogue, mock: ReturnType<typeof vi.spyOn>;
const docs = (suffix = 1) => ({
  numFound: 25,
  docs: [
    {
      key: `/works/OL${800 + suffix}W`,
      title: `Remote Book ${suffix}`,
      author_name: ["Source Author"],
      subject: ["Astronomy"],
      first_publish_year: 2001,
      editions: {
        docs: [
          {
            key: `/books/OL${800 + suffix}M`,
            title: `Remote Book ${suffix}`,
            language: ["eng"],
          },
        ],
      },
    },
  ],
});
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
beforeEach(async () => {
  db = await createDatabase();
  mock = vi.spyOn(globalThis, "fetch");
  catalogue = await Catalogue.load(db, "test@example.com", true);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.close();
});
describe("Open Library discovery and durable offers", () => {
  it("searches remotely despite local matches, merges results and retains curated shelves", async () => {
    mock.mockResolvedValue(response(docs()));
    const result = await catalogue.discover({ query: "Meditations" });
    expect(mock).toHaveBeenCalledOnce();
    expect(result.books.some((b) => b.title === "Meditations")).toBe(true);
    expect(result.books.some((b) => b.id === "OL801M")).toBe(true);
    expect(catalogue.books).toHaveLength(97);
    expect(result.nextPage).toBe(2);
  });
  it("persists imported books and supports basket/quote/order after a repository restart", async () => {
    mock.mockResolvedValue(response(docs()));
    const book = (await catalogue.discover({ query: "remote" })).books[0];
    const first = new Store(db, catalogue);
    const s = await first.createSession();
    await first.updateCart(s.state.id, book.id, 1);
    const quote = await first.quote(s.state.id);
    const second = new Store(
      db,
      await Catalogue.load(db, "test@example.com", true),
    );
    expect(second.cart(await second.state(s.state.id)).totalCents).toBe(1299);
    const order = await second.confirm(s.state.id, quote.id, "restart-order");
    expect(order.cart.lines[0].book.id).toBe(book.id);
  });
  it("keeps work-only and authorless records discovery-only", async () => {
    mock.mockResolvedValue(
      response({
        numFound: 2,
        docs: [
          { key: "/works/OL801W", title: "Work only", author_name: ["Author"] },
          { ...docs(2).docs[0], author_name: [] },
        ],
      }),
    );
    const result = await catalogue.discover({ query: "missing" });
    expect(result.books).toHaveLength(2);
    expect(
      result.books.every(
        (b) => !b.stocked && b.priceCents === 0 && b.stock === 0,
      ),
    ).toBe(true);
    const store = new Store(db, catalogue),
      s = await store.createSession();
    await expect(
      store.updateCart(s.state.id, result.books[0].id, 1),
    ).rejects.toMatchObject({ code: "BOOK_NOT_STOCKED" });
  });
  it("freezes price when format and metadata are enriched and keeps work/edition fields separate", async () => {
    mock.mockImplementation(async (url: any) => {
      if (String(url).includes("search.json")) return response(docs());
      if (String(url).includes("/books/"))
        return response({
          key: "/books/OL801M",
          title: "Remote Book 1",
          physical_format: "hardcover",
          number_of_pages: 456,
          isbn_13: ["9780060512750"],
          publish_date: "2019",
          works: [{ key: "/works/OL801W" }],
          languages: [{ key: "/languages/eng" }],
        });
      return response({
        description: { value: "A description from the source." },
        subjects: ["Astronomy"],
      });
    });
    const book = (await catalogue.discover({ query: "remote" })).books[0];
    const detail = await catalogue.details(book.id);
    expect(detail).toMatchObject({
      format: "hardcover",
      priceCents: 1299,
      admissionFormat: "unspecified",
      pages: 456,
      year: 2001,
      editionPublishDate: "2019",
      descriptionLevel: "work",
      descriptionSourceUrl: "https://openlibrary.org/works/OL801W",
    });
    const oldCalls = mock.mock.calls.length;
    await catalogue.details(book.id);
    expect(mock.mock.calls).toHaveLength(oldCalls);
  });
  it("uses exact ISBN lookup and refuses a different edition", async () => {
    mock.mockImplementation(async (url: any) =>
      String(url).includes("/isbn/")
        ? response({
            key: "/books/OL999M",
            title: "Wrong edition",
            isbn_13: ["9780140449334"],
          })
        : response({}),
    );
    expect(
      (await catalogue.discover({ query: "9780060512750" })).books,
    ).toEqual([]);
    expect(String(mock.mock.calls[0][0])).toContain("/isbn/9780060512750.json");
  });
  it("verifies exact ISBN, retrieves author names and prices the first admitted format", async () => {
    mock.mockImplementation(async (url: any) => {
      if (String(url).includes("/isbn/"))
        return response({
          key: "/books/OL999M",
          title: "ISBN edition",
          isbn_10: ["006051275X"],
          physical_format: "hardcover",
          authors: [{ key: "/authors/OL1A" }],
        });
      return response({ name: "Verified Author" });
    });
    const result = await catalogue.discover({ query: "9780060512750" });
    expect(result.books[0]).toMatchObject({
      id: "OL999M",
      priceCents: 2299,
      stocked: true,
      authors: ["Verified Author"],
    });
  });
  it("finds a saved ISBN-10 by its equivalent ISBN-13 offline", () => {
    const book = catalogue.books[0];
    const saved = new Catalogue([{ ...book, isbn: ["006051275X"] }], db);
    expect(saved.search({ query: "9780060512750" })[0]?.id).toBe(book.id);
  });
  it("coalesces simultaneous searches and serves a 24-hour cache", async () => {
    mock.mockImplementation(async () => response(docs()));
    const results = await Promise.all([
      catalogue.discover({ query: "same" }),
      catalogue.discover({ query: "same" }),
    ]);
    expect(results[0].books[0].id).toBe(results[1].books[0].id);
    expect(mock).toHaveBeenCalledOnce();
    await catalogue.discover({ query: "same" });
    expect(mock).toHaveBeenCalledOnce();
  });
  it("uses stale search results during an outage and keeps budget filtering", async () => {
    mock.mockImplementation(async () => response(docs()));
    await catalogue.discover({ query: "cached" });
    await db.query(
      "UPDATE catalogue_cache SET expires_at=NOW()-INTERVAL '1 day'",
    );
    mock.mockRejectedValue(new Error("offline"));
    const result = await catalogue.discover({ query: "cached" });
    expect(result.books.some((b) => b.id === "OL801M")).toBe(true);
    expect(result.warning).toContain("unavailable");
    const cheap = await catalogue.discover({
      query: "cached",
      maxPriceCents: 100,
    });
    expect(cheap.books).toEqual([]);
  });
  it("paginates remote search without repeating local matches", async () => {
    mock.mockImplementation(async (url: any) =>
      response(
        docs(new URL(String(url)).searchParams.get("offset") === "12" ? 2 : 1),
      ),
    );
    const first = await catalogue.discover({ query: "new" });
    const second = await catalogue.discover({
      query: "new",
      page: first.nextPage,
    });
    expect(second.books[0].id).toBe("OL802M");
    expect(second.books.map((b) => b.id)).not.toContain(first.books[0].id);
  });
  it("preserves unknown details and tolerates malformed optional metadata", async () => {
    mock.mockImplementation(async (url: any) =>
      String(url).includes("search.json")
        ? response(docs())
        : response({
            key: "/books/OL801M",
            title: "Remote Book 1",
            languages: { bad: true },
            isbn_13: null,
          }),
    );
    const book = (await catalogue.discover({ query: "new" })).books[0];
    const detail = await catalogue.details(book.id);
    expect(detail?.description).toBeUndefined();
    expect(detail?.pages).toBeUndefined();
    expect(detail?.format).toBe("unspecified");
  });
  it("paces upstream calls at no more than one per second", async () => {
    const times: number[] = [];
    const client = new OpenLibrary(db, "test@example.com", async () => {
      times.push(Date.now());
      return response({});
    });
    await Promise.all([
      client.get("/works/OL1W.json", 7),
      client.get("/works/OL2W.json", 7),
    ]);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(990);
  });
  it("validates discovery pagination and authenticates the public endpoint", async () => {
    const ctx = await buildApp(
      {
        ...config,
        ANTHROPIC_API_KEY: "",
        LIVE_BOOK_SEARCH: "false",
        NODE_ENV: "test",
      },
      { db },
    );
    expect(
      (await ctx.app.inject("/api/v1/discover?query=hello")).statusCode,
    ).toBe(401);
    const session = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/sessions",
      payload: {},
    });
    const cookies = { bookshop_session: session.cookies[0].value };
    expect(
      (
        await ctx.app.inject({
          url: "/api/v1/discover?query=hello&page=999",
          cookies,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await ctx.app.inject({
          url: "/api/v1/discover?query=Meditations",
          cookies,
        })
      ).json().books.length,
    ).toBeGreaterThan(0);
    await ctx.app.close();
  });
});

it("matches valid ISBN-10/13 equivalents without accepting wrong checksums or editions", () => {
  expect(matchesISBN(["006051275X"], "9780060512750")).toBe(true);
  expect(matchesISBN(["9780060512750"], "006051275X")).toBe(true);
  expect(matchesISBN(["0060512751"], "9780060512750")).toBe(false);
  expect(matchesISBN(["9780140449334"], "9780060512750")).toBe(false);
});

it("keeps author searches from matching author names in titles", async () => {
  const book = catalogue.books[0];
  const saved = new Catalogue(
    [
      {
        ...book,
        title: "Ursula K. Le Guin study guide",
        authors: ["Different Author"],
      },
    ],
    db,
  );
  expect(saved.search({ query: "Ursula K. Le Guin", kind: "author" })).toEqual(
    [],
  );
  expect(
    saved.search({ query: "Ursula K. Le Guin", kind: "title" }),
  ).toHaveLength(1);
});
