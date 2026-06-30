# Portfolio Watch Automation Spec

## Overview

This playbook documents a configurable portfolio watch automation as a plain-language runbook. It explains the hourly pipeline step by step for a reader who does not want to read source code: how the automation reads a dynamic connected portfolio or static portfolio file, marks positions with latest available market data where sizing exists, computes asset anomalies, reads the external Breaking News feed, reviews those events against the current portfolio, runs one per-asset anomaly attribution agent for every computed anomalous asset, runs a low-noise final analyst decision gate, and persists both push and no-push decisions for audit.

## Data Sources & Freshness

- Portfolio source: `env.args.portfolioMode` is `dynamic` or `static`. Dynamic mode reads one or more user-supplied account ids from `env.args.accountIds` / `env.args.connectedAccountIds` / `env.args.portfolioAccountIds`, with `env.args.accountId` / `env.args.connectedAccountId` still supported for single-account setups, through the read-only Alva connected-account portfolio API. If more than one account is configured, holdings and cash are aggregated into one portfolio before downstream analysis. Static mode reads the configured ALFS JSON file from `env.args.staticPortfolioPath`. Static holdings stay unchanged until setup/update writes a new file.
- Position completeness: `env.args.positionCompleteness` is `full_quantity` or `ticker_only`. Dynamic mode is always `full_quantity`. Full-quantity portfolios can compute current market value, weights, NAV deltas, and exposure percentages when market data coverage exists. Ticker-only portfolios can monitor held tickers, themes, price/volume anomalies, and event mappings, but must not invent position weights, market value, NAV, or exposure percentages.
- Source-field policy: code uses holdings, side, quantity/cash when available, and source as-of timestamp. Source current price, source market value, average cost, realized P&L, and unrealized P&L are intentionally not used as context.
- Equity daily bars: Arrays `/api/v1/stocks/kline`, `interval=1d`, roughly 90 bars when technical events are disabled and up to 260 bars when they are enabled. Used for previous regular-session close, completed daily move context, 5D move, daily-return z-score, daily volume context, and technical-event detectors.
- Equity 1min bars: Arrays `/api/v1/stocks/kline`, `interval=1min`, `session=ETH`, roughly 36 hours / 2400 bars. Used as the primary latest-price source for portfolio valuation and price anomaly, including premarket / regular / after-hours when available.
- Equity hourly bars: Arrays `/api/v1/stocks/kline`, `interval=1h`, `session=ETH`, roughly 120 bars over about 35 days. Used for US regular-session cumulative volume-to-now / market-close versus historical same-point baselines. It is price fallback only if 1min coverage is missing.
- Market news: Arrays `/api/v1/stocks/market-news`, per current holding's `marketDataSymbol`, with an hourly event search window plus overlap. For option holdings, `marketDataSymbol` is the underlying equity, not the option contract symbol.
- Analyst / price target news: Arrays `/api/v1/stocks/company/price-target-news`, per current holding's `marketDataSymbol`, with a wider lookback. Used for upgrades, downgrades, target-change style event records.
- Earnings calendar: Arrays `/api/v1/stocks/earnings-calendar`, per current holding's `marketDataSymbol`. Used to detect upcoming or changed earnings event exposure.
- Technical events: deterministic OHLCV detectors can append `technical_event` rows for breakout/breakdown, support/resistance bounce or rejection, RSI threshold crosses, moving-average crosses, and volume-confirmed price moves. They are configurable through `technicalEvents.enabled`, `technicalEventDetectors`, and `technicalEventMinSeverity`; when disabled, they do not enter the event lane.
- Rate repricing lane: Polymarket public market data checks the next three Fed decision markets, compares current probability with 24 hours earlier, and appends `rate_repricing_event` rows when the probability move crosses `rateRepricingEvents.probabilityChangeThresholdPct`. If material repricing is found, the lane adds up to three `rate_repricing_news` rows from recent market commentary. Market volume, liquidity, and open-interest fields are passed through for analyst judgment. The only lane config is `rateRepricingEvents.enabled` and `rateRepricingEvents.probabilityChangeThresholdPct`.
- Dynamic theme extraction: a Pi Agent receives the current marked portfolio snapshot every run and returns current holding themes used for theme exposure context, analyst exposure-impact reasoning, and theme-news search. `priorThemes` are only weak continuity hints; the current run's extracted themes are supplied to downstream event mapping before event analysis.
- External Breaking News feed: code reads the configured full event stream
  (`~/feeds/breaking-news/v1/data/events/current` by default, resolved under
  the deploying Alva user) over the configured lookback using
  `@range/<fromMs>..<toMs>`.
  The upstream feed already handles market-wide discovery, source expansion,
  event clustering, source confidence, and event fields such as
  `tickersMentionedJson`, `marketTagsJson`, and `assetClassesJson`. Portfolio
  Watch code first pre-maps direct ticker, option-underlying, theme, and
  macro/risk-bucket relevance. A bounded `@alva/pi` portfolio mapping review
  then checks whether those code mappings are wrong and cross-checks remaining
  external events against current holdings for source-grounded direct, peer,
  supplier/customer, option-underlying, or high-confidence second-order /
  value-chain relations. This Pi mapper does not search for news, use Brave, or
  decide push/no-push.
