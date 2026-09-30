# Evaluation evidence

## Completed locally

- TypeScript compilation and production UI build.
- Backend tests for integer-cent arithmetic, stock/quantity limits, quote expiry/invalidation, explicit confirmation, duplicate prevention, session isolation and expiry, source outage, input validation, provider failure, invalid tool arguments, atomic budget reservations and blocked calls after budget exhaustion.
- Desktop (1440 × 1000) and mobile (390 × 664 CSS viewport) Chromium browser journeys: recommendation → basket → quote → receipt; quantity changes invalidate quotes; edition details/source links; empty search and fresh session; layout screenshots/no horizontal overflow.
- Twenty guided offline customer scenarios; machine-readable report in `evaluation-offline.json`.
- Dependency audit following updates to patched dependencies.

Browser tests initially found an unnamed icon-only mobile basket control; this was fixed and the complete desktop/mobile set passed on rerun. The first backend run also preceded the UI build; after the build, the UI-serving check passed.

See `release-status.md` for final counts. Source, integration and browser tests verify application behaviour; mocked model responses do not establish live conversational quality.

## Live verification

The funded `claude-sonnet-5-5` integration was exercised against the shared Neon database. The 20-scenario suite covers greeting, undecided readers, gifts, categories, children, exact titles/ISBNs, missing titles, budget constraints, objections, comparisons, rejected suggestions, unavailable stock, cart edits and explicit checkout. Results are in `evaluation-live.json`; synthetic conversations and actual per-turn timings are in `evaluation-live-transcripts.json`. Scenario-level timing includes deliberate rate-limit pacing and must not be interpreted as response latency.

Transcript review found that the first passing run still made unsupported page-length comparisons and mistook a persistent budget filter for an empty category. Search tools now expose their effective filters, and the prompt explicitly forbids those inferences, asks for age-suitability uncertainty and exact titles, and avoids reciting every category. The final report is from the subsequent run: **20/20 automated scenarios passed**. Review confirmed correct budget-filter wording, explicit unverified age suitability, and an honest page-count comparison. Remaining quality exceptions: the History response altered “Capitalist Realism” and guessed that it was shorter; the unavailable-title response still referenced narrative features beyond the returned tags. These two scenarios are not counted as clean factual-grounding passes (18/20 in this engineering review). Structured cards retain authoritative titles, prices and stock. No fabricated price, stock or successful-order claim was observed in the reviewed final suite. This is an engineering review of synthetic scenarios, not an independent literary-quality assessment or a guarantee against hallucinations.

Reproduce against an AI-mode server:

```sh
EVAL_BASE_URL=http://localhost:3000 npm run eval -- --live
EVAL_BASE_URL=https://bookshop-assistant.onrender.com npm run eval:performance
```

Both commands consume the running server's shared allowance. Do not increase the cap automatically. The public UI was checked separately through add-to-basket → review quote → explicit confirmation → receipt, including its production session cookie and origin protections.

## Performance evidence

`performance-live.json` records thirty live turns across three concurrent, isolated visitor sessions on the public free Render service. Batches are paced to respect 12 chat requests per minute per IP. Timings measure the entire HTTP response, exclude pacing delays, and use nearest-rank percentiles over successful turns. The final run completed 30/30 with zero errors, p50 4.628 seconds and p95 8.366 seconds, under the 15-second target. `performance-initial.json` retains the earlier run (p95 10.365 seconds). Both reports identify the tested code commit and model.

These are warm-service measurements. Free-host cold starts were not benchmarked and can be substantially slower. This small workload establishes prototype feasibility, not a production throughput or availability guarantee.

The $10 cumulative application ledger is shared by local AI verification and the public service. It persists through deployments. The owner configured a separate $20 monthly Anthropic workspace cap with auto-reload disabled. The application stops further model calls at its lower allowance; browsing and manual demo checkout remain usable.

## Known limitations

