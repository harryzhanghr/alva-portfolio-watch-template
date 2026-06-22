# Portfolio Watch Automation Spec

## Overview

This playbook documents a connected-account portfolio watch automation as a plain-language runbook. It explains the hourly pipeline step by step for a reader who does not want to read source code: how the automation reads a connected portfolio, marks positions with latest available market data where coverage exists, computes asset anomalies, runs fresh event search, runs one per-asset anomaly attribution agent for every computed anomalous asset, runs a low-noise final analyst decision gate, and persists both push and no-push decisions for audit.

## Data Sources & Freshness

- Connected account portfolio: code reads the user-supplied account id from `env.args.accountId` or `env.args.connectedAccountId` through the read-only Alva connected-account portfolio API, equivalent to `GET /api/v1/portfolio/summary?accountId=<CONNECTED_ACCOUNT_ID>`. This step uses only current holdings, side, quantity, cash, and the broker as-of timestamp. Broker current price, broker market value, average cost, realized P&L, and unrealized P&L are intentionally not used as context.
- Equity daily bars: Arrays `/api/v1/stocks/kline`, `interval=1d`, roughly 90 bars. Used for previous regular-session close, completed daily move context, 5D move, daily-return z-score, and daily volume context.
- Equity 1min bars: Arrays `/api/v1/stocks/kline`, `interval=1min`, `session=ETH`, roughly 36 hours / 2400 bars. Used as the primary latest-price source for portfolio valuation and price anomaly, including premarket / regular / after-hours when available.
- Equity hourly bars: Arrays `/api/v1/stocks/kline`, `interval=1h`, `session=ETH`, roughly 120 bars over about 35 days. Used for US regular-session cumulative volume-to-now / market-close versus historical same-point baselines. It is price fallback only if 1min coverage is missing.
- Market news: Arrays `/api/v1/stocks/market-news`, per current holding's `marketDataSymbol`, with an hourly event search window plus overlap. For option holdings, `marketDataSymbol` is the underlying equity, not the option contract symbol.
- Analyst / price target news: Arrays `/api/v1/stocks/company/price-target-news`, per current holding's `marketDataSymbol`, with a wider lookback. Used for upgrades, downgrades, target-change style event records.
- Earnings calendar: Arrays `/api/v1/stocks/earnings-calendar`, per current holding's `marketDataSymbol`. Used to detect upcoming or changed earnings event exposure.
- Dynamic theme extraction: Alva Ask receives the current marked portfolio snapshot every run and returns current holding themes used for theme exposure context, analyst exposure-impact reasoning, and theme-news search. `priorThemes` are only weak continuity hints; the current run's extracted themes are supplied to Pi before event search.
- Indexed X + Pi event-search loop: code calls Arrays `/api/v1/social-feeds/x/search` without a text query over the latest 90-minute indexed window, pages backward up to 5 pages of 200 original/quote tweets, ranks the unique window rows by engagement, and supplies up to 50 top tweets to one bounded `@alva/pi` loop. Pi reviews only those supplied hot tweets for market-breaking eligibility; qualifying indexed-X anchors may trigger Brave source expansion to find the original/official or earliest credible source. The same Pi loop handles theme-news: it receives current portfolio theme context, current holding context, and supported Arrays market-news topics; maps each theme to `topic` values or `no_supported_topic`; calls `searchArraysMarketNewsTopic` when useful; and may run supplemental Brave theme/news searches. For Pi-returned `breaking_news`, `theme_news`, and `topic_news`, source-returned tickers are context only; Pi should return `related_holdings[]` with exact current holding symbols and rationale when a holding-level relation exists. Truly market-moving macro/policy/risk events may return `related_holdings: []` plus `risk_factors` and `portfolio_relevance_basis`.
- Macro context: Arrays macro endpoints for SPX, Nasdaq, VIX, oil, and treasury rates. Each row includes `sourceDate`, `sourceAgeHours`, and `fetchedAtHkt` so analyst can judge relevance/freshness before using it as attribution context.
- Schedule: the automation runs hourly. A run does not imply a notification. Quiet runs persist the skip sentinel `<|SKIP_NOTIFICATION|>`.
- Freshness rule: price anomaly uses latest 1min extended-hours price when it is newer than the last completed daily close. `oneDayPct` then means latest 1min price vs previous regular-session close. `lastClosedOneDayPct` is kept only as completed-close context.
- Option rule: option holdings keep the option contract as `holding.symbol`, but price anomaly, volume anomaly, and per-ticker event search use the underlying equity as `marketDataSymbol`. The option contract is not valued from the underlying stock price.