- Macro context: Arrays macro endpoints for SPX, Nasdaq, VIX, oil, and treasury rates. Each row includes `sourceDate`, `sourceAgeHours`, and `fetchedAtHkt` so analyst can judge relevance/freshness before using it as attribution context.
- Schedule: the automation runs hourly. A run does not imply a notification. Quiet runs persist the skip sentinel `<|SKIP_NOTIFICATION|>`.
- Freshness rule: price anomaly uses latest 1min extended-hours price when it is newer than the last completed daily close. `oneDayPct` then means latest 1min price vs previous regular-session close. `lastClosedOneDayPct` is kept only as completed-close context.
- Option rule: option holdings keep the option contract as `holding.symbol`, but price anomaly, volume anomaly, and per-ticker event search use the underlying equity as `marketDataSymbol`. The option contract is not valued from the underlying stock price.

## Event Source Fetch Details

For every current holding, Node 3 first resolves `marketDataSymbol`: ordinary US equities/ETFs use their own ticker; option contracts use the parsed underlying equity. Then it runs the same source loop:

- Market news calls `/api/v1/stocks/market-news` for `marketDataSymbol` with the Node 2 event window, published-time descending sort, and `limit=50`.
- Analyst / price-target news calls `/api/v1/stocks/company/price-target-news` for `marketDataSymbol` from `fetchStartSec - 5 days` through the run end, with `limit=50`.
- Earnings calendar calls `/api/v1/stocks/earnings-calendar` for `marketDataSymbol` from 7 days before now through 45 days after now. These rows carry `eventAtMs`; they usually do not carry a source published timestamp.
- When enabled, technical analysis computes `technical_event` source rows from the same per-holding OHLCV packet. These rows use `sourceOrigin=computed_technical_analysis`, carry indicator/level context in the summary and metadata, and map back to the current holding just like other per-ticker source rows.
- Per-ticker market-news, analyst, and earnings rows carry code-populated `sourceRelatedTickers` from the query/vendor ticker fields and `relatedHoldings` from the current holding. Option rows use `relation=option_underlying` when the fetched `marketDataSymbol` is the underlying equity.
- Each mapped source row is appended to `rawEvents[]`. This does not mean it is push-worthy or even candidate-approved; it only means the source was fetched and normalized for downstream gates.
- Macro context is fetched once per run after holdings are marked and current themes are extracted. Macro rows are stored with source/fetch timestamps.
- Rate repricing is fetched once per run after macro context: prediction-market rows become `rate_repricing_event`, and explanatory market commentary becomes `rate_repricing_news`. Both enter the same global normalization and dedupe path as other raw events.
- External breaking-news mapping runs after the per-holding source loop,
  latest-price marking, and current dynamic theme extraction. Code reads the
  configured Breaking News feed over the breaking-news lookback, parses source
  tickers/tags/classes plus source evidence from primary source, `sourcesJson`,
  and `xCandidatesJson`, and pre-maps direct ticker, option-underlying, theme,
  and macro/risk-bucket relevance. Pi then reviews those deterministic mappings
  and cross-checks remaining external events for source-grounded related
  holdings. This Pi step has no search tools and does not create new news events.

