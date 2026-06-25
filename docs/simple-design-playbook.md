# Portfolio Watch Flow Lite

## What this playbook shows

This playbook is an interactive flowchart for a portfolio watch automation. It
uses the agreed high-level pipeline as the node structure, and now includes the
first implemented automation details inside each node panel.

The target workflow is a low-noise portfolio analyst for discretionary
investors who want help monitoring their real portfolio, the events that may
affect it, and the attribution behind material moves. It separates:

- portfolio state
- exposure context
- event-first portfolio impact analysis
- holding-first anomaly attribution
- final LLM alert decision
- notification and learning state

## Data and refresh

The public playbook page is a design guide and implementation reference. It
does not directly render any private portfolio feed.

In a deployed Alva account, the implemented automation is a private feed:

- Feed: configurable, default `portfolio-watch-automation`
- Feed id: assigned by Alva after creation
- Portfolio mode: `dynamic` connected snapshot or `static` ALFS portfolio file
- Position completeness: `full_quantity` or `ticker_only`
- Dynamic connected account: supplied through `env.args.accountId` or
  `env.args.connectedAccountId`
- Static portfolio: supplied through `env.args.staticPortfolioPath`
- Cronjob: assigned by Alva after scheduling
- Schedule: hourly, `0 * * * *`
- Push behavior: quiet runs write `<|SKIP_NOTIFICATION|>`; visible alerts are
  sent only when the decision layer selects material, non-repeated findings.

The feed persists portfolio snapshots, position rows, raw event records,
event candidates, qualified event assessments, computed anomalies,
per-asset anomaly attribution packets, final anomaly attributions, alert
decisions, final status reasons, and a `notify/message` push sidecar.

Current production price / portfolio basis:

- Portfolio ingest is deterministic code, not Alva Ask.
- Dynamic mode reads the connected portfolio snapshot each run.
- Static mode reads the configured ALFS static portfolio file each run; holdings
  stay unchanged until setup/update writes a new file.
- `full_quantity` mode can compute weights, NAV deltas, and exposure
  percentages when market data coverage exists. `ticker_only` mode keeps those
  fields unavailable and only uses tickers, themes, event mapping, and
  price/volume anomaly context.
- Holdings are marked to latest 1min extended-hours price when coverage exists, so
  anomaly gates, portfolio move contribution context, weights, and NAV use the
  current watch basis rather than stale broker close marks.
- Option holdings keep the option contract as the held `symbol`, but price /
  volume anomaly and per-ticker event search use the underlying equity as
  `marketDataSymbol`. The option contract is not valued from the underlying
  stock price.
- `oneDayPct` / `currentMovePct` use the latest 1min extended-hours basis described by
  `oneDayBasis`; `lastClosedOneDayPct` is kept only as completed daily-bar
  context.
- Asset anomaly checks use one attribution lane per asset. Any price or volume
  trigger opens one asset-level attribution task; the system does not create
  separate price and volume attributions for the same asset. Each computed
  anomalous asset first gets its own Alva Ask attribution agent packet using
  why-the-move style reasoning; the final analyst then decides the final
  wording and selected/suppressed state. Anomalies are worth reporting even
  when attribution is weak; weak or guessed attribution must be labeled clearly
  instead of being presented as certainty.
- Volume anomaly checks use hourly cumulative volume rather than daily bars or
  single-hour spikes: US-listed equities/ETFs and options on US equities use
  regular-session cumulative volume up to the latest regular-session hourly
  bar, capped at the 16:00 ET market close after hours. Direct crypto assets
  use UTC-day cumulative volume.
- Technical events are optional Event Lane source records generated from each
  holding's OHLCV packet. When enabled, breakout/breakdown, support/resistance,
  RSI, moving-average cross, and volume-confirmed price move signals enter
  `rawEvents[]` as `technical_event`; when disabled, they are omitted.
- Portfolio valuation uses source quantity and cash in `full_quantity` mode,
  then computes current value from Arrays latest 1min price when available.
  Source current price, market value, cost basis, realized P&L, and unrealized
  P&L are not used or persisted in the current automation version.
- Macro context is fetched once per run with `sourceDate`, `sourceAgeHours`,
  and `fetchedAtHkt`; date-level macro endpoints are used as attribution
  context, not as proof of intraday freshness.
- Breaking-news source events come from the external Breaking News feed by
  default. That upstream feed handles market-wide discovery, source expansion,
  event clustering, source confidence, and `tickersMentioned` / `marketTags` /
  `assetClasses`. Portfolio Watch code then pre-maps direct ticker,
  option-underlying, theme, and macro/risk-bucket relevance against the current
  portfolio. A Pi portfolio mapping agent reviews those deterministic mappings
  and cross-checks remaining external events for source-grounded related
  holdings, including peer, supplier/customer, and high-confidence
  second-order/value-chain links. This mapper does not search for news, expand
  sources, or decide push/no-push.
