import { writeFile } from "node:fs/promises";
import type { ChatResult } from "../src/shared.js";
import { matchesISBN } from "../src/server/open-library.js";
const base = process.env.EVAL_BASE_URL || "http://localhost:3002";
const results = [];
for (const prompts of [
  [
    "Find Piranesi by Susanna Clarke under $15.",
    "What are the page count and format?",
    "Add the first one to my basket.",
    "checkout",
    "confirm order",
  ],
  ["Find books by Ursula K. Le Guin under $15."],
  ["Find books about coral reefs under $15."],
  ["9780060512750"],
  [
    "A science book for a ten-year-old under $15. Can you verify age suitability?",
  ],
]) {
  const session = await fetch(`${base}/api/v1/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!session.ok) throw new Error(`Session HTTP ${session.status}`);
  const cookie = session.headers.get("set-cookie")!.split(";")[0];
  for (const message of prompts) {
    await new Promise((r) => setTimeout(r, 6500));
    const start = Date.now();
    const r = await fetch(`${base}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ message }),
      signal: AbortSignal.timeout(120000),
    });
    const response = (await r.json()) as ChatResult;
    const cardFacts =
      r.ok && response.books.every((b) => response.text.includes(b.title));
    const budget =
      !message.includes("under $15") ||
      response.books.every((b) => b.priceCents <= 1500);
    const sale = message !== "confirm order" || !!response.order;
    const found = !/^Find |^978/.test(message) || response.books.length > 0;
    const age =
      !message.includes("ten-year-old") ||
      /age suitability is unverified/i.test(response.text);
    const isbn =
      message !== "9780060512750" ||
      response.books.some((b) => matchesISBN(b.isbn, message));
    const author =
      !message.startsWith("Find books by Ursula") ||
      response.books.every((b) =>
        b.authors.some((a) => /Ursula.*Le Guin/i.test(a)),
      );
    const passed =
      cardFacts && budget && sale && found && age && isbn && author;
    results.push({ message, passed, latencyMs: Date.now() - start, response });
    console.log(`${passed ? "PASS" : "FAIL"} ${message}`);
  }
}
const report = {
  executedAt: new Date().toISOString(),
  baseUrl: base,
  passed: results.filter((r) => r.passed).length,
  total: results.length,
  results,
};
await writeFile(
  "docs/discovery-ai-live.json",
  JSON.stringify(report, null, 2) + "\n",
);
if (report.passed !== report.total) process.exitCode = 1;
