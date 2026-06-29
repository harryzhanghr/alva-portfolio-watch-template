# Alva Portfolio Watch Template

Open-source template for creating a low-noise portfolio watch automation on Alva.

The automation is not a daily news digest. It monitors a user's configured
portfolio, looks for material events or unusual held-asset moves, attributes
those moves when possible, and only pushes when the user is likely to be glad
they were interrupted. The portfolio can be a dynamic connected snapshot or a
static portfolio file maintained during setup.

## What Is Included

- `src/portfolio-watch-automation.js`  
  Production-style Alva automation source. It reads either a dynamic connected
  portfolio or a static portfolio file, fetches market/event data, computes
  price and volume anomalies, reads an external Breaking News event feed,
  reviews portfolio-specific event mappings, runs one Alva Ask
  anomaly-attribution agent per computed anomalous asset, runs final Alva Ask
  analyst review, persists audit artifacts, and writes a notification sidecar.
- `playbooks/audit-log/index.html`  
  A reusable audit playbook UI for inspecting official cron runs, raw events,
  event candidates, qualified event assessments, computed anomalies,
  per-asset attribution packets, final anomaly attributions, final status
  reasons, persisted file deltas, and notification output.
- `playbooks/audit-log/README.md`  
  Audit UI configuration notes.
- `docs/simple-design-playbook.md`  
  The compact design guide.
- `docs/pseudo-code-playbook.md`  
  The detailed plain-language pseudo-code runbook.
- `docs/breaking-news-origin-source-requirement.md`  
  Source-origin requirement for the upstream Breaking News feed that Portfolio
  Watch reads by default.
- `docs/alva-skill-agent-checklist.md`  
  Short deployment and verification checklist for Alva Skill Agents.
- `examples/env.args.example.json`  
  Example Alva runtime args. Replace every placeholder before deployment.

## For Alva Skill Agents

Use this section as the implementation contract when creating a user's own
Portfolio Watch on Alva.

### Goal

Create one private Alva automation and one audit playbook for a user's own
portfolio setup. The result should be user-specific, but this repo must remain
generic: do not hardcode the template author's username, account id, holdings,
feed id, cron id, aliases, themes, or run logs.

### Required User Inputs

Ask for or infer these from Alva workspace state:

- `portfolioMode`: `dynamic` or `static`.
- For `dynamic`: one or more connected portfolio account ids. Use `accountIds`
  / `connectedAccountIds` / `portfolioAccountIds` for multi-broker setups, or
  `accountId` / `connectedAccountId` for a single account.
- For `static`: `staticPortfolioPath`, an ALFS JSON file that contains
  `holdings[]` or `tickers[]`.
- `positionCompleteness`: `full_quantity` or `ticker_only`. Dynamic portfolios
  are always `full_quantity`. Static portfolios can be either.
- `ownerUsername`: the Alva username that owns the feed.
- `feedName`: desired feed name. Default recommendation:
  `portfolio-watch-automation`.
- Push target / notification wiring, if the user's Alva environment requires it.
- Optional `externalBreakingNewsFeedPath`. By default the template reads
  `~/feeds/breaking-news/v1/data/events/current`, resolved under the deploying
  Alva user. Set an absolute `/alva/home/<username>/...` path to use a shared
  Breaking News feed instead.
- Optional `aliases`: ticker/company aliases for better event matching.
- Optional `fallbackThemeMap`: continuity fallback only. The automation extracts
  current themes every run with Alva Ask, so do not overfit this map.
- Optional `allowEmptyConnectedAccounts`: defaults to `false`. Keep the default
  for aggregate portfolios so a configured connected account that returns zero
  usable holdings fails loudly instead of running a partial portfolio. Set to
  `true` only for intentionally empty or cash-only connected accounts.

### Runtime Args

Pass these through `env.args` when creating the automation:

```json
{
  "feedName": "portfolio-watch-automation",
  "portfolioMode": "dynamic",
  "positionCompleteness": "full_quantity",
  "accountIds": ["<CONNECTED_ACCOUNT_ID_1>", "<CONNECTED_ACCOUNT_ID_2>"],
  "ownerUsername": "<ALVA_USERNAME>",
  "runSource": "cron_push_pipeline",
  "timeouts": {
    "runBudgetMs": 2700000,
    "themeExtractionMs": 720000,
    "externalBreakingMappingMs": 1200000,
    "internalBreakingNewsMs": 1200000,
    "anomalyAttributionMs": 900000,
    "analystMs": 1200000,
    "analystRepairMs": 360000
  },
  "breakingNewsSourceMode": "external_feed",
  "externalBreakingNewsFeedPath": "~/feeds/breaking-news/v1/data/events/current",
  "externalBreakingNewsPiChunkSize": 20,
  "externalBreakingNewsPiRetryCount": 1,
  "allowEmptyConnectedAccounts": false,
  "aliases": {
    "TICKER": ["TICKER", "Company Name", "$TICKER"]
  },
  "fallbackThemeMap": {
    "TICKER": ["theme-a", "industry-b"]
  }
}
```

Static ticker-only example:

