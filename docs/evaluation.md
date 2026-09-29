# Evaluation evidence

## Completed locally

- TypeScript compilation and production UI build.
- Backend tests for integer-cent arithmetic, stock/quantity limits, quote expiry/invalidation, explicit confirmation, duplicate prevention, session isolation and expiry, source outage, input validation, provider failure, invalid tool arguments, atomic budget reservations and blocked calls after budget exhaustion.
- Desktop (1440 × 1000) and mobile (390 × 664 CSS viewport) Chromium browser journeys: recommendation → basket → quote → receipt; quantity changes invalidate quotes; edition details/source links; empty search and fresh session; layout screenshots/no horizontal overflow.
- Twenty guided offline customer scenarios; machine-readable report in `evaluation-offline.json`.
- Dependency audit following updates to patched dependencies.

Browser tests initially found an unnamed icon-only mobile basket control; this was fixed and the complete desktop/mobile set passed on rerun. The first backend run also preceded the UI build; after the build, the UI-serving check passed.

See `release-status.md` for final counts. Source, integration and browser tests verify application behaviour; mocked model responses do not establish live conversational quality.

## Still required for live release

No Anthropic key was available during implementation. Therefore there are **no live LLM evaluation results**, no measured live token costs and no validated warm AI latency/concurrency result. PostgreSQL cloud connectivity and Render deployment also require the owner’s accounts.

With the AI-mode server running and provider cap configured:

```sh
npm run eval -- --live
```

Use `EVAL_BASE_URL` to target the public deployment. The script verifies AI mode before proceeding, spaces requests to respect limits and uses the running server’s shared budget ledger. It writes `evaluation-live.json`. This is a paid run under the application/provider cap; stop rather than raising the cap automatically.

The automated rubric checks observable actions/cards, not literary judgement. Review the transcripts separately against:

1. Did the agent ask useful questions without interrogating the customer?
2. Were recommendations grounded in available facts and the visitor’s constraints?
3. Were uncertain age suitability, edition compatibility and missing descriptions acknowledged?
4. Were there any unsupported claims about prices, availability, content or successful orders?
5. Did the agent handle refusals, rejection and budget changes respectfully?
6. Did every successful order have an explicit user confirmation and backend receipt?

Target at least 18/20 live scenarios passing and zero fabricated commerce facts. Budget exhaustion is a failed/incomplete evaluation, not a pass.

## Performance procedure

After warming the service, run thirty ordinary chat turns distributed across three isolated sessions, respecting the public rate limit. Measure request start to final structured result, error rate, provider token usage and reservation/spend totals. Report p50/p95 and model/version. Target p95 ≤15 seconds; report any miss rather than increasing resources silently. Measure cold starts separately and do not mix them into warm latency.

## Known limitations

The deterministic offline mode understands a small set of demo intents. It is not a general language model. Keyword search can miss vague or unusually phrased requests. Metadata is sparse and occasionally noisy; recommendations cannot responsibly supply unsupported plot/age claims. The single-instance session lock and in-memory IP throttling are prototype constraints. The public $10 allowance can be exhausted by visitors; provider caps remain necessary.
