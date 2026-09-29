# Between the Lines — Bookshop Assistant

A conversational bookstore prototype: discover a reader’s preferences, find real books, compare editions, build a basket, and explicitly confirm a **simulated** order.

**Live demo:** [Between the Lines](https://bookshop-assistant.onrender.com) · **Repository:** [GitHub](https://github.com/omarcoding2002/bookshop-assistant).

Live Claude conversations, Neon persistence and simulated checkout are deployed on Render's free Frankfurt service. See [release evidence](docs/release-status.md). The React UI is included; a Claude Code handoff brief supports later refinements.

![Desktop demo](docs/screenshots/desktop.png)

## Run locally

Requires Node.js 22.13+ (tested on 24.11.1) and npm. No paid account or external database is needed for the offline demonstration.

```sh
npm ci
cp .env.example .env
npm run build
npm start
```

Open **http://localhost:3000**. The API and UI use the same origin. Local PostgreSQL-compatible storage (PGlite) lives in `.data/postgres`; migrations run automatically. Do not open the same local database from two server processes.

Try this conversation:

1. “A mystery under $15”
2. “Compare these books”
3. “Add the first one”
4. “Checkout”
5. Review the quote, then click **Confirm demo order** or type exactly **confirm order**.

The visible **Offline demo** label means responses are deterministic guided interactions. Set `ANTHROPIC_API_KEY` in `.env` and restart to use the real LLM. An invalid key produces an explicit error; it does not silently substitute scripted responses.

## Enable live AI

Use a dedicated Anthropic workspace with a funded API key and automatic replenishment disabled. This deployment has an owner-configured $20 monthly provider cap and a stricter $10 cumulative application allowance. Keep both safeguards; the application allowance does not reset monthly. The application does not fund accounts. Configure:

```dotenv
ANTHROPIC_API_KEY=your-secret-key
ANTHROPIC_MODEL=claude-sonnet-5-5
MODEL_BUDGET_USD=10
MODEL_INPUT_USD_PER_MILLION=2
MODEL_OUTPUT_USD_PER_MILLION=10
```

Verify model access and current provider pricing before using a different model. The configurable cost rates drive conservative per-call reservations in a persistent budget ledger. A timeout is charged at its reserved estimate, so an uncertain bill cannot silently exceed the application allowance. Provider-side spending limits remain essential. The application budget is cumulative and does not reset on restart or every month.

The agent uses validated tools for facts and commerce. It cannot directly create an order: confirmation happens in server code. See [architecture](docs/architecture.md) and [design decisions](docs/data-and-decisions.md).

## Data and prices

The repository contains **97 real edition records from Open Library** across ten categories. Source URLs and retrieval dates are retained. The seed is checked in so the demo works without catalogue network access.

All prices and stock are fictional. Paperback and unspecified-format editions cost $12.99; verified hardcovers cost $22.99; verified ebooks would cost $7.99. The current snapshot may not contain every format. Unknown formats are labelled honestly. A work’s original publication year is distinct from an edition’s publication date.

Each visitor gets an independent fictional stock allocation. External lookup results cannot be purchased. Enable optional low-volume live lookup with `LIVE_BOOK_SEARCH=true` and `OPEN_LIBRARY_CONTACT=your-contact-email`. Refreshing the seed requires internet access and `curl`:

```sh
npm run seed:refresh
```

Refresh is an explicit maintenance operation, not a startup task. Source coverage and rankings change, so inspect catalogue changes before committing. See [data provenance and licensing](docs/data-and-decisions.md).

## Commands

| Command                    | Purpose                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `npm run build`            | Type-check the whole project and build the UI                                        |
| `npm start`                | Run the production-style server locally                                              |
| `npm run dev`              | Watch the backend                                                                    |
| `npm run dev:ui`           | Vite UI development server; set `PUBLIC_ORIGIN=http://localhost:5173` on the backend |
| `npm test`                 | Backend, commerce, provider-boundary and security regression tests                   |
| `npm run test:e2e`         | Desktop and mobile browser journeys; local Google Chrome is used                     |
| `npm run eval`             | 20 deterministic offline customer scenarios; no paid calls                           |
| `npm run eval -- --live`   | Evaluate a running AI-mode server; consumes its capped API allowance                 |
| `npm run eval:performance` | Measure 30 live turns with three concurrent visitors; requires `EVAL_BASE_URL`       |
| `npm run check`            | Build and backend tests                                                              |
| `npm run format`           | Format source, tests and documentation                                               |
| `npm run openapi`          | Regenerate the checked-in API contract                                               |

For browser tests on a machine without Google Chrome, install Playwright Chromium with `npx playwright install chromium` and run with `PLAYWRIGHT_CHROMIUM=true npm run test:e2e`. CI uses bundled Chromium. Browser tests deliberately block remote covers to verify the built-in cover fallback and avoid a third-party dependency.

## Public deployment

The published repository is [omarcoding2002/bookshop-assistant](https://github.com/omarcoding2002/bookshop-assistant). The public demo is [bookshop-assistant.onrender.com](https://bookshop-assistant.onrender.com), backed by Neon PostgreSQL. GitHub Actions must pass before Render automatically deploys main. Both hosting services use their free plans in Frankfurt.

To reproduce deployment in your own accounts:

1. Connect the repository to Render and create a Blueprint using `render.yaml`.
2. Supply a Neon PostgreSQL connection string as `DATABASE_URL` and the dedicated `ANTHROPIC_API_KEY` as secrets.
3. Render supplies `RENDER_EXTERNAL_URL`; this becomes the allowed browser origin automatically. For a custom domain, set `PUBLIC_ORIGIN` explicitly, without a trailing slash.
4. Keep the free plan and one service instance. Inspect the CI results and `/api/health` after deployment.
5. Run a real-model scenario evaluation, then a purchase through the public UI. Record the URL and results in `docs/release-status.md`.

Production refuses to start without `DATABASE_URL`; Render’s local filesystem is ephemeral. Free Render services sleep when idle, so the first request can be slow. The Neon free database can also suspend compute. No availability guarantee is claimed. [Render free-tier documentation](https://render.com/docs/free).

## Repository guide

- `src/server`: HTTP API, agent, catalogue adapter, transactional commerce and budget controls.
- `src/client`: responsive React UI and local cover placeholders.
- `src/shared.ts`: shared data contracts; `docs/openapi.json`: external API contract.
- `migrations`: idempotent PostgreSQL schema; `data`: versioned book snapshot.
- `tests`: backend and browser tests; `scripts/evaluate.ts`: reproducible customer scenarios.
- [Requirements](docs/requirements.md), [architecture](docs/architecture.md), [evaluation](docs/evaluation.md), [Claude Code UI handoff](docs/claude-code-ui-brief.md), [release status](docs/release-status.md).

## Boundaries

This is an English/USD prototype. It has no real payment, tax, fulfilment, customer accounts, administration portal, voice or production inventory. Book metadata can be incomplete; age suitability is not guaranteed. No full books or copyrighted descriptions are reproduced.

Anonymous histories, baskets and demo orders expire seven days after session creation and are purged at startup/hourly. “Start fresh” deletes the current session immediately. Server request logs omit message bodies, cookies and search query strings. Live chat content is sent to Anthropic to generate replies; optional live searches send search terms to Open Library. Do not enter personal or payment information.

Code is MIT licensed. Third-party metadata and cover images are excluded from that license.