For external breaking-news rows, `reportedAt` / `sourceEventTime` is the
upstream feed's event time, `observedAt` is when that feed first created the
event, and `updatedAt` is when it last merged evidence. Downstream gates still
judge portfolio materiality, freshness versus prior user alerts, and whether a
portfolio-level macro/policy/risk event is useful without an exact holding
symbol.

## How This Playbook Works

The page is organized as nodes that mirror the production automation:

- Node 0 defines runtime config, output schemas, thresholds, fallback theme map, aliases, schema versions, and notification sentinel.
- Node 1 reads the configured portfolio source in code, validates the returned `holdings[]` or `tickers[]`, and normalizes it into an unpriced portfolio snapshot. Dynamic mode may read multiple connected accounts and aggregate same-symbol holdings plus cash before later nodes run. Source price, market value, cost, and P&L fields are dropped before context or persistence.
- Node 2 loads prior KV state: last snapshot, last run time, event index, user-visible alert timeline, finding history for persistence/audit updates, and prior anomaly signals. The analyst packet receives the past-7-day user-visible run timeline, not prior findings or no-push suppression reasoning.
- Node 3 loops through each current holding, resolves `marketDataSymbol`, and fetches daily bars, latest 1min bars, hourly bars, and per-holding event sources from that symbol. For options, this means the underlying equity. This node does not run X search.
- Node 4 computes price and volume anomaly metrics, marks holdings to Arrays latest price, recomputes market value/weights only when `full_quantity` sizing exists, and calls a Pi Agent once to extract current holding themes from the latest marked portfolio. US-listed holdings and US equity options use hourly regular-session cumulative volume up to the latest regular-session bar, capped at the 16:00 ET market close after hours, compared with historical median cumulative volume at the same point of the trading day. Direct crypto assets use UTC-day cumulative volume.
- Node 5 fetches timestamped macro context, checks rate repricing for the next
  three Fed decisions, reads the external Breaking News feed, pre-maps direct
  ticker/theme/macro relevance, preserves feed source evidence, and runs a Pi
  portfolio mapping review for source-grounded related holdings. The node also
  normalizes event records with dedupe status.
- Node 6 builds two separate lane inputs: event-impact candidates from all non-duplicate event records, including portfolio-level macro/policy/risk/rate-repricing events with no exact holding symbol, and computed `asset_anomalies` from current price/volume anomaly triggers. Portfolio delta and theme-exposure change are context only, not candidates.
- Node 7 loops through every computed asset anomaly and calls one Alva Ask Anomaly Attribution Agent for that asset. The agent receives the computed anomaly, holding context, related event records with source evidence when available, related event candidates, macro context, top portfolio context, and prior user-visible alert history. It should use the Skill Hub why-the-move methodology when available and return an attribution packet with status, driver split, supporting events, confidence, and data-quality notes. This node does not decide push/no-push.
- Node 8 builds the final analyst packet and prompt, calls Alva Ask only when event candidates or anomalies exist, validates the JSON response, and decides push vs no-push. Alva Ask keeps event exposure impact and anomaly attribution as separate flows and final message sections. It qualifies event candidates, estimates event exposure impact itself from the supplied portfolio snapshot and theme context, converts anomaly attribution packets into final anomaly-attribution findings, records the final status/reason for every item, and adds a `decision_lens` to selected findings with thesis impact, risk direction, key levels, scenarios, watch-next items, and optional compliant action framing.
- Node 9 persists all audit outputs and KV state, including quiet no-push decisions.

