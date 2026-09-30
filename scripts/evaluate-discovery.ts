import { readFile, writeFile } from "node:fs/promises";
import type { Book, DiscoveryResult, Quote, Order } from "../src/shared.js";
const base = process.env.EVAL_BASE_URL || "http://localhost:3002";
const seed = new Set(
  (JSON.parse(await readFile("data/catalogue.json", "utf8")) as Book[]).map(
    (b) => b.id,
  ),
);
const session = await fetch(`${base}/api/v1/sessions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: "{}",
});
if (!session.ok) throw new Error(`Session HTTP ${session.status}`);
const cookie = session.headers.get("set-cookie")!.split(";")[0];
async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} at ${path.split("?")[0]}`);
  return r.json() as Promise<T>;
}
const config = await request<{ liveSearch: boolean }>("/config");
if (!config.liveSearch)
  throw new Error("Live discovery must be enabled on the test server");
const results: { query: string; book: Book; passed: boolean }[] = [];
for (const query of ["The Dispossessed", "Piranesi", "A Wizard of Earthsea"]) {
  const found = await request<DiscoveryResult>(
    `/discover?${new URLSearchParams({ query, kind: "title" })}`,
  );
  const book = found.books.find(
    (b) =>
      !seed.has(b.id) &&
      b.stocked &&
      b.title.toLowerCase().includes(query.toLowerCase()),
  );
  if (!book)
    throw new Error(
      `No new validated edition for ${query}; source warning: ${found.warning || "none"}`,
    );
  const details = await request<Book>(`/books/${book.id}`);
  results.push({
    query,
    book: details,
    passed: details.id === book.id && details.priceCents === book.priceCents,
  });
  console.log(`PASS external title ${query}`);
}
const withISBN = results.find((r) => r.book.isbn.length)?.book;
if (!withISBN)
  throw new Error("No ISBN available for exact-lookup verification");
const isbn = withISBN.isbn[0];
const exact = await request<DiscoveryResult>(`/discover?query=${isbn}`);
const exactPassed =
  exact.books.length === 1 && exact.books[0].isbn.includes(isbn);
if (!exactPassed) throw new Error("Exact ISBN not preserved");
const first = await request<DiscoveryResult>(
  `/discover?query=${encodeURIComponent("Ursula K. Le Guin")}&kind=author`,
);
if (!first.nextPage) throw new Error("Expected pagination for author search");
const next = await request<DiscoveryResult>(
  `/discover?query=${encodeURIComponent("Ursula K. Le Guin")}&kind=author&page=${first.nextPage}`,
);
const book = results[0].book;
await request("/cart", "PATCH", { bookId: book.id, quantity: 1 });
const quote = await request<Quote>("/quotes", "POST", {});
const order = await request<Order>("/orders/confirm", "POST", {
  quoteId: quote.id,
  idempotencyKey: `discovery-${quote.id}`,
  confirmed: true,
});
if (order.cart.lines[0].book.id !== book.id)
  throw new Error("Wrong edition ordered");
// Anonymous synthetic session only; ignored and private. Used for post-deployment persistence verification.
await writeFile(
  ".data/discovery-session.json",
  JSON.stringify({ cookie, orderId: order.id, bookId: book.id, base }),
  { mode: 0o600 },
);
const report = {
  executedAt: new Date().toISOString(),
  baseUrl: base,
  paidModelCalls: 0,
  passed:
    results.every((r) => r.passed) && exactPassed && next.books.length > 0,
  exactISBN: isbn,
  exactEdition: exact.books[0].id,
  descriptionCount: results.filter((r) => r.book.description).length,
  pagination: { firstCount: first.books.length, nextCount: next.books.length },
  orderId: order.id,
  results,
};
await writeFile(
  "docs/discovery-live.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    passed: report.passed,
    descriptionCount: report.descriptionCount,
    pagination: report.pagination,
    orderConfirmed: true,
  }),
);
if (!report.passed) process.exitCode = 1;
