# Architecture and operations

## Why this structure

One TypeScript application serves the UI and API. Fastify validates the HTTP boundary; Zod validates model tool arguments. React renders only structured data and escaped text. Anthropic’s SDK handles model transport; a small explicit loop keeps tool behaviour inspectable. A framework or multi-agent system would add orchestration without improving this small store.

`shared.ts` defines Book, Cart, Quote, Order, ChatResult and session types. `openapi.json` specifies the external API. `requirements.md` includes the system diagram.

## Request and data flow

1. The browser creates/resumes an anonymous session. A random 256-bit token is set in an HttpOnly cookie; only its SHA-256 hash is stored.
2. A chat request authenticates the session, acquires a per-session execution guard and validates its length.
3. AI mode supplies a prompt, the last ten messages, saved preferences and current basket/last book cards. The model can remember preferences, search, inspect details/policy, read/change basket and prepare a quote.
4. Each tool call is schema-validated and executes through application services. Results, including errors, are returned as tool messages. Maximum five model steps and eight tool calls per step.
5. The model finishes with `present_answer`: known book IDs, enumerated fact names, subject indices and a neutral question key. A strict schema rejects invented references and arbitrary prose. The server renders exact catalogue titles, facts and commerce totals; comparisons require every page count. Unstructured model text is never shown. Invalid selections fall back to verified cards and an uncertainty notice.
6. The browser receives SSE progress and a structured final result. This streams status/final events, not individual model tokens. JSON is available with `stream:false`.
7. Only the confirmation endpoint or an exact server-recognized chat confirmation can create an order. “Yes”, model prose, metadata instructions and checkout alone cannot create one.

## Storage and concurrency

The committed catalogue is read-only at runtime. Live-source responses are cached in PostgreSQL for one day; stale cached metadata may be returned during an outage. Old cache rows expire after an additional seven days.

Tables: sessions, quotes, orders, model_budget, catalogue_cache. Local PGlite runs the PostgreSQL schema without a separate service; cloud uses `pg` and a Neon URL. Migration 001 is idempotent and is applied at startup. Future schema changes should use numbered migrations and preserve old deploy compatibility.

Every commerce mutation locks its session row in a transaction. Quote version, current basket, stock and price are checked again at confirmation. One order per quote and one order per session/idempotency key are enforced by database constraints. Confirmation subtracts from a session’s fictional allocation and clears the basket atomically. Multiple users therefore cannot exhaust each other’s demo stock.

An in-process guard rejects overlapping chat/basket/order requests with 409, avoiding a model writing over a user’s simultaneous UI action. This requires **one server instance**. Before horizontal scaling, replace it with distributed session leases; IP limits and live-source throttling also need shared storage.

## Model spending

Before every model request, reserve a conservative maximum cost using serialized input byte length plus framing allowance, a 1,024-output-token ceiling and configurable token prices. Reject context over 48 KB and reserve atomically only when spent + reserved + next reservation fits the configured limit. Settle using actual reported token counts; a timeout/unknown bill consumes its full reservation. A crash can leave a reservation retained, deliberately failing closed until an operator reconciles it against provider usage.

This is not a substitute for the Anthropic workspace spending cap. Changing model/pricing settings requires validating the configured rates. The budget row is never erased by session cleanup or reset. Do not delete the database to restart a public demo’s allowance.

## Security and privacy

- Cookie authentication; SameSite Strict, HttpOnly and production Secure. Client-supplied session IDs are not authorization.
- Same-origin browser writes, JSON-only mutations, request/message bounds, rate limits and validated tools.
- React escapes content. Restrictive CSP allows covers only from Open Library; no model-provided scripts or arbitrary network tools.
- Source metadata is untrusted data in the system prompt. Basket mutation tools additionally require a direct action word in the user message. This is a limited intent safeguard, not proof against all prompt injection; validate live behaviour before release.
- Model requests contain the visitor’s messages, preferences and basket. Source queries are sent only when live lookup is enabled. No payment data is requested.
- Logs redact cookies/authorization and omit query strings and request bodies. Session data expires seven days after creation, with hourly cleanup.

## Failure behaviour

| Failure                                         | Behaviour                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Missing model key                               | Explicit offline guided mode                                                               |
| Invalid key/model, timeout, provider rate limit | 503/error event; no silent fake AI; manual catalogue/checkout remains usable               |
| Model budget exhausted                          | No provider call; explain limitation and keep basket usable                                |
| Invalid/unknown tool                            | Return a tool error, never execute arbitrary code                                          |
| Missing book details                            | Unknown fields remain unspecified                                                          |
| Open Library error/429                          | Use local/stale cached data, explain limitation; back off source requests                  |
| Empty basket                                    | Reject quote creation                                                                      |
| Expired/changed quote                           | 409; require a new quote                                                                   |
| Repeated confirmation                           | Return existing order without charging stock twice                                         |
| Duplicate concurrent session request            | 409; ask the client to wait                                                                |
| Database unavailable                            | Health/startup or request fails; never fabricate commerce state                            |
| SSE disconnect                                  | UI reports interrupted response and reloads basket; accepted backend work may still finish |

## Deployment and rollback

The Render blueprint uses Node, `npm ci --include=dev && npm run build`, `npm start`, `/api/health` and the free plan. A PostgreSQL URL is mandatory in production. `RENDER_EXTERNAL_URL` sets the allowed origin; explicitly override for a custom domain. Do not enable multiple instances with the current request guards.

Inspect CI, health and public purchase flow after deployment. Roll back the service to the previous successful Git commit if a release fails. Keep database state; migration 001 is compatible with this version. Free hosting cold starts are expected and excluded from warm performance measurements.
