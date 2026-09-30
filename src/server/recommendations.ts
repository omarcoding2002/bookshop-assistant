import { z } from "zod";
import type { Book, Cart, Quote } from "../shared.js";
import { money } from "../shared.js";
import { policy } from "./store.js";

// The model selects references, never writes book claims or customer-facing facts.
export const answerSchema = z
  .object({
    kind: z.enum([
      "recommend",
      "compare",
      "details",
      "discovery",
      "policy",
      "cart",
      "no_matches",
    ]),
    selections: z
      .array(
        z
          .object({
            bookId: z.string().regex(/^OL\d+[MW]$/),
            facts: z
              .array(z.enum(["category", "format", "pages", "year", "isbn"]))
              .max(5),
            subjectIndices: z.array(z.number().int().min(0).max(7)).max(3),
          })
          .strict(),
      )
      .max(3),
    question: z.enum([
      "interests",
      "gift",
      "age",
      "budget",
      "choose",
      "edition",
      "none",
    ]),
  })
  .strict();
export type Answer = z.infer<typeof answerSchema>;
const questions = {
  interests: "What subjects or kinds of stories do you enjoy?",
  gift: "What does the person you’re buying for enjoy reading?",
  age: "Roughly how old is the reader, and what do they enjoy?",
  budget: "What would you like to spend per book?",
  choose: "Would you like to compare these editions or add one to your basket?",
  edition: "Do you need a particular edition, format or ISBN?",
  none: "",
};
export function renderAnswer(
  input: unknown,
  context: {
    books: Book[];
    cart: Cart;
    quote?: Quote;
    cartChanged?: boolean;
    searched?: boolean;
    child?: boolean;
  },
): { text: string; books: Book[]; valid: boolean } {
  const parsed = answerSchema.safeParse(input);
  const available = new Map(context.books.map((b) => [b.id, b]));
  let valid = parsed.success;
  let selected: Book[] = [];
  if (parsed.success) {
    for (const pick of parsed.data.selections) {
      const book = available.get(pick.bookId);
      if (
        !book ||
        selected.some((b) => b.id === pick.bookId) ||
        pick.subjectIndices.some((i) => !book.subjects[i])
      ) {
        valid = false;
        break;
      }
      selected.push(book);
    }
    if (
      ["recommend", "compare", "details"].includes(parsed.data.kind) &&
      !selected.length
    )
      valid = false;
  }
  if (!valid) selected = context.books.slice(0, 3);
  const answer = valid && parsed.success ? parsed.data : undefined;
  const lines: string[] = [];
  if (context.quote) {
    lines.push(
      `Your demo quote is ready: ${context.quote.cart.count} book(s), ${money(context.quote.cart.totalCents)} total. No order has been placed. Press Confirm demo order or type exactly: confirm order. No payment or delivery will occur.`,
    );
  } else if (context.cartChanged || answer?.kind === "cart") {
    lines.push(
      `${context.cartChanged ? "Your basket has been updated." : "Your basket:"} ${context.cart.count} book(s), ${money(context.cart.totalCents)} total. All prices are fictional; no payment is taken.`,
    );
  } else if (answer?.kind === "policy") {
    lines.push(policy.pricing, policy.fulfilment, policy.suitability);
  }
  if (selected.length) {
    lines.push(
      "Here are the verified catalogue details. Prices and availability are fictional demo data.",
    );
    for (const book of selected) {
      const pick = answer?.selections.find((p) => p.bookId === book.id);
      const facts = pick?.facts || ["category", "format"];
      const details: string[] = [];
      if (facts.includes("category"))
        details.push(`Shelved under ${book.category}.`);
      if (facts.includes("format"))
        details.push(
          book.format === "unspecified"
            ? "Format not verified."
            : `Format: ${book.format}.`,
        );
      if (facts.includes("pages"))
        details.push(
          book.pages
            ? `Edition length: ${book.pages} pages.`
            : "Edition page count unavailable.",
        );
      if (facts.includes("year"))
        details.push(
          book.year
            ? `Work first published: ${book.year}.`
            : "Original publication year unavailable.",
        );
      if (facts.includes("isbn"))
        details.push(
          book.isbn.length
            ? `ISBN: ${book.isbn.join(", ")}.`
            : "ISBN unavailable.",
        );
      const tags = pick?.subjectIndices.map((i) => book.subjects[i]) || [];
      if (tags.length)
        details.push(
          `The source lists these subject labels: ${tags.map((t) => JSON.stringify(t)).join(", ")}.`,
        );
      lines.push(
        `${book.title} — ${book.authors.join(", ") || "Author unavailable"}\n${details.join(" ")} ${book.stocked ? `${money(book.priceCents)}; ${book.stock} demo copies available.` : "Discovery only; no demo price or stock assigned."}`,
      );
    }
    if (answer?.kind === "compare") {
      if (
        selected.length > 1 &&
        selected.every((b) => Number.isInteger(b.pages) && b.pages! > 0)
      ) {
        const sorted = [...selected].sort((a, b) => a.pages! - b.pages!);
        lines.push(
          sorted[0].pages === sorted.at(-1)!.pages
            ? "These editions have the same recorded page count."
            : `By recorded page count, ${sorted[0].title} is shortest (${sorted[0].pages} pages) and ${sorted.at(-1)!.title} is longest (${sorted.at(-1)!.pages} pages).`,
        );
      } else
        lines.push(
          "I can’t compare length because a verified page count is not available for every compared edition.",
        );
    }
    lines.push(
      "These records do not verify plot, tone, pacing or age suitability.",
    );
  } else if (!lines.length) {
    lines.push(
      context.searched
        ? "I couldn’t find a match within the current search and budget filters. That does not mean the whole category is empty."
        : "Welcome to Between the Lines. Let’s find your next book.",
    );
  }
  if (!valid)
    lines.push(
      "Further details could not be verified. Please choose a book card or narrow your request.",
    );
  if (context.child)
    lines.push(
      "Age suitability is unverified; check the edition before choosing for a child.",
    );
  if (
    answer &&
    !context.quote &&
    !context.cartChanged &&
    questions[answer.question]
  )
    lines.push(questions[answer.question]);
  return { text: lines.join("\n\n"), books: selected, valid };
}
