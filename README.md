# Alva Portfolio Watch Template

Open-source template for creating a low-noise portfolio watch automation on Alva.

The automation is not a daily news digest. It monitors a user's connected
portfolio, looks for material events or unusual held-asset moves, attributes
those moves when possible, and only pushes when the user is likely to be glad
they were interrupted.

## What Is Included

- `src/portfolio-watch-automation.js`  
  Production-style Alva automation source. It reads a connected portfolio,
  fetches market/event data, computes price and volume anomalies, runs Pi event
  search, runs Alva Ask analyst review, persists audit artifacts, and writes a
  notification sidecar.
- `playbooks/audit-log/index.html`  
  A reusable audit playbook UI for inspecting official cron runs, raw events,
  event candidates, qualified events, anomaly attributions, final status
  reasons, persisted file deltas, and notification output.
- `playbooks/audit-log/README.md`  
  Audit UI configuration notes.
- `docs/simple-design-playbook.md`  
  The compact design guide.
- `docs/pseudo-code-playbook.md`  
  The detailed plain-language pseudo-code runbook.
- `docs/breaking-news-origin-source-requirement.md`  
  Source-origin requirement for indexed-X breaking-news events.
- `docs/alva-skill-agent-checklist.md`  
  Short deployment and verification checklist for Alva Skill Agents.
- `examples/env.args.example.json`  
  Example Alva runtime args. Replace every placeholder before deployment.

## For Alva Skill Agents

Use this section as the implementation contract when creating a user's own
Portfolio Watch on Alva.

### Goal

Create one private Alva automation and one audit playbook for a user who already
has a connected portfolio account in Alva. The result should be user-specific,
but this repo must remain generic: do not hardcode the template author's
username, account id, holdings, feed id, cron id, aliases, themes, or run logs.

### Required User Inputs

Ask for or infer these from Alva workspace state:

- `accountId` or `connectedAccountId`: the user's connected portfolio account id.
- `ownerUsername`: the Alva username that owns the feed.
- `feedName`: desired feed name. Default recommendation:
  `portfolio-watch-automation`.
- Push target / notification wiring, if the user's Alva environment requires it.
- Optional `aliases`: ticker/company aliases for better event matching.
- Optional `fallbackThemeMap`: continuity fallback only. The automation extracts
  current themes every run with Alva Ask, so do not overfit this map.

### Runtime Args

Pass these through `env.args` when creating the automation:

```json
{
  "feedName": "portfolio-watch-automation",
  "accountId": "<CONNECTED_ACCOUNT_ID>",
  "ownerUsername": "<ALVA_USERNAME>",
  "runSource": "cron_push_pipeline",
  "aliases": {
    "TICKER": ["TICKER", "Company Name", "$TICKER"]
  },
  "fallbackThemeMap": {
    "TICKER": ["theme-a", "industry-b"]
  }
}
```

The source intentionally fails fast if `accountId` / `connectedAccountId` is
missing.

### Creation Steps

1. Copy `src/portfolio-watch-automation.js` into an Alva automation.
2. Set `env.args.feedName`, `env.args.accountId`, and `env.args.ownerUsername`.
3. Schedule the automation hourly, for example `0 * * * *`.
4. Create or update an audit playbook from `playbooks/audit-log/index.html`.
5. Configure the audit playbook by editing constants or opening with query
   params:

```text
?username=<ALVA_USERNAME>&feed_name=portfolio-watch-automation&feed_id=<FEED_ID>&cronjob_id=<CRONJOB_ID>
```

6. Run one manual dry run before enabling push behavior.
7. Inspect `audit.run_log`, `analysis.decision`, `event.items`, and
   `notify.message`.
8. Confirm quiet runs write `<|SKIP_NOTIFICATION|>` and do not emit duplicate
   user-visible alerts.

### Non-Negotiable Implementation Rules

- Portfolio ingest is deterministic code, not an Alva Ask call.
- Broker current price, broker market value, cost basis, realized P&L, and
  unrealized P&L must not be used as portfolio context in this version.
- Portfolio valuation uses connected-account quantity and cash plus Arrays
  latest 1min price when available.
- Price anomaly uses latest 1min extended-hours price vs previous regular close
  when 1min coverage exists.
- Volume anomaly uses hourly cumulative volume versus historical same-time
  cumulative volume.
- Market-breaking discovery starts from recent Arrays indexed X rows ranked by
  code, not from per-holding X queries.
