# Release status

Updated 30 September 2026 (Asia/Qatar).

- **Live demo:** https://bookshop-assistant.onrender.com
- **Repository:** https://github.com/omarcoding2002/bookshop-assistant
- **Requirements and diagram:** [requirements.md](requirements.md)

| Deliverable                   | Status                                                                                    |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| Conversational AI             | Funded Claude Sonnet 5.5 integration verified                                             |
| Real book metadata            | 97 curated editions plus persistent live Open Library discovery                           |
| Public hosting                | Render free web service, Frankfurt; Neon PostgreSQL, Frankfurt                            |
| Commerce                      | Conversational basket/quote and explicit simulated order confirmation                     |
| Public UI purchase            | Browser verified quote, confirmation, itemized receipt and $12.99 demo total              |
| Backend checks                | 55 passing tests and successful production build                                          |
| Desktop/mobile checks         | 10 passing Chromium browser tests in CI                                                   |
| Offline evaluation            | 20/20 guided scenarios passed                                                             |
| Live evaluation               | 20/20 live scenarios; 10/10 repeated accuracy checks; server-rendered catalogue facts     |
| Concurrency/latency           | 30/30 public live turns, three visitors; accuracy release: p50 3.840 s, p95 7.864 s       |
| Continuous delivery           | GitHub Actions checks gate Render deployments from main                                   |
| Requirements/architecture/API | Included with setup, data/price decisions and UI handoff                                  |
| Secrets                       | Loaded privately into service environment; no credential values found in Git history scan |

No further account setup is needed to use this release. Claude Code is optional for later UI changes; the current UI is implemented and tested.

## Cost and operating limits

The app enforces a **$10 cumulative model allowance**, stored in Neon and shared by verification and public visitors. The owner's separate Anthropic workspace has a $20 monthly cap and auto-reload disabled. Do not reset the database budget or raise either limit without owner authorization. The accuracy phase used $1.544678 (ledger increased from $2.398962 to $3.943640). Discovery verification has a separate maximum $2 allocation within the unchanged $10 total; final evidence records the completion snapshot. Recorded usage is an application estimate based on provider token counts and configured rates, not a billing invoice; uncertain failures consume conservative reservations.

Both hosting services remain on free plans. Cold starts can delay the first visit. This is an English/USD prototype with fictional prices/stock and no payment or fulfilment. Live discovery is enabled only after source, exact-ISBN, persistence and checkout acceptance checks pass. All records retain Open Library provenance. The public can consume the remaining model allowance; once exhausted, manual browsing and demo checkout remain available.

See [evaluation.md](evaluation.md) for test methodology, reviewed quality issues and limitations.

## Discovery release

Local acceptance covers three titles outside the seed, exact ISBN preservation, three source descriptions, pagination, and a confirmed new-edition order that survived process restart. Backend tests cover source outages, cache/coalescing/throttle, missing metadata, work-only results, persisted offers and price freezing. Desktop/mobile browser tests cover explicit search submission, pagination, escaped source descriptions and checkout. See `discovery-live.json` and `discovery-ai-live.json`. Public deployment and warm-response verification are recorded after promotion.
