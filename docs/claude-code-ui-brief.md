# Claude Code UI handoff

The React UI is already implemented and tested. Claude Code was not installed during the initial build. Use this brief for refinement, not as a requirement to rebuild a functioning interface.

## Product and visual direction

Between the Lines is a quiet, welcoming bookshop. Cream background, forest-green text/actions, restrained rust accents, serif book/section headings and system-font controls. No external font dependency. Keep the responsive shelves plus conversational bookseller, real metadata, honest source links, basket drawer and demo receipt.

On mobile the conversation appears before the shelves. Do not hide accessible names when labels become icon-only. Preserve native modal keyboard/focus behaviour, reduced-motion support, visible errors and loading state. Do not imply there is a real human behind the assistant or claim offline responses are live AI.

## Integration contract

Use `src/shared.ts` and `docs/openapi.json`. The same-origin backend owns all commerce; never calculate or store an authoritative price client-side.

- `POST /api/v1/sessions` with `{}` resumes/creates the HttpOnly session. `{reset:true}` deletes the old session/history/basket/orders.
- `GET /api/v1/config` supplies mode, categories and demo flags.
- `GET /api/v1/books` supports query/category/maxPriceCents/limit. Do not offer unstocked external results for sale.
- `POST /api/v1/chat` with `{message,stream:true}` returns SSE `status`, `result`, `error`. Handle errors after HTTP 200 and interrupted streams.
- `PATCH /api/v1/cart` sets `{bookId,quantity}`; zero removes. Refresh from the response and discard any previous quote.
- `POST /api/v1/quotes` returns an authoritative ten-minute quote.
- `POST /api/v1/orders/confirm` requires `{quoteId,idempotencyKey,confirmed:true}`. Derive a stable idempotency key from the quote for retries.
- `GET /api/v1/cart` and `GET /api/v1/orders` support recovery.

Disable overlapping mutations during chat or checkout. A 409 can mean another request is active or a quote is stale. Preserve an actionable error, reload the basket and offer a new quote when necessary. Display “Demo order — no payment taken.” Never create a checkout-success state from assistant prose alone; require an Order object from the backend.

## Local workflow

```sh
npm ci
npm run build
npm start
```

For UI hot reload use `npm run dev:ui` and configure the backend `PUBLIC_ORIGIN=http://localhost:5173`. API proxying is already configured. Run `npm run check` and `npm run test:e2e` after changes. The browser tests block cover images deliberately to verify local placeholders.

Do not add payment, accounts, subscriptions, tracking analytics, email sending or new cloud services. Keep deployment within the existing Render/Neon plan and the funded API budget. Preserve the requirements and update screenshots/tests when behaviour changes.