- Pi may use Brave source expansion only after an indexed-X anchor qualifies.
- Theme/topic event search happens inside the Pi event-search agent.
- Event lane and anomaly lane are separate.
- Event candidates are a review long list, not pre-approved findings.
- Anomalies are computed facts, not event candidates.
- Alva Ask analyst decides qualification, attribution, selected/suppressed
  status, and final push/no-push.
- Code should not run a deterministic post-analyst repeat-suppression override.
- Every no-push path should still persist audit artifacts.

## Repo Structure

```text
.
├── src/
│   └── portfolio-watch-automation.js
├── playbooks/
│   └── audit-log/
│       ├── index.html
│       └── README.md
├── docs/
│   ├── simple-design-playbook.md
│   ├── pseudo-code-playbook.md
│   ├── alva-skill-agent-checklist.md
│   └── breaking-news-origin-source-requirement.md
└── examples/
    └── env.args.example.json
```

## Human Overview

Portfolio Watch is meant for discretionary investors who want a real monitoring
assistant, not a feed of headlines. It asks two questions every hour:

1. Did something new happen that can materially affect my current portfolio?
2. Is any held asset moving unusually, and can the move be attributed?

Most runs should be quiet. A quiet run is still useful because it updates state,
dedupe history, source records, anomaly metrics, and the audit trail. The user
should only see a notification when there is a material event exposure impact or
a meaningful anomaly attribution.

## High-Level Workflow

1. Read connected portfolio positions and cash.
2. Drop broker prices, broker market values, cost basis, and P&L.
3. Fetch Arrays latest 1min, hourly, and daily bars for current holdings or
   option underlyings.
4. Mark holdings to Arrays latest price where coverage exists.
5. Extract current holding themes with Alva Ask.
6. Fetch per-holding market news, analyst/price-target news, and earnings
   calendar rows.
7. Fetch macro context.
8. Fetch recent indexed X rows in code, rank by engagement, and send top rows
   to Pi for market-breaking review.
9. Let Pi handle theme/topic news search and event-to-holding mapping.
10. Normalize and dedupe raw event records.
11. Build event candidates from all non-duplicate event records.
12. Build computed asset anomalies from price/volume triggers.
13. Send event candidates and anomalies to the Alva Ask analyst.
14. Persist raw events, candidates, qualified events, final statuses, anomaly
   attributions, and notification output.
15. Push only if the analyst selected at least one finding and wrote a message.

## Appendix A: Compact Design Playbook

### What This Playbook Shows

This design describes a low-noise portfolio analyst for discretionary investors
who want help monitoring their real portfolio, the events that may affect it,
and the attribution behind material moves. It separates:

- portfolio state
- exposure context
- event-first portfolio impact analysis
- holding-first anomaly attribution
- final LLM alert decision
- notification and learning state

### Data And Refresh

The implemented automation is a private Alva feed owned by the deploying user:

- Feed: configurable, default `portfolio-watch-automation`
- Connected account: supplied through `env.args.accountId` or
  `env.args.connectedAccountId`
- Schedule: hourly, typically `0 * * * *`
- Push behavior: quiet runs write `<|SKIP_NOTIFICATION|>`; visible alerts are
  sent only when the decision layer selects material, non-repeated findings.

The feed persists portfolio snapshots, position rows, raw event records, event
candidates, qualified events, computed anomalies, anomaly attributions, alert
decisions, and a `notify/message` sidecar.

Current production price / portfolio basis:

- Broker snapshot is used for quantities, cash, account state, and broker
  as-of timestamp only.
- Broker current price, market value, cost basis, realized P&L, and unrealized
  P&L are not used or persisted.
- Holdings are marked to latest 1min extended-hours price when coverage exists.
- Option holdings keep the option contract as the held `symbol`, but price /
  volume anomaly and per-ticker event search use the underlying equity as
  `marketDataSymbol`. The option contract is not valued from the underlying
  stock price.
- `oneDayPct` / `currentMovePct` use latest 1min extended-hours price versus
  previous regular close. `lastClosedOneDayPct` is completed-close context only.
- Volume anomaly uses hourly cumulative volume, not a single current-hour bar
  and not daily-bar volume.
- Macro context is fetched once per run and includes source/fetch timestamps.
- Mark-to-market movement is context only unless an asset also has a current
  anomaly trigger.
- Portfolio delta and theme exposure are context, not standalone alert
  candidates.

### Event Search Design

Pi event search has two lanes:

