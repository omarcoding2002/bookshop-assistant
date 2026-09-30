import type { Database } from "./db.js";
export const SOURCE_WARNING =
  "Open Library is temporarily unavailable. Showing saved information where available.";
export type SourceResult = { data?: any; warning?: string };
export class OpenLibrary {
  private pending = new Map<string, Promise<SourceResult>>();
  private queue: Promise<unknown> = Promise.resolve();
  private nextRequest = 0;
  constructor(
    private db: Database,
    private contact: string,
    private fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
  ) {}
  async get(path: string, ttlDays: number): Promise<SourceResult> {
    if (
      !/^\/(search\.json\?|(?:books|works|authors)\/OL\d+[MWA]\.json$|isbn\/[\dX]{10,13}\.json$)/.test(
        path,
      )
    )
      throw new Error("Invalid source path");
    const key = `ol:v2:${path}`;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const task = this.read(key, path, ttlDays);
    this.pending.set(key, task);
    try {
      return await task;
    } finally {
      this.pending.delete(key);
    }
  }
  private async read(
    key: string,
    path: string,
    ttlDays: number,
  ): Promise<SourceResult> {
    const cached = (
      await this.db.query<{ payload: any; fresh: boolean }>(
        "SELECT payload, expires_at>NOW() AS fresh FROM catalogue_cache WHERE cache_key=$1",
        [key],
      )
    ).rows[0];
    if (cached?.fresh) return { data: cached.payload };
    if (this.pending.size >= 20)
      return { data: cached?.payload, warning: SOURCE_WARNING };
    const queuedAt = Date.now();
    const task = this.queue.then(async () => {
      if (Date.now() - queuedAt > 10000) throw new Error("Source queue busy");
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, this.nextRequest - Date.now())),
      );
      this.nextRequest = Date.now() + 1000;
      const response = await this.fetcher(`https://openlibrary.org${path}`, {
        headers: { "User-Agent": `BookshopAssistant (${this.contact})` },
        signal: AbortSignal.timeout(6000),
      });
      if (response.status === 429) this.nextRequest = Date.now() + 10000;
      if (!response.ok) {
        if (response.status === 404) return { notFound: true };
        throw new Error("Source unavailable");
      }
      const text = await response.text();
      if (text.length > 2_000_000) throw new Error("Source response too large");
      return JSON.parse(text);
    });
    this.queue = task.catch(() => undefined);
    try {
      const data = await task;
      await this.db.query(
        "INSERT INTO catalogue_cache(cache_key,payload,expires_at) VALUES($1,$2,NOW()+($3 * INTERVAL '1 day')) ON CONFLICT(cache_key) DO UPDATE SET payload=EXCLUDED.payload,expires_at=EXCLUDED.expires_at",
        [key, JSON.stringify(data), ttlDays],
      );
      return { data };
    } catch {
      return { data: cached?.payload, warning: SOURCE_WARNING };
    }
  }
}
export function text(value: unknown, max = 300): string {
  return typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f]/g, " ")
        .trim()
        .slice(0, max)
    : "";
}
export function strings(value: unknown, max = 18): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((v) => text(v, 180)).filter(Boolean))].slice(0, max)
    : [];
}
export function isbnQuery(value: string): string | undefined {
  if (!/^(?:ISBN(?:-1[03])?:?\s*)?[\dXx\s-]+$/i.test(value)) return undefined;
  const cleaned = value
    .replace(/^ISBN(?:-1[03])?:?\s*/i, "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
  return /^(?:\d{9}[\dX]|\d{13})$/.test(cleaned) ? cleaned : undefined;
}
export const bookFormat = (
  value: unknown,
): "paperback" | "hardcover" | "ebook" | "unspecified" => {
  const raw = text(value).toLowerCase();
  return /paperback|softcover/.test(raw)
    ? "paperback"
    : /hardcover|hardback/.test(raw)
      ? "hardcover"
      : /ebook|e-book|electronic/.test(raw)
        ? "ebook"
        : "unspecified";
};
export const demoPrice = (format: string) =>
  format === "hardcover" ? 2299 : format === "ebook" ? 799 : 1299;

// ISBN-10 and its 978 ISBN-13 counterpart identify the same edition.
export function canonicalISBN(value: string): string | undefined {
  const code = isbnQuery(value);
  if (!code) return undefined;
  if (code.length === 10) {
    const sum = [...code].reduce(
      (n, c, i) => n + (c === "X" ? 10 : Number(c)) * (10 - i),
      0,
    );
    if (sum % 11) return undefined;
    const stem = "978" + code.slice(0, 9);
    const check =
      (10 -
        ([...stem].reduce((n, c, i) => n + Number(c) * (i % 2 ? 3 : 1), 0) %
          10)) %
      10;
    return stem + check;
  }
  return [...code].reduce((n, c, i) => n + Number(c) * (i % 2 ? 3 : 1), 0) %
    10 ===
    0
    ? code
    : undefined;
}
export function matchesISBN(values: string[], requested: string): boolean {
  const expected = canonicalISBN(requested);
  return (
    !!expected && values.some((value) => canonicalISBN(value) === expected)
  );
}
