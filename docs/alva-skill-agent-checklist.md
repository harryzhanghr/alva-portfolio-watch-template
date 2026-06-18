# Alva Skill Agent Checklist

Use this checklist when adapting the template for a new user's Alva account.

## Required Before Creation

- Confirm the user has a connected portfolio account in Alva.
- Obtain the connected account id.
- Choose a feed name, usually `portfolio-watch-automation`.
- Choose or confirm the Alva owner username for audit data paths.
- Decide whether notification delivery should be enabled immediately or only
  after a dry run.

## Runtime Args To Set

- `feedName`
- `accountId` or `connectedAccountId`
- `ownerUsername`
- `runSource`
- optional `aliases`
- optional `fallbackThemeMap`

## Do Not Hardcode

- The template author's username.
- Any private account id.
- Feed id or cronjob id from another user.
- A real portfolio's holdings, aliases, or themes.
- Historical run logs.
- Broker prices, market values, cost basis, or P&L.

## Dry Run Verification

After the first run, inspect:

- `portfolio.snapshot`
- `portfolio.positions`
- `event.items`
- `analysis.decision`
- `audit.run_log`
- `notify.message`

The run is healthy if:

- portfolio ingest returns holdings;
- positions use connected quantity and Arrays current price when available;
- raw events and event candidates are persisted;
- computed anomalies create per-asset anomaly attribution packets when anomaly
  triggers exist;
- quiet runs write `<|SKIP_NOTIFICATION|>`;
- no private template data appears in outputs;
- the audit playbook can load the configured feed path.

## Push Readiness

Enable user-visible notifications only after confirming:

- the analyst JSON parses;
- final statuses are populated for event candidates and anomalies;
- the per-asset anomaly attribution agent is configured before the final
  analyst and references Skill Hub why-the-move methodology when available;
- no deterministic post-analyst repeat override is present;
- selected findings are required before push;
- notification copy does not contain buy/sell advice.