## Execution Environments

- Most nodes are deterministic runtime code: config load, Arrays/Polymarket API calls, price and volume calculations, event normalization, dedupe, candidate construction, table appends, and KV writes.
- The production implementation has two Pi Agent call types through `@alva/pi`:
  - Theme extraction: code calls `agent.ask(buildThemeExtractionPrompt(snapshot, previous))` every run after latest-price marking. It receives supplied portfolio JSON only, uses no tools, and returns themes for current holdings.
  - External breaking-news portfolio mapping: code reads already source-expanded external events, preserves their source evidence, and pre-maps obvious direct ticker, option-underlying, theme, and macro/risk-bucket relevance. Pi reviews code's deterministic mapping, removes wrong links, and adds source-grounded direct, peer, supplier/customer, option-underlying, or high-confidence second-order/value-chain related holdings when supported. It does not search for news, call Brave, expand sources, or decide push/no-push.
- The production implementation has two Alva Ask (LLM) call types through `@alva/alvaask`:
  - Per-asset anomaly attribution: code loops over computed `asset_anomalies` and calls `ask(buildAnomalyAttributionPrompt(anomalyInput), { effort: "high" })` once per anomalous asset. The prompt asks the agent to use the Skill Hub why-the-move methodology when available, inspect related source evidence/source text, verify stale or thin facts with available tools when useful, and return attribution JSON only. These packets are analysis inputs, not final findings.
  - Final analyst gate: code calls `ask(buildAnalystPrompt(analystInput))` whenever event-impact candidates or computed asset anomalies exist. First run is context in `portfolio_context.current_portfolio_delta.firstRun`, not an automatic skip. The final analyst now acts as a low-noise PM note generator: selected findings include `decision_lens`, and `notification_message` chooses a compact single-finding note or one bullet per finding for multiple selected findings, with short-link anchors and explicit thesis/risk, key levels, and watch-next.
- Portfolio reading is deterministic code, not an LLM call: dynamic mode calls the connected-account portfolio API with `X-Alva-Api-Key` auth once per configured account id and aggregates the results; static mode reads the configured ALFS JSON file. The run requires usable `holdings[]` or `tickers[]`.
- The final analyst gate does not use Pi or ADK and does not run a separate reflection/self-retry loop. It is still an Alva Ask call; if Alva Ask has managed tools available, the prompt permits it to verify suspicious or stale facts before returning JSON.
- Market data, per-holding event source fetch, anomaly trigger calculations,
  external breaking-news feed reads, deterministic pre-mapping, candidate
  construction, and persistence are owned by code. Pi owns only the
  external-breaking event-to-portfolio mapping review. The per-asset Anomaly
  Attribution Agent owns first-pass why-the-move analysis for computed
  anomalies. Event exposure impact sizing, novelty judgment, final anomaly
  wording, and final selected/suppressed decisions are owned by the final Alva
  Ask analyst.
- The analyst packet is intentionally bounded: recent event records are capped
  at 100 records, review candidates are capped at 50 items, recent alert
  history is included, persisted finding history is not sent to the analyst,
  and the compact prompt JSON is capped at 1,000,000 characters. The Pi
  external-breaking mapping context JSON is also capped at 1,000,000 characters
  so current holdings, themes, source evidence, and source text are visible for
  mapping.
- Completion is checked by code: portfolio JSON must parse and include holdings; analyst JSON must parse and is normalized into stable finding/decision objects. Code no longer applies a separate deterministic repeat override after the analyst decision.

## Alva Ask Prompt

The playbook page includes expandable prompt panels inside the original flow nodes, not in a separate agentic-environment node:

