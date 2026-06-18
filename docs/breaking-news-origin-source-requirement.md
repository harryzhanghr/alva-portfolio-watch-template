# Breaking News Source-Time Requirement

## Problem

In the breaking-news lane, Pi may discover an event from a fresh X post, but the underlying source can be older. The automation should let the analyst see that distinction.

## Requirement

For every X-discovered breaking-news event, Pi should try to find the event's original / official source and attach one extra timing field:

```json
{
  "source_event_time": "2026-06-12T00:00:00Z"
}
```

Meaning:

- Prefer the timestamp/date from the most official source.
- If no official source is found, use the earliest credible source Pi can find.
- If Pi cannot find any credible source beyond X, set `source_event_time` to `null`.

Existing fields like `source_links`, `published_at_iso`, `source_time_label`, and `confidence` can stay as they are. This requirement only adds the source/origin timing signal the analyst needs.

## Brave Search Rule

For this source lookup step, Brave search should not be restricted to the recent event window.

This is different from per-asset event search, which intentionally looks back only around the latest run window.

Breaking-news source expansion should be allowed to find older official / primary sources, because the X post may be fresh while the real source event happened days earlier.

## Analyst Usage

The analyst should compare:

- X discovery / X post freshness
- `source_event_time`

If the X post is fresh but `source_event_time` is old, treat it as a resurfaced / newly discussed older event unless there is clear new market reaction or new information.