## Event Source Fetch Details

For every current holding, Node 3 first resolves `marketDataSymbol`: ordinary US equities/ETFs use their own ticker; option contracts use the parsed underlying equity. Then it runs the same source loop:

- Market news calls `/api/v1/stocks/market-news` for `marketDataSymbol` with the Node 2 event window, published-time descending sort, and `limit=50`.
- Analyst / price-target news calls `/api/v1/stocks/company/price-target-news` for `marketDataSymbol` from `fetchStartSec - 5 days` through the run end, with `limit=50`.
- Earnings calendar calls `/api/v1/stocks/earnings-calendar` for `marketDataSymbol` from 7 days before now through 45 days after now. These rows carry `eventAtMs`; they usually do not carry a source published timestamp.
- Per-ticker market-news, analyst, and earnings rows carry code-populated `sourceRelatedTickers` from the query/vendor ticker fields and `relatedHoldings` from the current holding. Option rows use `relation=option_underlying` when the fetched `marketDataSymbol` is the underlying equity.
- Each mapped source row is appended to `rawEvents[]`. This does not mean it is push-worthy or even candidate-approved; it only means the source was fetched and normalized for downstream gates.
- Macro context is fetched once per run after holdings are marked and current themes are extracted. Macro rows are stored with source/fetch timestamps.
- Pi event search runs after the per-holding source loop, latest-price marking, and current dynamic theme extraction. Code passes the HKT window, search budgets, supported Arrays market-news topics, every current extracted portfolio theme with linked holdings/weights, every current holding with themes/aliases/weights, and the code-ranked indexed X top-engagement list. Pi reviews the supplied hot tweets rather than planning X text queries. If one is fresh, investment-related, and plausibly market-moving, Pi can use Brave up to twice for source expansion, looking for the original/official source first, then the earliest credible media/source link if official is unavailable. Source-expansion calls must use `result_filter="web"` rather than `news`; runtime also forces source expansion to web. Pi must not use Brave source expansion to create an unanchored market-breaking event. The final Pi JSON can return at most 30 events total. Code does not separately fetch topic-news rows or map theme events to tickers after Pi.

The Pi prompt asks for fresh events within the supplied window. For indexed-X market-breaking rows, tweet `published_at` / source time label represents the fresh discovery/post timestamp, while `sourceEventTime` / `sourceEventAtMs` can represent an older official or primary source found through Brave expansion. Downstream gates still require source timestamps where freshness matters. A candidate no longer needs an exact holding symbol when it is a portfolio-level macro/policy/risk event with `risk_factors` and `portfolio_relevance_basis`.

## How This Playbook Works

The page is organized as nodes that mirror the production automation:

- Node 0 defines runtime config, output schemas, thresholds, fallback theme map, aliases, schema versions, and notification sentinel.
- Node 1 calls the connected-account portfolio API in code, validates the returned holdings array, and normalizes it into an unpriced position snapshot. Broker price, market value, cost, and P&L fields are dropped before context or persistence.
- Node 2 loads prior KV state: last snapshot, last run time, event index, user-visible alert timeline, finding history for persistence/audit updates, and prior anomaly signals. The analyst packet receives the past-7-day user-visible run timeline, not prior findings or no-push suppression reasoning.
- Node 3 loops through each current holding, resolves `marketDataSymbol`, and fetches daily bars, latest 1min bars, hourly bars, and per-holding event sources from that symbol. For options, this means the underlying equity. This node does not run X search.
- Node 4 computes price and volume anomaly metrics, marks positions to Arrays latest price, recomputes market value from connected-account quantity, computes total value as cash plus priced positions, recomputes weights, and calls Alva Ask once to extract current holding themes from the latest marked portfolio. US-listed holdings and US equity options use hourly regular-session cumulative volume up to the latest regular-session bar, capped at the 16:00 ET market close after hours, compared with historical median cumulative volume at the same point of the trading day. Direct crypto assets use UTC-day cumulative volume.
- Node 5 fetches timestamped macro context and runs one Pi event-search loop covering market-wide breaking news plus theme/topic news. Arrays topic-news rows, when used, are fetched by the Pi tool loop through `searchArraysMarketNewsTopic`; Pi then returns holding-linked events or portfolio-level risk-factor events. The node also normalizes event records with dedupe status.
- Node 6 builds two separate lane inputs: event-impact candidates from all non-duplicate event records, including portfolio-level macro/policy/risk events with no exact holding symbol, and computed `asset_anomalies` from current price/volume anomaly triggers. Portfolio delta and theme-exposure change are context only, not candidates.
- Node 7 loops through every computed asset anomaly and calls one Alva Ask Anomaly Attribution Agent for that asset. The agent receives the computed anomaly, holding context, related event records, related event candidates, macro context, top portfolio context, and prior user-visible alert history. It should use the Skill Hub why-the-move methodology when available and return an attribution packet with status, driver split, supporting events, confidence, and data-quality notes. This node does not decide push/no-push.
- Node 8 builds the final analyst packet and prompt, calls Alva Ask only when event candidates or anomalies exist, validates the JSON response, and decides push vs no-push. Alva Ask keeps event exposure impact and anomaly attribution as separate flows and final message sections. It qualifies event candidates, estimates event exposure impact itself from the supplied portfolio snapshot and theme context, converts anomaly attribution packets into final anomaly-attribution findings, and records the final status/reason for every item.
- Node 9 persists all audit outputs and KV state, including quiet no-push decisions.