- Node 4 prompt panel: shows the theme-extraction prompt used to classify current holdings into dynamic themes.
- Node 7 prompt panel: shows the per-asset anomaly-attribution prompt. Code builds one prompt per computed anomalous asset, sends it to Alva Ask, and parses one attribution packet per asset.
- Node 8 prompt panel: shows the final analyst gate prompt. Code builds the prompt, sends it to Alva Ask, and parses and normalizes the JSON response.
- The analyst prompt template ends with `compactJson(analystInput, CONFIG.maxAnalystPromptChars)`, currently `1,000,000` characters. The page shows the placeholder, not any private run's raw portfolio packet.

### Node 7 Anomaly Attribution Agent Prompt Contract

For each computed anomaly, code builds one Alva Ask prompt with this plain-language contract:

- Role: "You are a per-asset Anomaly Attribution Agent for a portfolio watch automation."
- Mission: explain one computed held-asset anomaly before the final portfolio analyst writes the user message.
- Method: use Skill Hub why-the-move methodology when available, `skill_id = carl-2/discord-why-the-move`. If the tool path is not exposed, apply the same method directly: separate market, sector, and asset-specific drivers; test timing, direction, and size; require sourced support; do not invent catalysts.
- Scope: attribution only, not push/no-push.
- Verification: use available tools if the supplied anomaly packet looks stale, wrong, or too thin.
- Causality rule: a current event is not automatically the cause. It must fit timing, direction, and size. If attribution is not strong, return `weak_correlation` or `unexplained` and say the best grounded guess clearly as a guess.
- Output: JSON only, including `anomaly_id`, `symbol`, `market_data_symbol`, `headline`, `summary`, `attribution_status`, `driver_split`, `supporting_events`, `source_links`, `data_quality_notes`, `confidence`, and `as_of_hkt`.

The input packet includes:

- `anomaly`: the computed price/volume anomaly object.
- `holding`: current holding context, weight, current value, themes, and instrument metadata.
- `related_event_records`: source/event records that may be relevant to the anomaly.
- `event_candidates_for_context`: event candidates that overlap by symbol, theme, or portfolio-level risk factor.
- `portfolio_snapshot_context`: total value, cash, valuation basis, and top holdings.
- `macro_context`: fetched macro rows with source/fetch timestamps.
- `prior_alert_history`: past-7-day user-visible run timeline.

The attribution packet is stored and then passed to the final Analyst. It is not a final finding and does not decide whether the user sees a notification.

### Node 8 Final Analyst Prompt Contract

The final analyst prompt is intentionally shorter than a full debug spec. It asks Alva Ask to:

- decide whether the run is worth interrupting a discretionary investor now;
- prepare accurate data analysis for any selected event or anomaly attribution;
- write the user-ready notification message;
- treat event candidates as a long list that must become `selected`, `suppressed`, or `not_qualified` with a reason;
- estimate event exposure impact inside event findings;
- use per-asset anomaly attribution packets as the starting point for anomaly findings, while treating computed held-asset anomalies as objective portfolio signals even when attribution is weak;
- avoid repeats using only user-visible prior alert history, not prior suppressed reasoning;
- use available tools when submitted facts look wrong, stale, or worth deeper confirmation;
- write concise user-facing copy without internal workflow words.

## Persisted Outputs

