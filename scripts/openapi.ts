import { writeFile } from "node:fs/promises";
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const str = { type: "string" },
  int = { type: "integer" },
  bool = { type: "boolean" };
const array = (items: unknown) => ({ type: "array", items });
const obj = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required });
const json = (schema: unknown) => ({ "application/json": { schema } });
const body = (schema: unknown) => ({ required: true, content: json(schema) });
const success = (schema: unknown, description = "Success") => ({
  description,
  content: json(schema),
});
const errors = Object.fromEntries(
  [400, 401, 403, 404, 409, 429, 503].map((n) => [
    String(n),
    success(
      ref("Error"),
      `HTTP ${n}: validation, session, conflict, rate limit or provider error`,
    ),
  ]),
);
const endpoint = (summary: string, schema: unknown, extras = {}) => ({
  summary,
  responses: { "200": success(schema), ...errors },
  ...extras,
});
const schemas = {
  Book: obj(
    {
      id: str,
      workId: str,
      title: str,
      authors: array(str),
      category: str,
      subjects: array(str),
      isbn: array(str),
      year: int,
      pages: int,
      format: { enum: ["paperback", "hardcover", "ebook", "unspecified"] },
      priceCents: int,
      stock: int,
      stocked: bool,
      sourceUrl: { type: "string", format: "uri" },
      fetchedAt: { type: "string", format: "date-time" },
      coverId: int,
      language: array(str),
      editionPublishDate: str,
      description: str,
      descriptionSourceUrl: { type: "string", format: "uri" },
      descriptionLevel: { enum: ["work", "edition"] },
      descriptionTruncated: bool,
      detailsFetchedAt: { type: "string", format: "date-time" },
      sourceKind: { enum: ["seed", "openlibrary"] },
      admissionFormat: {
        enum: ["paperback", "hardcover", "ebook", "unspecified"],
      },
      metadataWarning: str,
    },
    [
      "id",
      "workId",
      "title",
      "authors",
      "category",
      "subjects",
      "isbn",
      "format",
      "priceCents",
      "stock",
      "stocked",
      "sourceUrl",
      "fetchedAt",
    ],
  ),
  CartLine: obj({ book: ref("Book"), quantity: int, subtotalCents: int }),
  Cart: obj({
    lines: array(ref("CartLine")),
    totalCents: int,
    count: int,
    currency: { const: "USD" },
    version: int,
  }),
  Quote: obj({
    id: { type: "string", format: "uuid" },
    cart: ref("Cart"),
    expiresAt: { type: "string", format: "date-time" },
    label: str,
  }),
  Order: obj({
    id: str,
    quoteId: str,
    cart: ref("Cart"),
    createdAt: { type: "string", format: "date-time" },
    label: str,
  }),
  Message: obj({ role: { enum: ["user", "assistant"] }, content: str }),
  ChatResult: obj(
    {
      text: str,
      books: array(ref("Book")),
      cart: ref("Cart"),
      mode: { enum: ["ai", "offline"] },
      quote: ref("Quote"),
      order: ref("Order"),
      warning: str,
    },
    ["text", "books", "cart", "mode"],
  ),
  Error: obj({
    error: obj(
      { code: str, message: str, details: array({ type: "object" }) },
      ["code", "message"],
    ),
  }),
};
const paths = {
  "/api/health": {
    get: endpoint(
      "Service and database readiness",
      obj({ status: str, mode: str, catalogueCount: int }),
      { security: [] },
    ),
  },
  "/api/v1/config": {
    get: endpoint(
      "Public demo configuration",
      obj({
        storeName: str,
        mode: str,
        categories: array(str),
        simulated: bool,
        currency: str,
        liveSearch: bool,
      }),
      { security: [] },
    ),
  },
  "/api/v1/sessions": {
    post: endpoint(
      "Create or resume session; reset deletes the old session",
      obj({
        messages: array(ref("Message")),
        cart: ref("Cart"),
        mode: str,
        orders: array(ref("Order")),
      }),
      {
        security: [],
        requestBody: body(
          obj({ reset: { type: "boolean", default: false } }, []),
        ),
      },
    ),
  },
  "/api/v1/books": {
    get: endpoint(
      "Browse curated shelves or search saved records without an upstream request",
      obj({ books: array(ref("Book")), warning: str }, ["books"]),
      {
        parameters: Object.entries({
          query: str,
          category: str,
          maxPriceCents: { type: "integer", minimum: 0 },
          inStockOnly: { type: "string", enum: ["true", "false"] },
          limit: { type: "integer", minimum: 1, maximum: 24, default: 12 },
        }).map(([name, schema]) => ({ name, in: "query", schema })),
      },
    ),
  },
  "/api/v1/discover": {
    get: endpoint(
      "Search saved records and live Open Library; validated editions receive fictional demo offers",
      obj(
        { books: array(ref("Book")), page: int, nextPage: int, warning: str },
        ["books", "page"],
      ),
      {
        parameters: [
          {
            in: "query",
            name: "query",
            required: true,
            schema: { type: "string", minLength: 2, maxLength: 200 },
          },
          {
            in: "query",
            name: "kind",
            schema: {
              enum: ["all", "title", "author", "topic"],
              default: "all",
            },
          },
          {
            in: "query",
            name: "page",
            schema: { type: "integer", minimum: 1, maximum: 20, default: 1 },
          },
          {
            in: "query",
            name: "maxPriceCents",
            schema: { type: "integer", minimum: 0 },
          },
        ],
      },
    ),
  },
  "/api/v1/books/{id}": {
    get: endpoint("Read a seeded edition", ref("Book"), {
      parameters: [
        {
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", pattern: "^OL[0-9]+M$" },
        },
      ],
    }),
  },
  "/api/v1/cart": {
    get: endpoint("Read the authoritative basket", ref("Cart")),
    patch: endpoint(
      "Set absolute edition quantity; zero removes; invalidates quotes",
      ref("Cart"),
      {
        requestBody: body(
          obj({
            bookId: str,
            quantity: { type: "integer", minimum: 0, maximum: 5 },
          }),
        ),
      },
    ),
  },
  "/api/v1/quotes": {
    post: endpoint(
      "Create a quote valid for ten minutes; does not place an order",
      ref("Quote"),
      { requestBody: body(obj({})) },
    ),
  },
  "/api/v1/orders/confirm": {
    post: endpoint(
      "Explicitly confirm a quote; retry-safe for quote and idempotency key",
      ref("Order"),
      {
        requestBody: body(
          obj({
            quoteId: { type: "string", format: "uuid" },
            idempotencyKey: { type: "string", minLength: 8, maxLength: 120 },
            confirmed: { const: true },
          }),
        ),
      },
    ),
  },
  "/api/v1/orders": {
    get: endpoint(
      "List only the current session’s orders",
      array(ref("Order")),
    ),
  },
  "/api/v1/chat": {
    post: {
      ...endpoint(
        "Converse with the bookseller; exact “confirm order” confirms the active quote",
        ref("ChatResult"),
      ),
      requestBody: body(
        obj(
          {
            message: { type: "string", minLength: 1, maxLength: 2000 },
            stream: { type: "boolean", default: false },
          },
          ["message"],
        ),
      ),
      responses: {
        "200": {
          description:
            "JSON, or SSE when stream=true. Events: status {text}, result ChatResult, error {code,message}. A stream can return an error after HTTP 200. Progress and final result are streamed; model tokens are buffered until tool execution completes.",
          content: {
            ...json(ref("ChatResult")),
            "text/event-stream": { schema: str },
          },
        },
        ...errors,
      },
    },
  },
};
await writeFile(
  new URL("../docs/openapi.json", import.meta.url),
  JSON.stringify(
    {
      openapi: "3.1.0",
      info: {
        title: "Between the Lines bookstore API",
        version: "1.0.0",
        description:
          "Simulated commerce only. Same-origin HttpOnly sessions. Money is integer USD cents. Send application/json for mutations. Hosted in one instance.",
      },
      servers: [{ url: "/" }],
      security: [{ sessionCookie: [] }],
      paths,
      components: {
        securitySchemes: {
          sessionCookie: {
            type: "apiKey",
            in: "cookie",
            name: "bookshop_session",
          },
        },
        schemas,
      },
    },
    null,
    2,
  ) + "\n",
);
