import { readFile } from "node:fs/promises";
import type { Book, DiscoveryResult } from "../shared.js";
import type { Database } from "./db.js";
import {
  OpenLibrary,
  SOURCE_WARNING,
  text,
  strings,
  isbnQuery,
  matchesISBN,
  bookFormat,
  demoPrice,
} from "./open-library.js";
export type Search = {
  kind?: "all" | "title" | "author" | "topic";
  page?: number;
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
  private records = new Map<string, Book>();
  private source: OpenLibrary;
  constructor(
    books: Book[],
    private db: Database,
    private contact = "",
    private live = false,
  ) {
    this.books = books;
    books.forEach((b) => this.records.set(b.id, { ...b, sourceKind: "seed" }));
    this.source = new OpenLibrary(db, contact);
  }
  static async load(db: Database, contact = "", live = false) {
    const books = JSON.parse(
      await readFile(
        new URL("../../data/catalogue.json", import.meta.url),
        "utf8",
      ),
    ) as Book[];
    const catalogue = new Catalogue(books, db, contact, live);
    const saved = await db.query<{ payload: Book }>(
      "SELECT payload FROM catalogue_editions",
    );
    saved.rows.forEach((row) =>
      catalogue.records.set(row.payload.id, row.payload),
    );
    return catalogue;
  }
  get(id: string) {
    return this.records.get(id);
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
    const isbn = isbnQuery(input.query || "");
    return (
      input.query
        ? [...this.records.values()]
        : this.books.map((b) => this.get(b.id)!)
    )
      .filter((b) => !isbn || matchesISBN(b.isbn, isbn))
      .filter((b) => {
        if (!query || !input.kind || input.kind === "all" || isbn) return true;
        const field =
          input.kind === "author"
            ? b.authors.join(" ")
            : input.kind === "title"
              ? b.title
              : [b.category, ...b.subjects].join(" ");
        const normalized = normalize(field);
        return tokens.every((token) => normalized.includes(token));
      })
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
        const score =
          isbn || !tokens.length
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
  private async save(book: Book): Promise<Book> {
    const old = this.get(book.id);
    const saved = old?.stocked
      ? {
          ...book,
          priceCents: old.priceCents,
          stock: old.stock,
          stocked: true,
          admissionFormat: old.admissionFormat || old.format,
        }
      : book;
    const result = await this.db.query<{ payload: Book }>(
      `INSERT INTO catalogue_editions(id,payload) VALUES($1,$2)
      ON CONFLICT(id) DO UPDATE SET payload = CASE WHEN (catalogue_editions.payload->>'stocked')::boolean THEN
      EXCLUDED.payload || jsonb_build_object('priceCents',catalogue_editions.payload->'priceCents','stock',catalogue_editions.payload->'stock','stocked',true,'admissionFormat',COALESCE(catalogue_editions.payload->'admissionFormat',catalogue_editions.payload->'format')) ELSE EXCLUDED.payload END RETURNING payload`,
      [book.id, JSON.stringify(saved)],
    );
    const value = result.rows[0].payload;
    this.records.set(value.id, value);
    return value;
  }
  private eligible(input: Search, book: Book) {
    return (
      (input.maxPriceCents === undefined ||
        (book.stocked && book.priceCents <= input.maxPriceCents)) &&
      (!input.inStockOnly || (book.stocked && book.stock > 0))
    );
  }
  async discover(input: Search): Promise<DiscoveryResult> {
    const page = input.page || 1;
    const query = (input.query || input.category || "").trim();
    const local = page === 1 ? this.search({ ...input, query, limit: 12 }) : [];
    if (!this.live || !query) return { books: local, page };
    const isbn = isbnQuery(query);
    if (isbn) {
      if (page > 1) return { books: [], page };
      const result = await this.source.get(`/isbn/${isbn}.json`, 7);
      if (!result.data || result.data.notFound)
        return {
          books: local.filter((b) => matchesISBN(b.isbn, isbn)),
          page,
          warning: result.warning,
        };
      const book = await this.fromEdition(result.data, undefined);
      // An ISBN request can never silently select another edition.
      if (!book || !matchesISBN(book.isbn, isbn))
        return {
          books: [],
          page,
          warning:
            result.warning ||
            "The requested ISBN could not be verified for this edition.",
        };
      return {
        books: this.eligible(input, book) ? [book] : [],
        page,
        warning: result.warning || book.metadataWarning,
      };
    }
    const params = new URLSearchParams({
      limit: "12",
      offset: String((page - 1) * 12),
      lang: "en",
      fields:
        "key,title,author_name,first_publish_year,subject,cover_i,editions,editions.key,editions.title,editions.language",
    });
    if (input.kind === "title") params.set("title", query);
    else if (input.kind === "author") params.set("author", query);
    else if (input.kind === "topic") params.set("subject", query);
    else params.set("q", query);
    // Explicit ISBN lookup above is not silently language-filtered.
    params.set(
      "q",
      [params.get("q"), "language:eng"].filter(Boolean).join(" "),
    );
    const result = await this.source.get(`/search.json?${params}`, 1);
    const data = result.data;
    if (!data || !Array.isArray(data.docs))
      return { books: local, page, warning: result.warning || SOURCE_WARNING };
    const remote: Book[] = [];
    for (const doc of data.docs.slice(0, 12)) {
      if (!doc || typeof doc !== "object") continue;
      const workId = text(doc.key);
      if (!/^\/works\/OL\d+W$/.test(workId)) continue;
      const edition = doc.editions?.docs?.[0];
      const editionKey = text(edition?.key);
      const validEdition = /^\/books\/OL\d+M$/.test(editionKey);
      const id = (validEdition ? editionKey : workId).split("/").pop()!;
      const title = text(edition?.title || doc.title),
        authors = strings(doc.author_name, 5);
      if (!title) continue;
      const existing = this.get(id);
      if (existing) {
        remote.push(existing);
        continue;
      }
      const stocked =
        validEdition && !!authors.length && !!text(edition?.title);
      const book: Book = {
        id,
        workId,
        title,
        authors,
        category: "Open Library",
        subjects: strings(doc.subject),
        isbn: [],
        year: Number.isInteger(doc.first_publish_year)
          ? doc.first_publish_year
          : undefined,
        format: "unspecified",
        priceCents: stocked ? 1299 : 0,
        stock: stocked ? 5 : 0,
        stocked,
        sourceUrl: `https://openlibrary.org${validEdition ? editionKey : workId}`,
        fetchedAt: new Date().toISOString(),
        coverId:
          Number.isInteger(doc.cover_i) && doc.cover_i > 0
            ? doc.cover_i
            : undefined,
        language: strings(edition?.language, 5),
        sourceKind: "openlibrary",
        admissionFormat: "unspecified",
      };
      remote.push(await this.save(book));
    }
    // Merge first-page local matches with remote matches. Explicit edition/ISBN lookup never deduplicates by work.
    const combined = [...local, ...remote].sort(
      (a, b) =>
        Number(!!input.query && normalize(b.title) === normalize(query)) -
        Number(!!input.query && normalize(a.title) === normalize(query)),
    );
    const seen = new Set<string>();
    const books = combined.filter((b) => {
      const key = b.workId || b.id;
      if (seen.has(key) || !this.eligible(input, b)) return false;
      seen.add(key);
      return true;
    });
    return {
      books,
      page,
      nextPage:
        page < 20 && page * 12 < Number(data.numFound || data.num_found || 0)
          ? page + 1
          : undefined,
      warning: result.warning,
    };
  }
  async searchLive(
    query: string,
  ): Promise<{ books: Book[]; warning?: string }> {
    if (!this.live) return { books: [] };
    return this.discover({ query });
  }
  async details(id: string): Promise<Book | undefined> {
    const old = this.get(id);
    if (!old || !this.live) return old;
    if (
      old.detailsFetchedAt &&
      Date.now() - Date.parse(old.detailsFetchedAt) < 7 * 86400000
    )
      return old;
    const path = /^OL\d+M$/.test(id)
      ? `/books/${id}.json`
      : /^OL\d+W$/.test(id)
        ? `/works/${id}.json`
        : undefined;
    if (!path) return old;
    const result = await this.source.get(path, 7);
    if (!result.data || result.data.notFound)
      return {
        ...old,
        metadataWarning:
          result.warning ||
          "Source details are unavailable; showing saved information.",
      };
    if (id.endsWith("W")) {
      const desc = this.description(result.data, old.sourceUrl, "work");
      const book = await this.save({
        ...old,
        ...desc,
        detailsFetchedAt: result.warning ? undefined : new Date().toISOString(),
      });
      return { ...book, metadataWarning: result.warning };
    }
    const book = await this.fromEdition(result.data, old, !!result.warning);
    return book
      ? { ...book, metadataWarning: result.warning || book.metadataWarning }
      : old;
  }
  private description(data: any, url: string, level: "work" | "edition") {
    const raw =
      typeof data.description === "string"
        ? data.description
        : data.description?.value;
    const value = text(raw, 1201);
    return value
      ? {
          description: value.slice(0, 1200),
          descriptionTruncated: value.length > 1200,
          descriptionSourceUrl: url,
          descriptionLevel: level,
        }
      : {};
  }
  private async fromEdition(
    data: any,
    old?: Book,
    stale = false,
  ): Promise<Book | undefined> {
    const key = text(data.key);
    if (!/^\/books\/OL\d+M$/.test(key)) return undefined;
    const id = key.split("/").pop()!;
    if (old && old.id !== id) return undefined;
    old = old || this.get(id);
    const workId = text(data.works?.[0]?.key) || old?.workId || "";
    const work = /^\/works\/OL\d+W$/.test(workId)
      ? await this.source.get(`${workId}.json`, 7)
      : {};
    let authors = old?.authors || [];
    let warning = work.warning;
    if (!authors.length) {
      for (const author of (Array.isArray(data.authors)
        ? data.authors
        : Array.isArray(work.data?.authors)
          ? work.data.authors
          : []
      ).slice(0, 5)) {
        const authorKey = text(author?.key || author?.author?.key);
        if (!/^\/authors\/OL\d+A$/.test(authorKey)) continue;
        const result = await this.source.get(`${authorKey}.json`, 7);
        const name = text(result.data?.name);
        if (name) authors.push(name);
        warning = warning || result.warning;
      }
    }
    const title = text(data.title) || old?.title || "";
    const stocked = !!title && !!authors.length;
    const format = bookFormat(data.physical_format);
    const desc = this.description(
      data,
      `https://openlibrary.org${key}`,
      "edition",
    );
    const workDesc = this.description(
      work.data || {},
      `https://openlibrary.org${workId}`,
      "work",
    );
    const book: Book = {
      ...old,
      id,
      workId,
      title,
      authors,
      category: old?.category || "Open Library",
      subjects: strings(work.data?.subjects || old?.subjects),
      isbn: strings(
        [...strings(data.isbn_13, 8), ...strings(data.isbn_10, 8)],
        8,
      ).filter((i) => /^(?:\d{9}[\dX]|\d{13})$/.test(i)),
      year: old?.year,
      format,
      pages:
        Number.isInteger(data.number_of_pages) && data.number_of_pages > 0
          ? data.number_of_pages
          : undefined,
      editionPublishDate: text(data.publish_date),
      language: strings(
        (Array.isArray(data.languages) ? data.languages : []).map((l: any) =>
          text(l?.key).replace("/languages/", ""),
        ),
        5,
      ),
      priceCents: stocked ? demoPrice(format) : 0,
      stock: stocked ? 5 : 0,
      stocked,
      sourceUrl: `https://openlibrary.org${key}`,
      fetchedAt: old?.fetchedAt || new Date().toISOString(),
      coverId:
        Array.isArray(data.covers) && data.covers[0] > 0
          ? data.covers[0]
          : old?.coverId,
      sourceKind: old?.sourceKind || "openlibrary",
      admissionFormat: format,
      ...(Object.keys(desc).length ? desc : workDesc),
      detailsFetchedAt: stale || warning ? undefined : new Date().toISOString(),
    };
    return { ...(await this.save(book)), metadataWarning: warning };
  }
}
