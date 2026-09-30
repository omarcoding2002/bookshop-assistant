import { writeFile } from "node:fs/promises";
import type { ChatResult } from "../src/shared.js";
const base = process.env.EVAL_BASE_URL || "http://localhost:3002";
if ((await (await fetch(`${base}/api/health`)).json()).mode !== "ai")
  throw new Error("AI mode required");
const results = [];
for (let i = 0; i < 5; i++)
  for (const message of [
    "Recommend history books, including Capitalist Realism. Which is shorter?",
    "The lies of Locke Lamora is unavailable. Suggest alternatives and explain their tone and plot.",
  ]) {
    const session = await fetch(`${base}/api/v1/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!session.ok) throw new Error(`Session HTTP ${session.status}`);
    const cookie = session.headers.get("set-cookie")!.split(";")[0];
    const started = Date.now();
    const r = await fetch(`${base}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ message }),
    });
    const response = (await r.json()) as ChatResult;
    const passed =
      r.ok &&
      response.books.length > 0 &&
      response.books.every((b) => response.text.includes(b.title)) &&
      !/Capitalism Realism|heist|con.artist|humou?r|fast.paced/i.test(
        response.text,
      ) &&
      /do not verify plot/.test(response.text);
    results.push({
      iteration: i + 1,
      message,
      passed,
      latencyMs: Date.now() - started,
      response,
    });
    console.log(
      `${passed ? "PASS" : "FAIL"} accuracy repetition ${results.length}/10`,
    );
    await new Promise((r) => setTimeout(r, 7000));
  }
const report = {
  executedAt: new Date().toISOString(),
  passed: results.filter((r) => r.passed).length,
  total: results.length,
  results,
};
await writeFile(
  "docs/accuracy-live.json",
  JSON.stringify(report, null, 2) + "\n",
);
if (report.passed !== 10) process.exitCode = 1;
