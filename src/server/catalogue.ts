import { readFile } from "node:fs/promises";
import type { Book } from "../shared.js";
import type { Database } from "./db.js";
export type Search = {
  query?: string;
  category?: string;
  maxPriceCents?: number;
  inStockOnly?: boolean;
  limit?: number;
};
const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export class Catalogue {
  readonly books: Book[];
  constructor(
    books: Book[],
    private db: Database,
    private contact = "",
    private live = false,
  ) {
    this.books = books;
  }
  static async load(db: Database, contact = "", live = false) {
    const books = JSON.parse(
      await readFile(
        new URL("../../data/catalogue.json", import.meta.url),
        "utf8",
      ),
    ) as Book[];
    return new Catalogue(books, db, contact, live);
  }
  get(id: string) {
    return this.books.find((b) => b.id === id);
  }
  search(input: Search = {}): Book[] {
    const query = normalize(input.query || "");
    const tokens = query
      .split(" ")
      .filter(
        (t) =>
          t &&
          ![
            "a",
            "an",
            "the",
            "book",
            "books",
            "about",
            "by",
            "i",
            "want",
            "read",
            "something",
          ].includes(t),
      );
    return this.books
      .map((book) => {
        const title = normalize(book.title),
          author = normalize(book.authors.join(" "));
        const text = normalize(
          [
            book.title,
            ...book.authors,
            book.category,
            ...book.subjects,
            ...book.isbn,
          ].join(" "),
        );
        const score = !tokens.length
          ? 1
          : tokens.reduce(
              (n, t) =>
                n +
                (title.includes(t)
                  ? 5
                  : author.includes(t)
                    ? 4
                    : text.includes(t)
                      ? 1
                      : 0),
              0,
            ) + (query && title.includes(query) ? 10 : 0);
        return { book, score };
      })
      .filter(
        ({ book, score }) =>
          score > 0 &&
          (!input.category ||
            book.category.toLowerCase() === input.category.toLowerCase()) &&
          (input.maxPriceCents === undefined ||
            book.priceCents <= input.maxPriceCents) &&
          (!input.inStockOnly || book.stock > 0),
      )
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.book.stock - a.book.stock ||
          a.book.title.localeCompare(b.book.title),
      )
      .slice(0, Math.min(input.limit || 12, 24))
      .map((x) => x.book);
  }
  private nextRequest = 0;
  private liveQueue: Promise<unknown> = Promise.resolve();
  async searchLive(
    query: string,
  ): Promise<{ books: Book[]; warning?: string }> {
    if (!this.live || !query.trim()) return { books: [] };
    const key = normalize(query);
    const cached = await this.db.query<{ payload: Book[]; fresh: boolean }>(
      "SELECT payload, expires_at > NOW() AS fresh FROM catalogue_cache WHERE cache_key=$1",
      [key],
    );
    if (cached.rows[0]?.fresh) return { books: cached.rows[0].payload };
    const job = this.liveQueue.then(async () => {
      await new Promise((r) =>
        setTimeout(r, Math.max(0, this.nextRequest - Date.now())),
      );
      this.nextRequest = Date.now() + 1100;
      try {
        const url = new URL("https://openlibrary.org/search.json");
        url.search = new URLSearchParams({
          q: query,
          limit: "5",
          fields:
            "key,title,author_name,first_publish_year,editions,editions.key,editions.isbn,cover_i",
        }).toString();
        const response = await fetch(url, {
          headers: { "User-Agent": `BookshopAssistant (${this.contact})` },
          signal: AbortSignal.timeout(6000),
        });
        if (!response.ok) {
          if (response.status === 429) this.nextRequest = Date.now() + 10_000;
          throw new Error("Source unavailable");
        }
        const data = (await response.json()) as {
          docs?: Record<string, any>[];
        };
        const books: Book[] = (data.docs || [])
          .filter((b) =>
            /^\/books\/OL\d+M$/.test(b.editions?.docs?.[0]?.key || ""),
          )
          .map((b) => ({
            id: b.editions.docs[0].key.split("/").pop(),
            workId: b.key,
            title: String(b.title).slice(0, 300),
            authors: (b.author_name || []).slice(0, 5),
            category: "External result",
            subjects: [],
            isbn: b.editions.docs[0].isbn || [],
            year: b.first_publish_year,
            format: "unspecified",
            priceCents: 0,
            stock: 0,
            stocked: false,
            sourceUrl: `https://openlibrary.org${b.editions.docs[0].key}`,
            fetchedAt: new Date().toISOString(),
            coverId: b.cover_i,
          }));
        await this.db.query(
          "INSERT INTO catalogue_cache(cache_key,payload,expires_at) VALUES($1,$2,NOW()+INTERVAL '1 day') ON CONFLICT(cache_key) DO UPDATE SET payload=EXCLUDED.payload,expires_at=EXCLUDED.expires_at",
          [key, JSON.stringify(books)],
        );
        return { books };
      } catch {
        return {
          books: cached.rows[0]?.payload || [],
          warning:
            "Live book lookup is unavailable. Showing saved catalogue information.",
        };
      }
    });
    this.liveQueue = job.catch(() => undefined);
    return job;
  }
}