- `portfolio.snapshot`: portfolio mode, position completeness, ingest source, Arrays-current portfolio value when available, cash, cash allocation, top holdings, priced/unpriced coverage, portfolio delta JSON, theme exposure JSON, coverage warnings, full snapshot JSON, source and run timestamps.
- `portfolio.positions`: one row per holding with portfolio mode, position completeness, quantity when available, Arrays current price, market value/weight when sizing exists, instrument details, current-run dynamic themes, and `positionSizeAvailable`. Cost basis and P&L fields are not persisted.
- `event.items`: normalized source records with stable key, source type, searched/attached symbol, title, summary, URL, source, dedupe status, metadata, and seen timestamps. Indexed-X breaking-news metadata may include `sourceTweetId`, `sourceTweetUrl`, `sourceTweetRank`, `sourceTweetEngagementScore`, and `sourceEventTime` / `sourceEventAtMs`; the latter is the original / official or earliest credible source time used by the analyst to distinguish a fresh X post from an older source event. This table is an audit trail of fetched source records, not the final candidate-approved list of portfolio-relevant events. Future run-level audit reads the exact compact `normalizedEvent.records` packet from `rawEventsJson`, with `event.items` as historical/source-table fallback.
- `finding.records`: normalized event-impact and anomaly-attribution findings with dedupe keys, selection status, suppression reason, and payload JSON.
- `analysis.decision`: final alert decision, urgency, reason, skip reason, selected and suppressed finding IDs, two message sections (`event_exposure_impacts` and `anomaly_attributions`), notification body when pushed, portfolio context, prior user-visible alert timeline, exact compact raw events used for candidate building, explicit event candidates, qualified event assessments, selected-event compatibility subset, computed anomalies, anomaly attribution packets, final anomaly attributions, final status ledger, compact `searchExpansionTraceJson`, legacy full candidate summary, compact `candidateAuditJson`, compact `anomalySignalsJson`, and raw analyst JSON.
- `notify.message`: push sidecar. Quiet runs write `<|SKIP_NOTIFICATION|>`.
- KV state: `lastSnapshot`, `lastRunAtMs`, `lastPriceSignals`, `eventIndex`, `alertHistory` as the user-visible run timeline, `findingHistory`, `lastDecision`, and `nextRunContext`.

## Key Computation Rules

- Portfolio deltas distinguish real action from valuation movement. Quantity and cash changes are action-material. Mark-to-market changes are attribution context unless they also satisfy other event gates.
- Portfolio valuation is cash plus the sum of `quantity x Arrays latest 1min price` for priced holdings when `full_quantity` sizing exists, with hourly/daily as explicit fallback only when 1min is unavailable. It does not use source total value or source market value as a fallback. In `ticker_only` mode, valuation, weights, NAV deltas, and exposure percentages remain unavailable.
- The valuation price and anomaly current price are the same selected field: `priceSignals.latestPrice`. Node 4 chooses it from 1min bars when available; Node 5 only consumes it.
- Option contracts are not priced from the underlying equity. They may have `marketDataSymbol`/`underlyingSymbol` for anomaly and event attribution, but remain unpriced in portfolio valuation until an option-specific valuation source is added.
- Cost basis, realized P&L, and unrealized P&L are out of scope in this version because broker definitions are not stable enough across providers and tax-lot/accounting methods.
- Price anomaly triggers are based on `oneDayPct` and return z-score. Current 1D movement uses latest 1min extended-hours price versus the previous regular-session close when newer 1min data exists. For options, this is the underlying equity's latest 1min price versus its previous regular-session close. `fiveDayPct` is retained as context only and does not trigger an anomaly.
- Volume anomaly triggers are based on `cumulativeVolumeMultiple`: current-day hourly cumulative volume divided by historical median cumulative volume at the same point of the day. For US-listed equities/ETFs and options on US equities, theme does not change the market structure: crypto-related equities still use the US regular session and market-close cap. The old current-hour multiple and current-hour z-score triggers are not used.
- Anomaly attribution is asset-level. If either price or volume triggers fire for a held asset, code first creates one computed anomaly for that asset. Node 7 then runs one per-asset Alva Ask Anomaly Attribution Agent for that anomaly. The final analyst receives the attribution packet and should produce one final attribution for that asset, not separate price and volume narratives. Weak or unexplained attribution should be labeled with a watch-next rather than suppressed solely because attribution is incomplete.
- Exposure estimates are not computed as a code step. Alva Ask estimates direct and related portfolio exposure impact inside event-impact findings only when `portfolio_capabilities.canComputeExposurePct` is true. In `ticker_only` mode, the analyst may describe affected holdings/themes but must not invent percentages. Exposure still must not be used to explain anomalies.
- Repeated push suppression is not a deterministic post-analyst code override. Prior alert history is passed to Alva Ask, while finding history remains persisted for audit/state continuity. The analyst decides whether a repeated narrative has enough new event information or stronger attribution to justify a push.

