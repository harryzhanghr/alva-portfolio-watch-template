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
  search, runs one Alva Ask anomaly-attribution agent per computed anomalous
  asset, runs final Alva Ask analyst review, persists audit artifacts, and
  writes a notification sidecar.
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

1. Read connected portfolio positions and cash.
2. Drop broker prices, broker market values, cost basis, and P&L.
3. Fetch Arrays latest 1min, hourly, and daily bars for current holdings or
   option underlyings.
4. Mark holdings to Arrays latest price where coverage exists.
5. Extract current holding themes with Alva Ask.
6. Fetch per-holding market news, analyst/price-target news, and earnings
   calendar rows.
7. Fetch macro context.
8. Check prediction-market rate repricing for the next three Fed decisions.
9. Fetch recent indexed X rows in code, rank by engagement, and send top rows
   to Pi for market-breaking review.
10. Let Pi handle theme/topic news search and event-to-holding mapping.
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
