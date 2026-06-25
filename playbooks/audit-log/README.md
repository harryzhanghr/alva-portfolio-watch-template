# Portfolio Watch Run Audit

Audit console template for a Portfolio Watch automation feed.

## What It Shows

- **Run Logs**: switch between official hourly push-pipeline cron runs. Future tagged runs show the full step-by-step processing record, including deterministic portfolio source ingest, prior state load, 1min / hourly market data fetch, current theme extraction, macro freshness, rate-repricing summary, external Breaking News feed read summary, Portfolio Watch mapping review summary, event/anomaly lane logic, analyst-call behavior, output summary, notification preview, and per-run persist delta. Each run detail exposes Search Expansion Trace, then the event lane as Raw Events, Event Candidates, and Qualified Events, plus the anomaly lane as Anomalies & Attributions. The Final Status Ledger shows the selected/suppressed/not_qualified state and reason for every final item. Raw Events and Event Candidates include an origin marker such as per-ticker source loop, rate repricing lane, external Breaking News feed, or Pi-reviewed portfolio mapping. For external breaking-news rows, future logs can also show feed event ids, feed timestamps, source links, source tickers/tags/classes, and mapping-review status so the analyst can distinguish the upstream event fact layer from Portfolio Watch's portfolio-specific relevance layer.
- **Historical cron rows**: pre-`runSource` runs are restored from cronjob deploy metadata. A historical row is labeled `full audit`, `decision-only`, or `platform-only` so the UI does not invent missing intermediate logs.
- **Persist Files**: switch between every tracked persisted output and inspect the latest version plus every recorded delta for that file, filtered to official cron runs and safely matched historical cron rows only.

## Data Sources

The playbook reads the feed configured in the HTML constants or URL query
parameters:

- `username` / `owner`: Alva username that owns the feed.
- `feed_name` / `feedName`: feed name, default `portfolio-watch-automation`.
- `feed_id` / `feedId`: optional numeric feed id for display.
- `cronjob_id` / `cronjobId`: optional cronjob id for historical-run labels.
- data root: `/alva/home/<username>/feeds/<feed_name>/v1/data`

The automation now writes two audit outputs:

- `audit.run_log`: one replayable run log row per automation run.
- `audit.persist_delta`: one delta row per persisted output or KV state target per run.

Current runtime note: portfolio ingest is code-side source access, not an Alva Ask call. Dynamic mode reads the connected-account API each run; static mode reads the configured ALFS portfolio file each run. The run log keeps this under `llmDecisionJson.portfolioReader` for backwards compatibility with older audit rows, and future rows should show `environment: Code`, `portfolioMode`, `positionCompleteness`, and the source call used. Pi Agent handles current theme extraction and external breaking-news portfolio mapping review. Alva Ask is expected for per-asset anomaly attribution agents when anomalies exist and the final analyst gate when candidates or anomalies require review.

Future portfolio rows use source quantity and cash plus Arrays latest 1min extended-hours price for valuation when `full_quantity` sizing is available, with explicit hourly/daily fallback only when 1min is missing. `ticker_only` rows keep quantity, market value, weight, NAV delta, and exposure percentages unavailable rather than estimating them. Source current price, source market value, average cost, realized P&L, and unrealized P&L are intentionally omitted from normalized context and persisted position rows. Older historical rows may still show the prior schema.

Future anomaly rows use `hourly_cumulative_volume_v3_us_equity_rth` for volume checks: US-listed equities/ETFs, including crypto-related equities, use regular-session cumulative volume through the latest regular-session hourly bar, capped at the 16:00 ET market close after hours. Direct 24/7 crypto assets use UTC-day cumulative volume. Older historical rows may still show prior current-hour or v2 extended-hours volume fields.

For option holdings, future anomaly rows should show the option contract as the holding `symbol` plus `marketDataSymbol` / `underlyingSymbol` for the underlying equity used to compute price and volume anomaly. Option contracts are not valued from the underlying equity price; this rule is only for anomaly attribution and per-ticker event mapping.

Future data-fetch summaries include `marketDataCoverage[].minuteBars`, `latestMinuteBarHkt`, `macroFreshness`, `rateRepricingSummary`, `breakingNewsSummary` with external feed path, rows read, deterministic mapped count, Pi reviewed count, parsed event count, raw event record count, and any warning/error. Older historical rows will show `n/a` or empty objects for those columns.