## Execution Environments

- Most nodes are deterministic runtime code: config load, Arrays API calls, price and volume calculations, event normalization, dedupe, candidate construction, table appends, and KV writes.
- The production implementation has one Pi Agent loop through `@alva/pi`:
  - Market-breaking lane: code calls `agent.ask(buildBreakingNewsPrompt(...))` after fetching and engagement-ranking recent Arrays indexed X tweets. Pi reviews only the supplied top tweets for investment-related breaking-news eligibility and can use `searchBrave` up to twice for source expansion after a tweet qualifies. Source-expansion Brave calls use `result_filter="web"` and are not restricted to the recent event window, so Pi can find an older official / primary source for a fresh indexed-X post. Pi is instructed to look for the original/official source first, then the earliest credible media/source link. Code parses `event_scope=market_breaking` JSON into `breaking_news` records and records indexedXDiscovery plus actual tool calls in audit.
  - Theme-news lane: the same Pi agent receives current theme context, linked holdings, current holding context, and supported Arrays market-news topics. It returns `themeTopicMappings[]` for every current theme, may call `searchArraysMarketNewsTopic(topic, theme)` to inspect Arrays topic rows inside the agent loop, and may run `searchBrave(..., purpose="theme_news")` as supplemental discovery. Pi-returned topic rows become `topic_news`; Pi-returned Brave theme rows remain `theme_news`. Code validates exact `related_holdings[].holding_symbol` values when present, but no longer drops portfolio-level macro/policy/risk events solely because no exact holding symbol was returned.
- The production implementation has three Alva Ask (LLM) call types through `@alva/alvaask`:
  - Theme extraction: code calls `ask(buildThemeExtractionPrompt(snapshot))` every run after latest-price marking. It receives supplied portfolio JSON only and returns themes for current holdings.
  - Per-asset anomaly attribution: code loops over computed `asset_anomalies` and calls `ask(buildAnomalyAttributionPrompt(anomalyInput), { effort: "high" })` once per anomalous asset. The prompt asks the agent to use the Skill Hub why-the-move methodology when available, verify stale or thin facts with available tools when useful, and return attribution JSON only. These packets are analysis inputs, not final findings.
  - Final analyst gate: code calls `ask(buildAnalystPrompt(analystInput))` whenever event-impact candidates or computed asset anomalies exist. First run is context in `portfolio_context.current_portfolio_delta.firstRun`, not an automatic skip.
