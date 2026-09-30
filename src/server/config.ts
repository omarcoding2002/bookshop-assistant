import "dotenv/config";
import { z } from "zod";
const schema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-5-5"),
  DATABASE_URL: z.string().optional(),
  LOCAL_DB_PATH: z.string().default(".data/postgres"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("127.0.0.1"),
  PUBLIC_ORIGIN: z.string().url().default("http://localhost:3000"),
  OPEN_LIBRARY_CONTACT: z.string().default(""),
  LIVE_BOOK_SEARCH: z.enum(["true", "false"]).default("false"),
  MODEL_BUDGET_USD: z.coerce.number().min(0).max(20).default(20),
  MODEL_INPUT_USD_PER_MILLION: z.coerce.number().positive().default(2),
  MODEL_OUTPUT_USD_PER_MILLION: z.coerce.number().positive().default(10),
  NODE_ENV: z.string().default("development"),
});
export type Config = z.infer<typeof schema>;
export const config = schema.parse({
  ...process.env,
  PUBLIC_ORIGIN:
    process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || undefined,
});
if (config.NODE_ENV === "production" && !config.DATABASE_URL)
  throw new Error(
    "Production requires DATABASE_URL: ephemeral local storage would lose orders and budget accounting.",
  );
if (config.LIVE_BOOK_SEARCH === "true" && !config.OPEN_LIBRARY_CONTACT)
  throw new Error("Live lookup requires OPEN_LIBRARY_CONTACT.");