Current runtime note: breaking-news discovery is delegated to the configured external Breaking News feed, defaulting to `/alva/home/harryzz/feeds/breaking-news/v1/data/events/current`. Portfolio Watch reads that feed by millisecond `@range/<from>..<to>` lookback, with `@last/N` filtering fallback if range read fails. The upstream feed owns market-wide discovery, source expansion, event clustering, and source confidence. Portfolio Watch code pre-maps direct ticker, option-underlying, theme, and macro/risk-bucket relevance against the current portfolio. A Pi portfolio mapping review then checks those pre-maps and cross-checks remaining external events for source-grounded related holdings; this mapper does not search for news, use Brave, or decide push/no-push. Deterministic per-ticker rows still carry code-populated `sourceRelatedTickers` and `relatedHoldings` from the query/holding symbol.

Future run logs include `themeExtractionSummary` in data-fetch summary and `llmDecisionJson.themeExtractor`, so the audit can show whether current themes came from the per-run Pi Agent extraction or from continuity fallback.

Future event-candidate rows use a minimal code gate: same-run `duplicate` source records are dropped, but `new`, `updated`, and `seen_before` records can enter analyst review. Exact holding-symbol mapping is no longer required at this gate: broad macro/policy/risk rows may stay one portfolio-level candidate with empty `affectedSymbols[]`, `affectedThemes[]`, `riskFactors`, and `portfolioRelevanceBasis`. The run log should show `dedupeStatus`, first/last seen times, optional source timestamps, candidate counts, and whether a row is portfolio-level; semantic relevance, exposure impact, freshness, novelty, materiality, and weak X/theme/topic rows are analyst decisions, not deterministic pre-gates.

Future lane summaries should contain two separate review flows:

- Event flow: raw source records, including optional computed `technical_event` rows and `rate_repricing_event` / `rate_repricing_news` rows, become event-impact candidates after same-run duplicate removal. A candidate may be holding-linked or portfolio-level. The final Alva Ask analyst marks every event candidate as `selected`, `suppressed`, or `not_qualified`; qualified event assessments include exposure-impact analysis. `selected` is the final status of a qualified event assessment, not a separate fourth event-lane stage.
- Anomaly flow: current price or volume anomaly triggers create computed `asset_anomalies`, not candidates. Prior unchanged anomaly buckets do not block review. Each computed anomalous asset first gets a per-asset Alva Ask attribution packet; the final Alva Ask analyst converts those packets into final anomaly attribution findings and selected/suppressed status. Weak or unexplained attribution should be labeled rather than hidden as if the anomaly did not exist.

Portfolio delta, mark-to-market movement, and theme exposure changes are context in `portfolio_context`, not standalone candidates or final alert sections. Code no longer applies a separate deterministic repeat override after the Alva Ask analyst decision. If Alva Ask has managed tools available, the analyst prompt allows it to verify suspicious or stale submitted data before returning JSON. Future selected findings can include `decision_lens` with thesis impact, risk direction, key levels, scenarios, watch-next, and optional compliant action framing; this is final PM-note framing, while cohort/sector anomaly attribution remains upstream.

Future `priorAlertHistoryJson` rows represent the past-7-day user-visible run timeline. Empty runs show only the run time and `userReceivedPush=false`; pushed runs show the actual notification message and selected IDs. No-push/suppressed reasons stay auditable in decision/finding artifacts but are not sent back as prior alert history.

Future rows also write compact `rawEventsJson`, `eventCandidatesJson`, `qualifiedEventsJson`, `selectedEventsJson`, `anomaliesJson`, `anomalyAttributionPacketsJson`, `anomalyAttributionsJson`, `finalStatusesJson`, and `searchExpansionTraceJson` artifacts into both `analysis.decision` and `audit.run_log`. The Run Logs view therefore shows the exact normalized raw events used to build candidates, the long list, analyst-qualified event assessments, computed anomalies, per-asset anomaly attribution packets, final anomaly attributions, external feed read and mapping-review traces, and the final status/reason for every item without relying on large legacy JSON blobs. `selectedEventsJson` remains an internal/compatibility subset of qualified event findings used by the final notification decision; it is not displayed as a separate event-lane stage. Sent alerts should read as short PM notes: compact 2-3 sentence notes for single selected findings, or one bullet per finding when multiple findings are selected, with short link anchors and thesis/risk/key-level/watch-next framing. Historical rows that only have older `event.items` / `candidateSummaryJson` / `candidateAuditJson` fields are recovered best-effort when possible.

Manual verification rows are not shown as standalone cron runs. The visible run list is sourced from rows tagged `runSource=cron_push_pipeline`; optional historical deploy-run rows can be configured in `HISTORICAL_CRON_RUNS` when migrating an older private automation.