## Event Normalize vs Candidate Gate

The automation has three separate stages that are easy to confuse:

1. `rawEvents[]`: source records fetched from per-holding event sources, technical analysis, rate repricing, and the external Breaking News feed, including `technical_event`, `rate_repricing_event`, `rate_repricing_news`, and Pi-reviewed external `breaking_news` rows.
2. `event.items`: normalized/deduped source records. These rows can be `new`, `updated`, `seen_before`, or `duplicate`.
3. Event-impact candidates: non-duplicate normalized source records. They can be `new`, `updated`, or `seen_before`. Per-holding source rows use deterministic code-populated `relatedHoldings` from the query/holding symbol; Pi rows use Pi-returned `related_holdings[]` for `affectedSymbols[]` only when code classifies the relation as holding-level, including high-confidence second-order/value-chain transmission. Context-only `theme_readthrough` stays audit-only. Broad macro/policy/risk/theme rows may become one portfolio-level candidate with `affectedSymbols: []`, `affectedThemes[]`, `risk_factors`, and `portfolio_relevance_basis` instead of being dropped for lacking a symbol.
4. Computed asset anomalies: current price or volume anomaly triggers on held assets. These are anomaly facts, not event candidates.

The code-level event candidate gate is intentionally narrow:

- Drop only same-run `duplicate` rows.
- Do not require an exact current holding symbol; portfolio-level macro/policy/risk/rate-repricing events can proceed without `affectedSymbols[]`.
- Keep `seen_before` rows and pass `dedupeStatus`, first/last seen times, optional source timestamp, and source metadata to the analyst.
- Do not create candidates for portfolio quantity/cash deltas, mark-to-market portfolio deltas, or theme-exposure changes. Those are included only as analyst context.
- Do not suppress an asset anomaly just because attribution is weak, its prior anomaly bucket was similar, or the position is small. If the current asset signal is abnormal, it becomes a computed anomaly for analyst attribution; the final analyst handles repetition and tone using user-visible prior alert history. Prior broad theme, event, or portfolio-bucket notes are context, not prior anomaly coverage.
- Do not reject candidates for missing `publishedAtMs`, weak keywords, corporate-event date distance, allocation size, or alias ambiguity.

The analyst prompt receives only event records that are referenced by event candidates, capped at 100 rows, and event candidates are capped at 50. It also receives every computed asset anomaly from the current run. The analyst then decides semantic relevance, freshness, novelty, materiality, event exposure impact, anomaly attribution strength, and whether `seen_before` is just stale context or still useful.

## Blind Spots

- Dynamic connected snapshots can lag recent trades, especially when multiple broker accounts refresh at different times, and static portfolio files remain unchanged until setup/update writes a new file. The automation records stale snapshot warnings when the aggregate `asOfMs` is old.
- If Arrays latest-price coverage is missing for a holding, that holding is marked unpriced and excluded from marked total value rather than falling back to broker market value. This can understate total value until coverage is added.
- Intraday volume baselines can be thin for assets with limited history, unusual holidays, halted trading, ticker changes, or vendor gaps.
- Market-wide breaking-news discovery quality depends on the configured
  external Breaking News feed. If that feed misses an event, Portfolio Watch
  will not rediscover it internally; it only maps and analyzes rows it receives
  from the external feed plus its other per-holding/rate/macro lanes.
- Theme exposure depends on the per-run Pi Agent theme extraction. If that output is missing or malformed, the automation records a warning and falls back to the prior snapshot or fallback config for continuity.
- The analyst decision is constrained by supplied JSON. If a catalyst is not in fetched event or macro context, it should not be invented.

## Legal Disclaimer

This playbook is an engineering and audit artifact for a portfolio monitoring automation. It is not investment advice and does not recommend buying, selling, or holding any asset.
