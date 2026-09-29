import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { createDatabase } from "../src/server/db.js";
import { Catalogue } from "../src/server/catalogue.js";
import { Store } from "../src/server/store.js";
import { Agent } from "../src/server/agent.js";
import { config } from "../src/server/config.js";
import type { ChatResult } from "../src/shared.js";
const live = process.argv.includes("--live");
const base = process.env.EVAL_BASE_URL || "http://localhost:3000";
const db = await createDatabase();
const catalogue = await Catalogue.load(db);
const store = new Store(db, catalogue);
const agent = new Agent(store, { ...config, ANTHROPIC_API_KEY: "" });
const exact = catalogue.books.find((b) => b.stock > 0 && b.isbn.length)!;
const unavailable = catalogue.books.find((b) => b.stock === 0)!;
type Scenario = {
  name: string;
  turns: string[];
  check: (r: ChatResult, all: ChatResult[]) => boolean;
};
const cases: Scenario[] = [
  {
    name: "Greeting",
    turns: ["Hello"],
    check: (r) => /book|read|gift/i.test(r.text),
  },
  {
    name: "Undecided reader",
    turns: ["I'm not sure what to read"],
    check: (r) => r.text.includes("?"),
  },
  {
    name: "Gift discovery",
    turns: ["Help me find a gift"],
    check: (r) => /who|recipient|interest|enjoy/i.test(r.text),
  },
  {
    name: "Mystery within budget",
    turns: ["A mystery under $15"],
    check: (r) =>
      r.books.length > 0 && r.books.every((b) => b.priceCents <= 1500),
  },
  {
    name: "Fantasy discovery",
    turns: ["fantasy"],
    check: (r) =>
      r.books.length > 0 && r.books.every((b) => b.category === "Fantasy"),
  },
  {
    name: "Science fiction discovery",
    turns: ["science fiction"],
    check: (r) =>
      r.books.length > 0 &&
      r.books.every((b) => b.category === "Science fiction"),
  },
  {
    name: "Romance discovery",
    turns: ["romance"],
    check: (r) =>
      r.books.length > 0 && r.books.every((b) => b.category === "Romance"),
  },
  {
    name: "Children suitability uncertainty",
    turns: ["A book for my child"],
    check: (r) => /age|suitab|old|interest/i.test(r.text),
  },
  {
    name: "Teen reader",
    turns: ["young adult"],
    check: (r) =>
      r.books.length > 0 && r.books.every((b) => b.category === "Young adult"),
  },
  {
    name: "Nonfiction reader",
    turns: ["history"],
    check: (r) =>
      r.books.length > 0 && r.books.every((b) => b.category === "History"),
  },
  {
    name: "Exact title",
    turns: [exact.title],
    check: (r) => r.books.some((b) => b.id === exact.id),
  },
  {
    name: "Exact ISBN",
    turns: [exact.isbn[0]],
    check: (r) => r.books.some((b) => b.id === exact.id),
  },
  {
    name: "No title match",
    turns: ["zzzznonexistentbookzzzz"],
    check: (r) => r.books.length === 0,
  },
  {
    name: "Budget too low",
    turns: ["fantasy under $1"],
    check: (r) =>
      r.books.length === 0 && /budget|within|match|stock/i.test(r.text),
  },
  {
    name: "Price objection",
    turns: ["Give me a discount"],
    check: (r) => /fixed|can.t|no discount|not offer/i.test(r.text),
  },
  {
    name: "Comparison",
    turns: ["mystery", "compare these books"],
    check: (r) => r.books.length >= 2,
  },
  {
    name: "Preference memory and rejection",
    turns: ["mystery under $15", "different books please"],
    check: (r, all) =>
      r.books.length > 0 &&
      r.books.every(
        (b) => b.priceCents <= 1500 && !all[0].books.some((x) => x.id === b.id),
      ),
  },
  {
    name: "Unavailable edition",
    turns: [unavailable.title],
    check: (r) => !r.books.some((b) => b.id === unavailable.id && b.stock > 0),
  },
  {
    name: "Cart changes",
    turns: ["mystery", "add the first one", "remove the first one"],
    check: (r) => r.cart.count === 0,
  },
  {
    name: "Complete conversational sale",
    turns: ["mystery", "add the first one", "checkout", "confirm order"],
    check: (r) =>
      !!r.order && r.cart.count === 0 && r.order.label.includes("no payment"),
  },
];
if (live) {
  const health = (await (await fetch(`${base}/api/health`)).json()) as {
    mode: string;
  };
  if (health.mode !== "ai")
    throw new Error(
      "Live evaluation requires a running AI-mode server. No live model evaluation performed.",
    );
}
const transcripts: {
  scenario: string;
  turns: { message: string; latencyMs: number; response: ChatResult }[];
}[] = [];
const results: {
  name: string;
  passed: boolean;
  latencyMs: number;
  detail?: string;
}[] = [];
for (const scenario of cases) {
  const state = await store.createSession();
  let cookie = "";
  if (live) {
    await new Promise((r) => setTimeout(r, 7000));
    const response = await fetch(`${base}/api/v1/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!response.ok)
      throw new Error(`Session creation failed: ${response.status}`);
    cookie = response.headers.get("set-cookie")!.split(";")[0];
  }
  const start = performance.now();
  const turns: ChatResult[] = [];
  const transcript: {
    message: string;
    latencyMs: number;
    response: ChatResult;
  }[] = [];
  transcripts.push({ scenario: scenario.name, turns: transcript });
  try {
    for (const message of scenario.turns) {
      if (live) {
        await new Promise((r) => setTimeout(r, 5500));
        const turnStart = performance.now();
        const response = await fetch(`${base}/api/v1/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ message }),
        });
        if (!response.ok)
          throw new Error(
            `Chat failed: ${response.status} ${await response.text()}`,
          );
        const result = (await response.json()) as ChatResult;
        turns.push(result);
        transcript.push({
          message,
          latencyMs: Math.round(performance.now() - turnStart),
          response: result,
        });
      } else turns.push(await agent.chat(state.state.id, message));
    }
    const passed = scenario.check(turns.at(-1)!, turns);
    results.push({
      name: scenario.name,
      passed,
      latencyMs: Math.round(performance.now() - start),
      detail: passed
        ? undefined
        : "Rubric did not pass; inspect scenario manually.",
    });
  } catch (e) {
    results.push({
      name: scenario.name,
      passed: false,
      latencyMs: Math.round(performance.now() - start),
      detail: (e as Error).message,
    });
  }
  console.log(`${results.at(-1)!.passed ? "PASS" : "FAIL"} ${scenario.name}`);
}
if (live)
  await writeFile(
    new URL("../docs/evaluation-live-transcripts.json", import.meta.url),
    JSON.stringify(transcripts, null, 2) + "\n",
  );
const report = {
  executedAt: new Date().toISOString(),
  mode: live ? "live-ai" : "offline-guided",
  paidModelCalls: live ? "See server budget ledger" : 0,
  passed: results.filter((r) => r.passed).length,
  total: results.length,
  note: live
    ? "Scenario checks require additional human review for factual accuracy, appropriateness and conversation quality."
    : "Offline scenarios are deterministic checks, not evidence of live LLM quality or latency.",
  results,
};
await writeFile(
  new URL(
    `../docs/evaluation-${live ? "live" : "offline"}.json`,
    import.meta.url,
  ),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
await db.close();
if (report.passed < 18) process.exitCode = 1;
