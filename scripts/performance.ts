import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
const base = process.env.EVAL_BASE_URL;
if (!base)
  throw new Error(
    "Set EVAL_BASE_URL to the running AI prototype. This test uses its shared, capped model budget.",
  );
const health = (await (await fetch(`${base}/api/health`)).json()) as {
  mode: string;
};
if (health.mode !== "ai")
  throw new Error("This measurement requires live AI mode.");
const cookies: string[] = [];
for (let i = 0; i < 3; i++) {
  const r = await fetch(`${base}/api/v1/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) throw new Error(`Session creation returned ${r.status}`);
  cookies.push(r.headers.get("set-cookie")!.split(";")[0]);
}
const prompts = [
  "Recommend two mystery books under $15.",
  "Compare those two using only catalogue facts.",
  "What format is the first one?",
  "Would it suit a ten-year-old? Say if you cannot verify.",
  "Show me a different mystery under $15.",
  "Add the first one to my basket.",
  "What is my basket total?",
  "Remove that book from my basket.",
  "I would like a fantasy book under $15 instead.",
  "Tell me the demo store's delivery policy.",
];
const turnCount = Number(process.env.PERF_TURNS || prompts.length);
if (!Number.isInteger(turnCount) || turnCount < 3 || turnCount > prompts.length)
  throw new Error("PERF_TURNS must be 3–10");
const samples: {
  visitor: number;
  turn: number;
  status: number;
  latencyMs: number;
  error?: string;
}[] = [];
for (let turn = 0; turn < turnCount; turn++) {
  const batchStart = performance.now();
  await Promise.all(
    cookies.map(async (cookie, visitor) => {
      const start = performance.now();
      try {
        const r = await fetch(`${base}/api/v1/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ message: prompts[turn] }),
          signal: AbortSignal.timeout(150_000),
        });
        const body = (await r.json()) as { error?: { code?: string } };
        samples.push({
          visitor: visitor + 1,
          turn: turn + 1,
          status: r.status,
          latencyMs: Math.round(performance.now() - start),
          error: body.error?.code,
        });
      } catch (e) {
        samples.push({
          visitor: visitor + 1,
          turn: turn + 1,
          status: 0,
          latencyMs: Math.round(performance.now() - start),
          error: (e as Error).name,
        });
      }
    }),
  );
  console.log(`Measured batch ${turn + 1}/${turnCount}`);
  if (turn < turnCount - 1)
    await new Promise((r) =>
      setTimeout(r, Math.max(0, 17_000 - (performance.now() - batchStart))),
    );
}
const values = samples
  .filter((s) => s.status === 200)
  .map((s) => s.latencyMs)
  .sort((a, b) => a - b);
const percentile = (p: number) =>
  values[Math.max(0, Math.ceil(values.length * p) - 1)] ?? null;
const report = {
  executedAt: new Date().toISOString(),
  baseUrl: base,
  mode: "live-ai",
  concurrentVisitors: 3,
  totalTurns: samples.length,
  successfulTurns: values.length,
  errorRate: (samples.length - values.length) / samples.length,
  p50Ms: percentile(0.5),
  p95Ms: percentile(0.95),
  targetP95Ms: 15_000,
  targetMet:
    values.length === cookies.length * turnCount &&
    (percentile(0.95) ?? Infinity) <= 15_000,
  note: `Warm service, three concurrent sessions, ${turnCount} turns each. Batches start at least 17 seconds apart to respect the public chat rate limit. Client-observed full-response latency excludes pacing delays. No model tokens or credentials are included in this report.`,
  samples,
};
await writeFile(
  new URL("../docs/performance-live.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
if (!report.targetMet) process.exitCode = 1;