The deterministic offline mode understands a small set of demo intents. It is not a general language model. Keyword search can miss vague or unusually phrased requests. Metadata is sparse and occasionally noisy; recommendations cannot responsibly supply unsupported plot/age claims. The single-instance session lock and in-memory IP throttling are prototype constraints. The public $10 allowance can be exhausted by visitors; provider caps remain necessary.

## Verification budget snapshot

At completion of paid verification, the shared ledger recorded **$2.338110 spent/accounted**, **$0 reserved**, and **$7.661890 remaining** from the $10 allowance. Public use after this snapshot changes the remaining amount. This includes both scenario runs, both concurrency runs and smoke tests.

## Accuracy release — source-backed responses

The two prose defects are now addressed at the output boundary rather than through additional prompt warnings. The AI selects edition IDs, fact names and subject indices. Exact titles and factual sentences are rendered by application code. Arbitrary prose, invented IDs, invalid evidence and unsupported comparisons are rejected; verified cards and an uncertainty notice remain available. Neutral follow-up questions cannot introduce unverified narrative details.

Regression coverage includes the altered title, missing page counts, unsupported narrative claims, malicious metadata, invalid references, previous-turn books and unstructured provider responses. The ten repeated live checks (five per original issue) are recorded in `accuracy-live.json`; all ten passed. The original prose-based evaluation findings above are retained as historical evidence, not as a description of the new response path.

## Discovery release acceptance

`discovery-live.json` records real Open Library lookups for The Dispossessed, Piranesi and A Wizard of Earthsea, source-attributed descriptions, exact ISBN lookup, paginated author results and a confirmed simulated purchase. The resulting order was retrieved after restarting the service against Neon. These source/API checks do not consume model tokens.

`discovery-ai-live.json` exercises nine live conversation turns: title, author, topic, ISBN, missing edition facts, child suitability and the complete conversational sale. Factual accuracy is reviewed separately from automated action assertions: names and prices come from saved records, subject statements are explicitly catalogue labels, missing pages/format and age suitability are stated as unknown. Source descriptions remain attributed UI text, not model-generated claims.

The initial exact-ISBN test exposed an ISBN-13 request whose correct source edition listed only its equivalent ISBN-10. Checksum-validated equivalence now handles this without substituting editions; a separate regression rejects wrong checksums and different ISBNs.

Backend checks now cover 55 cases, and desktop/mobile browser checks cover 10 journeys. Source-outage and missing-description cases use deterministic mocked responses; the real source acceptance validates actual returned records. A new uncached search can take longer than 15 seconds because source calls are serialized at one per second. The 15-second p95 goal applies to warm responses; the first uncached exploratory checks took up to 22.3 seconds. The final repeated discovery transcript benefited from persisted source caches.

The accuracy release's separate public measurement is retained in `performance-accuracy.json`: 30/30 turns, p50 3.840 s, p95 7.864 s. It was deployed and verified before discovery work began.

## Final public discovery evidence

Public source acceptance checks both the requested title and intended author before ordering; same-titled books by different authors do not count as the target edition. `discovery-live.json` contains the resulting source records and exact ISBN check. The UI separately confirmed a $12.99 purchase of Piranesi by Susanna Clarke; `screenshots/discovery-receipt.png` records the receipt.

`performance-discovery-initial.json` retains all 30 successful requests (three simultaneous visitors, ten turns each). Its p95 of 15.047 seconds missed the target; the first source-lookup batch took about 15 seconds. `performance-live.json` is a separate nine-request repeat of the first three turns with persisted caches: p50 4.564 seconds and p95 5.336 seconds, all successful. The smaller warm sample establishes the target for that workload only; first-time discovery is slower. No samples were removed from either report.

At the final paid-test snapshot, $5.395384 was accounted and nothing reserved, leaving $4.604616 of the original $10. Phase 1 used $1.544678; phase 2 used $1.451744. No spending reset, allowance increase or extra reviewer model call was used.