- Mark-to-market movement is explicitly not treated as a user trade and is
  context only unless the asset also has a current anomaly trigger.
- `cashChangeUsd` is tracked separately from cash percentage drift, so
  price-driven NAV denominator moves do not masquerade as cash actions.
- Pure denominator weight drift is not emitted as a per-position change unless
  the holding's own quantity or market value moved materially.
- Theme exposure is supplied as context to the analyst. Theme allocation
  changes do not create standalone candidates; event exposure impact is
  estimated inside the Alva Ask analyst finding.
- The final analyst now outputs a `decision_lens` for selected event-impact and
  anomaly-attribution findings: thesis impact, risk direction, key levels,
  scenarios, watch-next items, and optional compliant action framing. This is
  downstream PM-note framing; sector/cohort anomaly attribution remains owned
  by the upstream why-the-move layer.
- Pushed notifications are written as chat-readable PM notes: single selected
  findings use 2-3 compact sentences; multiple selected findings use one bullet
  per finding. Both forms keep short specific link anchors and explicit
  thesis/risk/key-level/watch-next framing.
- `prior_alert_history` sent to the analyst is a past-7-day user-visible run
  timeline. Empty runs only show the run time and `userReceivedPush=false`;
  pushed runs carry the user-facing notification message and selected IDs.
  Suppressed/no-push reasoning stays in audit history and is not used as prior
  alert history.
- Portfolio snapshot staleness is surfaced as a coverage warning when `asOfMs`
  is older than 12h.
- Snapshot / price-signal schema changes create a quiet migration baseline so
  the automation does not push a false delta after code changes.

## Validation expectations

Before adapting this template for a new account, the Alva Skill Agent should do
a dry run against the user's configured portfolio, then inspect `audit.run_log`,
`analysis.decision`, and `notify.message`. A successful quiet run should persist
portfolio state, raw events, event candidates, computed anomalies, anomaly
attribution packets when anomalies exist, final statuses, and the skip sentinel
without exposing broker cost basis or P&L.

## Blind spots

This is the first production version. Current blind spots:

- Option greeks / IV and option-contract valuation are not wired yet. Option
  holdings use their underlying equity for price/volume anomaly and per-ticker
  event search, but the option contract itself remains unpriced until an
  option-specific valuation source is added.
- ETF look-through exposure is not yet wired.
- `ticker_only` portfolios do not produce true exposure percentages, portfolio
  weights, market value, NAV deltas, or portfolio-move contribution metrics.
- Per-asset X search is no longer part of the deterministic source loop.
  Market-wide breaking-news discovery is delegated to the external Breaking
  News feed; Portfolio Watch reads `events/current` with a millisecond
  `@range/<from>..<to>` lookback and falls back to `@last/N` filtering if range
  read fails. Portfolio Watch's Pi step reviews only portfolio mapping, not
  source discovery or Brave expansion.
- Broad macro/theme/topic events are represented once with `affectedSymbols[]`,
  `affectedThemes[]`, and optional `riskFactors`. For Pi events, affected
  symbols come only from Pi-returned `related_holdings[]` that code classifies
  as holding-level (`direct`, peer, supplier/customer, option-underlying, or a
  high-confidence second-order/value-chain relation with concrete transmission),
  not code-side ticker/theme matching and not context-only `theme_readthrough`.
  An event is no longer
  dropped merely because `related_holdings[]` is empty when it has a credible
  portfolio-level macro/policy/risk/theme relevance basis. Deterministic
  per-ticker source rows carry code-populated `sourceRelatedTickers` and
  `relatedHoldings` from the query symbol and current holding, including
  `option_underlying` when the fetched `marketDataSymbol` differs from the held
  symbol.
- Crypto-specific derivatives/on-chain attribution is not yet wired generically.
  Direct crypto assets and crypto-related equities can still be monitored through
  price, volume, market news, and theme/event attribution.
- Hourly cumulative-volume profiles currently depend on available hourly kline
  coverage; if an asset lacks enough same-point historical samples, volume
  fields are persisted as null rather than estimated.
- Broad macro/policy/risk events can now become portfolio-level candidates
  even when no exact holding symbol is present, as long as Pi supplies
  risk-factor context and a portfolio relevance basis.
- Sector / theme mapping is now extracted every run by Alva Ask from the latest
  portfolio snapshot. If that call fails or returns incomplete JSON, the
  automation records a warning and uses prior/fallback themes only for
  continuity.
- Source records without source timestamps can still reach analyst review if
  they are non-duplicate. The analyst must
  use source time labels, fetch time, first/last seen time, and dedupe status
  conservatively instead of overstating freshness.
- The public design guide intentionally does not expose private portfolio
  feed data.
