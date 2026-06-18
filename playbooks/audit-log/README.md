# Portfolio Watch Run Audit

Audit console template for a Portfolio Watch automation feed.

## What It Shows

- **Run Logs**: switch between official hourly push-pipeline cron runs. Future tagged runs show the full step-by-step processing record, including deterministic portfolio API ingest, prior state load, 1min / hourly market data fetch, current theme extraction, macro freshness, indexed-X discovery summary, Pi event-search loop, Pi theme-topic mapping, Pi `searchArraysMarketNewsTopic` tool calls, event/anomaly lane logic, analyst-call behavior, output summary, notification preview, and per-run persist delta. Each run detail exposes Search Expansion Trace, then the event lane as Raw Events, Event Candidates, and Qualified Events, plus the anomaly lane as Anomalies & Attributions. The Final Status Ledger shows the selected/suppressed/not_qualified state and reason for every final item. Raw Events and Event Candidates include an origin marker such as per-ticker source loop, Pi market-breaking search, Pi theme search, or Pi-mapped Arrays topic news. For indexed-X breaking-news rows, future logs can also show `sourceTweetId`, `sourceTweetUrl`, `sourceTweetRank`, `sourceTweetEngagementScore`, and `sourceEventTime` / `sourceEventAtMs` so the analyst can distinguish a fresh X post from an older official / primary source event.
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

Current runtime note: portfolio ingest is code-side connected-account API access, not an Alva Ask call. The run log keeps this under `llmDecisionJson.portfolioReader` for backwards compatibility with older audit rows, but future rows should show `environment: Code` and `call: fetchPortfolioSummary(ACCOUNT_ID)`. Alva Ask is only expected for the analyst gate when candidates require review.

Future portfolio rows use connected-account quantity and cash plus Arrays latest 1min extended-hours price for valuation when available, with explicit hourly/daily fallback only when 1min is missing. Broker current price, broker market value, average cost, realized P&L, and unrealized P&L are intentionally omitted from normalized context and persisted position rows. Older historical rows may still show the prior schema.

Future anomaly rows use `hourly_cumulative_volume_v3_us_equity_rth` for volume checks: US-listed equities/ETFs, including crypto-related equities, use regular-session cumulative volume through the latest regular-session hourly bar, capped at the 16:00 ET market close after hours. Direct 24/7 crypto assets use UTC-day cumulative volume. Older historical rows may still show prior current-hour or v2 extended-hours volume fields.

For option holdings, future anomaly rows should show the option contract as the holding `symbol` plus `marketDataSymbol` / `underlyingSymbol` for the underlying equity used to compute price and volume anomaly. Option contracts are not valued from the underlying equity price; this rule is only for anomaly attribution and per-ticker event mapping.

Future data-fetch summaries include `marketDataCoverage[].minuteBars`, `latestMinuteBarHkt`, `macroFreshness`, `breakingNewsSummary` with `indexedXDiscovery`, Pi agent tool calls, `themeNewsSummary` from the same Pi event-search loop plus Pi `searchArraysMarketNewsTopic` calls, parsed event count, raw event record count, and any warning/error. Older historical rows will show `n/a` or empty objects for those columns.

Current runtime note: breaking-news discovery starts in code with Arrays indexed X, not Grok query search. Code calls `/api/v1/social-feeds/x/search` without `q` over the latest 90-minute indexed window, pages backward up to 5 pages of 200 original/quote tweets, ranks unique window rows by engagement, and supplies up to 25 top tweets to Pi. Pi reviews only those supplied hot tweets for market-breaking eligibility. Brave `source_expansion` uses `result_filter="web"` and is allowed only after a supplied indexed-X tweet qualifies; it should look for the original / official source first, then the earliest credible media/source link if official is unavailable. Theme/industry source coverage starts inside the same Pi event-search agent: Pi receives current holdings, current themes, supported Arrays market-news topics, and a 1,000,000-character context cap; Pi maps every current portfolio theme to supported `topic` values or `no_supported_topic`, calls `searchArraysMarketNewsTopic` itself when useful, reads source text/summary/content from tool rows, and returns holding-linked events or portfolio-level macro/policy/risk events. Source-returned tickers are audit/context only, not automatic affected holdings. Pi can still use Brave as supplemental theme discovery, stored as `theme_news`.

Future run logs include `themeExtractionSummary` in data-fetch summary and `llmDecisionJson.themeExtractor`, so the audit can show whether current themes came from the per-run Alva Ask extraction or from continuity fallback.

Future event-candidate rows use a minimal code gate: same-run `duplicate` source records are dropped, but `new`, `updated`, and `seen_before` records can enter analyst review. Exact holding-symbol mapping is no longer required at this gate: broad macro/policy/risk rows may stay one portfolio-level candidate with empty `affectedSymbols[]`, `affectedThemes[]`, `riskFactors`, and `portfolioRelevanceBasis`. The run log should show `dedupeStatus`, first/last seen times, optional source timestamps, candidate counts, and whether a row is portfolio-level; semantic relevance, exposure impact, freshness, novelty, materiality, and weak X/theme/topic rows are analyst decisions, not deterministic pre-gates.

Future lane summaries should contain two separate review flows:

- Event flow: raw source records become event-impact candidates after same-run duplicate removal. A candidate may be holding-linked or portfolio-level. Alva Ask then marks every event candidate as `selected`, `suppressed`, or `not_qualified`; qualified events receive exposure-impact analysis, and selected events become notification candidates.
- Anomaly flow: current price or volume anomaly triggers create computed `asset_anomalies`, not candidates. Prior unchanged anomaly buckets do not block review; Alva Ask attributes each anomaly when possible, and weak/unexplained attribution should be labeled rather than hidden as if the anomaly did not exist.

Portfolio delta, mark-to-market movement, and theme exposure changes are context in `portfolio_context`, not standalone candidates or final alert sections. Code no longer applies a separate deterministic repeat override after the Alva Ask analyst decision. If Alva Ask has managed tools available, the analyst prompt allows it to verify suspicious or stale submitted data before returning JSON.

Future `priorAlertHistoryJson` rows represent the past-7-day user-visible run timeline. Empty runs show only the run time and `userReceivedPush=false`; pushed runs show the actual notification message and selected IDs. No-push/suppressed reasons stay auditable in decision/finding artifacts but are not sent back as prior alert history.

Future rows also write compact `rawEventsJson`, `eventCandidatesJson`, `qualifiedEventsJson`, `selectedEventsJson`, `anomaliesJson`, `anomalyAttributionsJson`, `finalStatusesJson`, and `searchExpansionTraceJson` artifacts into both `analysis.decision` and `audit.run_log`. The Run Logs view therefore shows the exact normalized raw events used to build candidates, the long list, analyst-qualified events, computed anomalies, anomaly attributions, indexed-X / Brave / Arrays topic search traces, and the final status/reason for every item without relying on large legacy JSON blobs. `selectedEventsJson` remains an internal/compatibility subset of qualified event findings used by the final notification decision; it is not displayed as a separate event-lane stage. Historical rows that only have older `event.items` / `candidateSummaryJson` / `candidateAuditJson` fields are recovered best-effort when possible.

Manual verification rows are not shown as standalone cron runs. The visible run list is sourced from rows tagged `runSource=cron_push_pipeline`; optional historical deploy-run rows can be configured in `HISTORICAL_CRON_RUNS` when migrating an older private automation.