- Market-breaking discovery starts from code-ranked Arrays indexed X
  top-engagement tweets over the latest 90-minute window. Pi reviews supplied
  hot tweets for investment-related breaking-news eligibility. Brave source
  expansion is allowed only for qualifying X anchors and should look for the
  original/official source first.
- Theme / industry source coverage starts inside the same Pi agent. Alva Ask
  extracts current holding themes from the latest portfolio; code supplies
  current holdings, current theme context, supported Arrays market-news topics,
  source-text-aware tools, indexed X discovery context, and budgets. Pi maps
  each theme to supported topics or `no_supported_topic`, can call
  `searchArraysMarketNewsTopic`, and can run supplemental Brave theme searches.

Source-returned tickers are context only. Pi should return `related_holdings[]`
with exact current holding symbols and rationale when a holding-level relation
exists. Portfolio-level macro/policy/risk events can proceed with
`related_holdings: []` if they include credible `risk_factors` and
`portfolio_relevance_basis`.

### Event And Anomaly Lanes

Event lane:

```text
Raw Events -> Event Candidates -> Qualified Events
```

Raw events are normalized source records. Event candidates are the non-duplicate
review long list. Qualified events are analyst-created event-impact assessments
with exposure impact. Each qualified event still has final status:
`selected` or `suppressed`.

Anomaly lane:

```text
Computed Anomalies -> Anomaly Attributions -> selected/suppressed
```

Anomalies are computed facts from current price/volume data. They are not event
candidates. If either price or volume triggers for a held asset, the analyst
should produce one asset-level attribution when possible, combining all trigger
metrics for that asset.

### Blind Spots

- Option greeks, IV, and option-contract valuation are not wired.
- ETF look-through exposure is not wired.
- Crypto-specific derivatives/on-chain attribution is not wired generically.
- Theme extraction is an Alva Ask call. If it fails, prior/fallback themes are
  continuity aids only.
- Source records without source timestamps can reach analyst review. The
  analyst must use source time labels, fetch time, first/last seen time, and
  dedupe status conservatively.

## Appendix B: Pseudo-Code Runbook

### Node 0: Runtime Configuration

Input:

- `env.args.feedName`
- `env.args.accountId` or `env.args.connectedAccountId`
- `env.args.ownerUsername`
- optional aliases and fallback theme map

Output:

- feed schemas
- thresholds
- runtime constants
- notification sentinel

Persisted output:

- none directly

Steps:

1. Read runtime args.
2. Fail fast if connected account id is missing.
3. Define feed path and output schemas.
4. Define price, volume, event, prompt, and search budgets.
5. Load optional aliases and fallback theme map from args.

### Node 1: Portfolio Ingest

Input:

- connected account id

Output:

- normalized unpriced snapshot

Persisted output:

- later persisted as `portfolio.snapshot` and `portfolio.positions`

Steps:

1. Call the read-only Alva connected-account portfolio API in code.
2. Require parseable `holdings[]`.
3. Keep symbol, asset class, side, quantity, cash, currency, and broker as-of
   timestamp.
4. Drop broker current price, broker market value, average cost, realized P&L,
   and unrealized P&L.
5. Detect option-like symbols and parse underlying, expiry, call/put, and strike
   when possible.

### Node 2: Prior State Load

Input:

- feed KV state

Output:

- previous snapshot
- previous run time
- previous event index
- user-visible alert timeline
- finding history for audit continuity
- previous price signals

Persisted output:

- none yet

Steps:

1. Load `lastSnapshot`.
2. Load `lastRunAtMs`.
3. Load `eventIndex`.
4. Load `alertHistory`.
5. Load `findingHistory`.
6. Load `lastPriceSignals`.
7. If schema versions changed, suppress one-run baselines and record warnings.

### Node 3: Market Data And Source Fetch

Input:

- current holdings
- previous run time
- event window

Output:

- daily, 1min, and hourly bars
- raw per-holding source rows
- macro context
- Pi event-search rows

Persisted output:

- raw rows later persist through `event.items`

For each holding:

1. Resolve `marketDataSymbol`.
2. Fetch daily bars for previous close, 5D context, and z-score context.
3. Fetch 1min extended-hours bars for latest price.
4. Fetch hourly bars for cumulative volume.
5. Fetch market news with the hourly event window.
6. Fetch analyst / price-target news with wider lookback.
7. Fetch earnings calendar around current date.
8. Append all mapped source rows to `rawEvents[]`.

After all holdings:

1. Fetch macro context once.
2. Fetch recent indexed X rows in code.
3. Rank indexed X rows by engagement.
4. Pass top rows plus portfolio/theme context to Pi.
5. Let Pi review market-breaking candidates, expand sources with Brave when
   allowed, map theme topics, call topic news tools, and return JSON events.
6. Append Pi-returned events to `rawEvents[]`.

### Node 4: Price Mark, Volume Metrics, And Theme Extraction

Input:

- current snapshot
- daily bars
- 1min bars
- hourly bars

Output:

- marked snapshot
- price signals
- volume signals
- current holding themes

Persisted output:

- later included in portfolio and audit rows

Steps:

1. Select latest price from 1min bars when available.
2. Compute `oneDayPct` using latest 1min price vs previous regular close.
3. Keep completed-close daily move as context only.
4. Compute 5D move as context.
5. Compute z-score from historical daily returns.
6. Compute hourly cumulative volume versus historical same-time cumulative
   volume.
7. Trigger anomaly if price or volume thresholds fire.
8. Mark holdings to Arrays latest price where coverage exists.
9. Compute `marketValue = signed quantity x latest price`.
10. Compute `totalValue = cash + sum(priced holding marketValue)`.
11. Call Alva Ask to extract current themes from the marked portfolio.

### Node 5: Event Normalization

Input:

- `rawEvents[]`
- previous event index

Output:

- normalized event records
- updated event index

Persisted output:

- `event.items`

Steps:

1. Build stable event keys.
2. Mark same-run duplicates as `duplicate`.
3. Mark old records with changed text as `updated`.
4. Mark old records with same text as `seen_before`.
5. Mark first-time records as `new`.
6. Preserve source origin, source lane, source timestamps, affected symbols,
   affected themes, source links, source text, and mapping reason.

### Node 6: Lane Input Build

Input:

- normalized events
- price signals
- marked portfolio

Output:

- `event_candidates_to_review`
- `asset_anomalies`

Persisted output:

- later in `analysis.decision` and `audit.run_log`

Event candidate steps:

1. Start with every normalized source record.
2. Drop only same-run `duplicate`.
3. Keep `new`, `updated`, and `seen_before`.
4. Allow holding-linked candidates.
5. Allow portfolio-level macro/policy/risk candidates with no exact holding
   symbol if they carry risk-factor context.
6. Compute starting affected-symbol exposure when available.

Anomaly steps:

1. Start with current price signals.
2. Keep only current holdings with active price or volume trigger.
3. Build one `asset_anomaly` object per asset.
4. Do not block repeated anomaly buckets in code.

### Node 7: Alva Ask Analyst

Input:

- event candidates, capped at 50
- referenced event records, capped at 100
- computed asset anomalies
- current portfolio snapshot
- current theme exposure
- macro context
- user-visible prior alert timeline
- coverage warnings

Output:

- event candidate statuses
- event impact findings
- anomaly attribution findings
- final push/no-push decision
- message sections

Persisted output:

- `finding.records`
- `analysis.decision`
- `audit.run_log`

Analyst instructions:

1. Decide whether each event candidate is real portfolio-relevant event,
   weak/noisy, repeated, seen-before context, or not qualified.
2. Promote only real events into event-impact findings.
3. Estimate direct and related exposure impact inside the finding.
4. Attribute every computed anomaly when possible.
5. Mark weak or unexplained attribution honestly.
6. Read prior alert history to avoid annoying repeats.
7. Use available tools if submitted facts look wrong, stale, or worth deeper
   confirmation.
8. Return JSON only.
9. Push only for selected event impact or selected anomaly attribution.

### Node 8: Persist And Notify

Input:

- analyst output
- lane artifacts
- marked snapshot
- normalized events
- warnings

Output:

- persisted feed rows
- updated KV state
- notification sidecar

Persisted output:

- `portfolio.snapshot`
- `portfolio.positions`
- `event.items`
- `finding.records`
- `analysis.decision`
- `notify.message`
- `audit.run_log`
- `audit.persist_delta`
- KV state

Steps:

1. Persist portfolio snapshot.
2. Persist position rows.
3. Persist normalized event records.
4. Persist analyst findings.
5. Persist final decision and all event/anomaly lane artifacts.
6. Persist notification message or `<|SKIP_NOTIFICATION|>`.
7. Update rolling KV state for next run.
8. Append replayable audit log.
9. Append persist-delta summary.

## License

MIT. See `LICENSE`.