- Portfolio reading is deterministic code, not an LLM call: code calls the connected-account portfolio API with `X-Alva-Api-Key` auth and requires a usable `holdings[]` array.
- The final analyst gate does not use Pi or ADK and does not run a separate reflection/self-retry loop. It is still an Alva Ask call; if Alva Ask has managed tools available, the prompt permits it to verify suspicious or stale facts before returning JSON.
- Market data, per-holding event source fetch, anomaly trigger calculations, candidate construction, and persistence are owned by code. Pi owns market/theme discovery and Pi-event-to-holding mapping for `breaking_news`, `theme_news`, and `topic_news`. The per-asset Anomaly Attribution Agent owns first-pass why-the-move analysis for computed anomalies. Event exposure impact sizing, novelty judgment, final anomaly wording, and final selected/suppressed decisions are owned by the final Alva Ask analyst.
- The analyst packet is intentionally bounded: recent event records are capped at 100 records, review candidates are capped at 50 items, recent alert history is included, persisted finding history is not sent to the analyst, and the compact prompt JSON is capped at 1,000,000 characters. The Pi event-search context JSON is also capped at 1,000,000 characters so current holdings, themes, and source text are visible for mapping.
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
- use per-asset anomaly attribution packets as the starting point for anomaly findings;
- avoid repeats using only user-visible prior alert history, not prior suppressed reasoning;
- use available tools when submitted facts look wrong, stale, or worth deeper confirmation;
- write concise user-facing copy without internal workflow words.

## Persisted Outputs

- `portfolio.snapshot`: Arrays-current portfolio value, cash, cash allocation, top holdings, priced/unpriced coverage, portfolio delta JSON, theme exposure JSON, coverage warnings, full snapshot JSON, source and run timestamps.
- `portfolio.positions`: one row per holding with quantity, Arrays current price, market value, weight, instrument details, and current-run dynamic themes. Cost basis and P&L fields are not persisted.
- `event.items`: normalized source records with stable key, source type, searched/attached symbol, title, summary, URL, source, dedupe status, metadata, and seen timestamps. Indexed-X breaking-news metadata may include `sourceTweetId`, `sourceTweetUrl`, `sourceTweetRank`, `sourceTweetEngagementScore`, and `sourceEventTime` / `sourceEventAtMs`; the latter is the original / official or earliest credible source time used by the analyst to distinguish a fresh X post from an older source event. This table is an audit trail of fetched source records, not the final candidate-approved list of portfolio-relevant events. Future run-level audit reads the exact compact `normalizedEvent.records` packet from `rawEventsJson`, with `event.items` as historical/source-table fallback.
- `finding.records`: normalized event-impact and anomaly-attribution findings with dedupe keys, selection status, suppression reason, and payload JSON.
- `analysis.decision`: final alert decision, urgency, reason, skip reason, selected and suppressed finding IDs, two message sections (`event_exposure_impacts` and `anomaly_attributions`), notification body when pushed, portfolio context, prior user-visible alert timeline, exact compact raw events used for candidate building, explicit event candidates, qualified event assessments, selected-event compatibility subset, computed anomalies, anomaly attribution packets, final anomaly attributions, final status ledger, compact `searchExpansionTraceJson`, legacy full candidate summary, compact `candidateAuditJson`, compact `anomalySignalsJson`, and raw analyst JSON.
- `notify.message`: push sidecar. Quiet runs write `<|SKIP_NOTIFICATION|>`.
- KV state: `lastSnapshot`, `lastRunAtMs`, `lastPriceSignals`, `eventIndex`, `alertHistory` as the user-visible run timeline, `findingHistory`, `lastDecision`, and `nextRunContext`.

## Key Computation Rules

- Portfolio deltas distinguish real action from valuation movement. Quantity and cash changes are action-material. Mark-to-market changes are attribution context unless they also satisfy other event gates.
- Portfolio valuation is cash plus the sum of `quantity x Arrays latest 1min price` for priced holdings, with hourly/daily as explicit fallback only when 1min is unavailable. It does not use broker total value or broker market value as a fallback.
- The valuation price and anomaly current price are the same selected field: `priceSignals.latestPrice`. Node 4 chooses it from 1min bars when available; Node 5 only consumes it.
- Option contracts are not priced from the underlying equity. They may have `marketDataSymbol`/`underlyingSymbol` for anomaly and event attribution, but remain unpriced in portfolio valuation until an option-specific valuation source is added.
- Cost basis, realized P&L, and unrealized P&L are out of scope in this version because broker definitions are not stable enough across providers and tax-lot/accounting methods.
- Price anomaly triggers are based on `oneDayPct` and return z-score. Current 1D movement uses latest 1min extended-hours price versus the previous regular-session close when newer 1min data exists. For options, this is the underlying equity's latest 1min price versus its previous regular-session close. `fiveDayPct` is retained as context only and does not trigger an anomaly.
- Volume anomaly triggers are based on `cumulativeVolumeMultiple`: current-day hourly cumulative volume divided by historical median cumulative volume at the same point of the day. For US-listed equities/ETFs and options on US equities, theme does not change the market structure: crypto-related equities still use the US regular session and market-close cap. The old current-hour multiple and current-hour z-score triggers are not used.
- Anomaly attribution is asset-level. If either price or volume triggers fire for a held asset, code first creates one computed anomaly for that asset. Node 7 then runs one per-asset Alva Ask Anomaly Attribution Agent for that anomaly. The final analyst receives the attribution packet and should produce one final attribution for that asset, not separate price and volume narratives.
- Exposure estimates are not computed as a code step. Alva Ask estimates direct and related portfolio exposure impact inside event-impact findings. Exposure still must not be used to explain anomalies.
- Repeated push suppression is not a deterministic post-analyst code override. Prior alert history is passed to Alva Ask, while finding history remains persisted for audit/state continuity. The analyst decides whether a repeated narrative has enough new event information or stronger attribution to justify a push.