```json
{
  "feedName": "portfolio-watch-automation",
  "portfolioMode": "static",
  "positionCompleteness": "ticker_only",
  "staticPortfolioPath": "~/portfolio-watch/static-portfolio.json",
  "ownerUsername": "<ALVA_USERNAME>",
  "runSource": "cron_push_pipeline"
}
```

The source intentionally fails fast if the configured source is missing:
dynamic mode requires at least one configured account id; static mode requires
`staticPortfolioPath`. When dynamic mode receives multiple account ids, it reads
each connected snapshot and aggregates same-symbol holdings plus cash before any
market-data, event, anomaly, or analyst step. By default, every configured
connected account must return at least one usable holding; this keeps aggregate
portfolio runs from silently analyzing only the accounts that happened to return
data.
Default timeout budgets are intentionally wide for larger multi-account
portfolios; keep `timeouts` in the cron args when portfolios may contain many
tickers.

### Creation Steps

1. Copy `src/portfolio-watch-automation.js` into an Alva automation.
2. Set `env.args.feedName`, `env.args.portfolioMode`,
   `env.args.positionCompleteness`, and the matching source field
   (`accountIds` / `connectedAccountIds` / `portfolioAccountIds` for dynamic,
   or `staticPortfolioPath` for static).
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
- Dynamic mode pulls the connected portfolio snapshot each run.
- Static mode reads the configured static portfolio file each run; holdings
  stay unchanged until setup/update writes a new file.
- `full_quantity` portfolios can compute market value, weights, NAV deltas, and
  exposure percentages when market data coverage exists.
- `ticker_only` portfolios can monitor held tickers, themes, price/volume
  anomalies, event mapping, and related-holding logic, but must not invent
  position weights, market value, NAV, or exposure percentages.
- Broker current price, broker market value, cost basis, realized P&L, and
  unrealized P&L must not be used as portfolio context in this version.
- Portfolio valuation uses source quantity and cash plus Arrays latest 1min
  price when `full_quantity` is available.
- Price anomaly uses latest 1min extended-hours price vs previous regular close
  when 1min coverage exists.
- Volume anomaly uses hourly cumulative volume versus historical same-time
  cumulative volume.
- Market-breaking source events come from the configured external Breaking News
  feed by default. That upstream feed handles market-wide discovery, source
  expansion, event clustering, and source confidence.
- Portfolio Watch code first pre-maps external events by direct ticker,
  option-underlying, theme, and macro/risk bucket.
- A Pi portfolio mapping agent then reviews those pre-maps and cross-checks
  remaining external events for source-grounded related holdings. It does not
  search for news, expand sources, or decide push/no-push.
- Rate repricing discovery checks prediction-market odds for the next three
  Fed decisions and adds only material probability changes to the event lane.
- Event lane and anomaly lane are separate.
- Event candidates are a review long list, not pre-approved findings.
- Anomalies are computed facts, not event candidates.
- Each computed anomaly gets a per-asset Alva Ask attribution packet before the
  final analyst pass.
- Alva Ask analyst decides event qualification, final anomaly wording,
  selected/suppressed status, decision-lens PM framing, and final push/no-push.
- Pushed notifications should read like short PM notes: single selected findings
  use 2-3 compact sentences, while multiple selected findings use one bullet per
  finding with short link anchors, thesis/risk, key levels, and watch-next.
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

1. Read the configured portfolio source: dynamic connected snapshot or static
   ALFS portfolio file.
2. Normalize tickers and, when available, quantity/cash. Drop source prices,
   market values, cost basis, and P&L.
3. Fetch Arrays latest 1min, hourly, and daily bars for current holdings or
   option underlyings.
4. Mark holdings to Arrays latest price where coverage exists.
5. Extract current holding themes with Alva Ask.
6. Fetch per-holding market news, analyst/price-target news, and earnings
   calendar rows.
7. Fetch macro context.
8. Check prediction-market rate repricing for the next three Fed decisions.
9. Read the configured external Breaking News event feed for market-wide events
   over the lookback window.
10. Pre-map external events by direct ticker, option-underlying, theme, and
   macro/risk bucket, then let Pi review the mapping against the current
   portfolio.
11. Normalize and dedupe raw event records.
12. Build event candidates from all non-duplicate event records.
13. Build computed asset anomalies from price/volume triggers.
14. Run one Alva Ask anomaly-attribution agent per computed anomalous asset.
15. Send event candidates, computed anomalies, and attribution packets to the
   final Alva Ask analyst for selection, decision lens, and PM-note wording.
16. Persist raw events, event candidates, qualified event assessments, computed
   anomalies, attribution packets, final anomaly attributions, final status
   reasons, and notification output.
17. Push only if the analyst selected at least one finding and wrote a message.

## Playbooks

The repo keeps local Markdown snapshots so agents can adapt the template without
needing access to the template author's private Alva workspace:

- [docs/simple-design-playbook.md](docs/simple-design-playbook.md)
- [docs/pseudo-code-playbook.md](docs/pseudo-code-playbook.md)

## License

MIT. See `LICENSE`.
