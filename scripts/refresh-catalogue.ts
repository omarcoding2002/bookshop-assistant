import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import type { Book } from "../src/shared.js";
const groups = [
  ["Classics", "subject:classics"],
  ["Fantasy", "subject:fantasy"],
  ["Mystery", "subject:mystery"],
  ["Science fiction", "subject:science_fiction"],
  ["Romance", "subject:romance"],
  ["Children", "subject:juvenile_fiction"],
  ["Young adult", "subject:young_adult_fiction"],
  ["History", "subject:history"],
  ["Science", "subject:science"],
  ["Personal growth", "subject:self-help"],
] as const;
const pause = () => new Promise((r) => setTimeout(r, 1100));
const headers = `BookshopAssistantPrototype (${process.env.OPEN_LIBRARY_CONTACT || "one-time low-volume development import"})`;
function get(url: string) {
  // curl also supports environments where Node does not inherit the corporate network configuration.
  return JSON.parse(
    execFileSync(
      "curl",
      ["--fail", "--retry", "2", "--max-time", "35", "-sS", "-A", headers, url],
      { maxBuffer: 8_000_000 },
    ).toString(),
  );
}
const books: Book[] = [];
for (const [category, q] of groups) {
  const url = new URL("https://openlibrary.org/search.json");
  url.search = new URLSearchParams({
    q: `${q} language:eng`,
    limit: "16",
    fields:
      "key,title,author_name,first_publish_year,cover_i,subject,editions,editions.key,editions.title,editions.isbn,editions.language",
  }).toString();
  const response = get(url.toString());
  let count = 0;
  for (const item of response.docs) {
    const edition = item.editions?.docs?.[0];
    if (
      !edition?.key ||
      !item.author_name?.length ||
      books.some((b) => b.workId === item.key)
    )
      continue;
    const id = edition.key.split("/").pop();
    books.push({
      id,
      workId: item.key,
      title: edition.title || item.title,
      authors: item.author_name,
      category,
      subjects: (item.subject || []).slice(0, 18),
      isbn: edition.isbn || [],
      year: item.first_publish_year,
      format: "unspecified",
      priceCents: 1299,
      stock: books.length % 13 === 12 ? 0 : 5,
      stocked: true,
      sourceUrl: `https://openlibrary.org/books/${id}`,
      fetchedAt: new Date().toISOString(),
      coverId: item.cover_i,
    });
    if (++count === 10) break;
  }
  console.log(`${category}: ${count} editions`);
  await pause();
}
// Correct broad source subject classifications with documented editorial shelving.
for (const book of books) {
  if (["The Summer I Turned Pretty", "The darkest minds"].includes(book.title))
    book.category = "Young adult";
  if (
    [
      "I Have No Mouth and I Must Scream",
      "Altered carbon",
      "2001",
      "Project Hail Mary",
      "God Emperor of Dune",
    ].includes(book.title)
  )
    book.category = "Science fiction";
}
// Enrich a small sample; batch search doesn't expose verified physical formats.
for (const book of books.filter((_, i) => i % 7 === 0)) {
  const detail = get(`${book.sourceUrl}.json`);
  const format = String(detail.physical_format || "").toLowerCase();
  book.format = /paperback|softcover/.test(format)
    ? "paperback"
    : /hardcover|hardback/.test(format)
      ? "hardcover"
      : /ebook|e-book|electronic/.test(format)
        ? "ebook"
        : "unspecified";
  book.priceCents =
    book.format === "hardcover" ? 2299 : book.format === "ebook" ? 799 : 1299;
  book.pages = detail.number_of_pages;
  await pause();
}
if (books.length < 80)
  throw new Error(
    `Only ${books.length} books fetched; refusing to replace catalogue.`,
  );
await writeFile(
  new URL("../data/catalogue.json", import.meta.url),
  JSON.stringify(books, null, 2) + "\n",
);
console.log(
  `Saved ${books.length} source-backed edition records. Unknown formats remain unspecified.`,
);