## Event Normalize vs Candidate Gate

The automation has three separate stages that are easy to confuse:

1. `rawEvents[]`: source records fetched from per-holding event sources and Pi event search, including `breaking_news`, `theme_news`, and Pi-mapped `topic_news`.
2. `event.items`: normalized/deduped source records. These rows can be `new`, `updated`, `seen_before`, or `duplicate`.
3. Event-impact candidates: non-duplicate normalized source records. They can be `new`, `updated`, or `seen_before`. Per-holding source rows use deterministic code-populated `relatedHoldings` from the query/holding symbol; Pi rows use Pi-returned `related_holdings[]` for `affectedSymbols[]` when present. Broad macro/policy/risk rows may become one portfolio-level candidate with `affectedSymbols: []`, `affectedThemes[]`, `risk_factors`, and `portfolio_relevance_basis` instead of being dropped for lacking a symbol.
4. Computed asset anomalies: current price or volume anomaly triggers on held assets. These are anomaly facts, not event candidates.

The code-level event candidate gate is intentionally narrow:

- Drop only same-run `duplicate` rows.
- Do not require an exact current holding symbol; portfolio-level macro/policy/risk events can proceed without `affectedSymbols[]`.
- Keep `seen_before` rows and pass `dedupeStatus`, first/last seen times, optional source timestamp, and source metadata to the analyst.
- Do not create candidates for portfolio quantity/cash deltas, mark-to-market portfolio deltas, or theme-exposure changes. Those are included only as analyst context.
- Do not suppress an asset anomaly just because its prior anomaly bucket was similar. If the current asset signal is abnormal, it becomes a computed anomaly for analyst attribution; Alva Ask handles whether it is repeated, weak, or not worth telling the user.
- Do not reject candidates for missing `publishedAtMs`, weak keywords, corporate-event date distance, allocation size, or alias ambiguity.

The analyst prompt receives only event records that are referenced by event candidates, capped at 100 rows, and event candidates are capped at 50. It also receives every computed asset anomaly from the current run. The analyst then decides semantic relevance, freshness, novelty, materiality, event exposure impact, anomaly attribution strength, and whether `seen_before` is just stale context or still useful.

## Blind Spots

- The connected-account broker snapshot can lag recent trades. The automation records stale snapshot warnings, but quantities and cash still depend on the broker connection.
- If Arrays latest-price coverage is missing for a holding, that holding is marked unpriced and excluded from marked total value rather than falling back to broker market value. This can understate total value until coverage is added.
- Intraday volume baselines can be thin for assets with limited history, unusual holidays, halted trading, ticker changes, or vendor gaps.
- Market-wide X discovery is handled by code-ranked Arrays indexed X top-engagement rows plus the bounded Pi event-search loop, not as a per-holding ticker query and not via Grok text queries. If Pi returns noisy broad-market rows, the analyst gate should suppress them or mark weak_correlation.
- Theme exposure depends on the per-run Alva Ask theme extraction. If that LLM output is missing or malformed, the automation records a warning and falls back to the prior snapshot or fallback config for continuity.
- The analyst decision is constrained by supplied JSON. If a catalyst is not in fetched event or macro context, it should not be invented.

## Legal Disclaimer

This playbook is an engineering and audit artifact for a portfolio monitoring automation. It is not investment advice and does not recommend buying, selling, or holding any asset.
