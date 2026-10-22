# Telegram response performance — 22 October 2026

## Evidence and scope

Pilot was compared against its deployed baseline, commit `44389093c3edd4f37a3ee51d3ea2637694062847`. Cloud Engine was inspected read-only at `sautilink/sautilink-cloud-engine` commit `7d0325b762ebe1e558afe89f7adfc454f00b7564`.

The profiler imports the actual moderator, tools, owner service and identity resolver. SQL runs through the real SQLite-backed `TestD1` adapter, including transactional batches and constraints. Telegram is a deterministic in-process fake: it makes no network calls and cannot send messages or moderate real members. Both versions use the same fixtures. A warm path is the second update through the same coordinator with schema and identity ready; a cold path starts a new binding with the database already provisioned.

The reported counts are **D1 binding round trips**, not SQL-statement counts or measured production milliseconds. HTTP ingress adds **one uncached readiness read** to both versions. Its empty callback acknowledgement, metadata maintenance, Cloudflare object routing and live network transport are outside these coordinator traces.

Run the current implementation with Node 22.13 or later:

```sh
npm run profile:bot
# Optional label and a separate /tmp JSON report:
PILOT_PROFILE_LABEL=release PILOT_PROFILE_OUTPUT=/tmp/pilot-speed-release.json npm run profile:bot
```

The script also runs a deliberately artificial queue demonstration with 10 ms per D1 round trip and 50 ms per Telegram call. Those constants are scenario inputs, not live measurements. It reports the original SQL and synthetic IDs only in the local development report; production performance logs contain neither.

## Measured reduction

| Warm coordinator path | Baseline D1 trips | Optimized D1 trips |
|---|---:|---:|
| Private `/start`, before reply | 3 | 1 |
| Private `/help`, before reply | 2 | 1 |
| Help callback, before menu edit | 2 | 1 |
| Home callback, before menu edit | 3 | 1 |
| Group `/help`, before reply | 6 | 1 |
| Ordinary group text, complete handling | 5 | 2 |
| Prohibited link, before deletion | 9 | 4 |
| Prohibited link, before ban | 11 | 6 |
| Prohibited link, before explanation notice | 18 | 10 |
| Prohibited link, complete handling | 21 | 13 |
| Long slash code, before silent deletion | 9 | 3 |
| Long slash code, complete handling | 14 | 6 |

The link fixture above already has a member row. A new member previously added another round trip; creation is now included in the incident-planning transaction. Cold group help decreased from 9 to 4 total D1 calls, and cold link moderation from 23 to 15.

The link fixture still performs eight Telegram calls; slash cleanup still performs four. Initial independent membership lookups overlap, while the fresh checks immediately before deletion and banning remain separate. Less serialized D1 work also releases the group queue sooner for the next command.

Batching reduces network trips rather than every SQL statement. Ordinary text still uses five SQL statements across two calls. Atomic member/group safeguards increase the link fixture from 23 to 26 statements while reducing its calls from 21 to 13. This change should not be represented as a reduction in every billing dimension or as an end-to-end latency guarantee.

## Why Cloud Engine feels different

Cloud Engine uses Pages Functions and awaits its `processUpdate` call before acknowledging the webhook. Its warm static `/start` and `/help` paths use memory-resident preferences and static presentation, then call Telegram once. Expensive diagnostic commands send a visible checking message before requesting the diagnostic result. Its optional profile hydration uses Supabase REST with a 1,500 ms timeout; a warm cache is not proof that all requests avoid storage.

Pilot has additional responsibilities: durable update deduplication, per-group configuration, current admin permissions, strikes, uncertain-action recovery and explanatory delivery tracking. Removing those protections to imitate a diagnostics bot would change moderation correctness. The useful practices adopted here are shorter presentation paths, reuse of data within one request, independent I/O in parallel and keeping metadata maintenance out of foreground response work.

Relevant Cloud Engine source: `functions/api/telegram/webhook.js`, `src/telegram/bot.js`, `src/telegram/bot_core.js`, `src/telegram/preferences.js`, `src/telegram/i18n/index.js` and `src/telegram/personalisation.js` at the reviewed commit. No Cloud Engine source or deployment was changed.

## Implementation boundaries

`loadUpdateContext()` performs one fresh batch per update. It contains language/settings and owner navigation visibility only. Owner broadcasts and admin operations still authorize independently. Context is never a cross-request role cache.

Additive whitelist rules are loaded only if global analysis finds a potentially blocked URL. Forward detection remains independent. Ordinary message observation is combined with successful processed-update recording; retries may record group discovery without marking the update complete. Existing disconnect and migration ordering remains authoritative.

Incident planning, confirmation, notification claims and manual overrides retain their transactional guards. Uncertain Telegram mutations are reconciled instead of blindly repeated. A ban notice follows confirmed Telegram success; silent slash cleanup does not create an incident, strike, mute or ban. Human admin overrides, current admin exemptions and linked channels remain protected.

Automatic metadata synchronization now has an independent subscription version, a unique renewable lease and persisted confirmed progress. One background phase performs identity plus a subscription change, or identity plus at most three independent profile calls. Subsequent authenticated updates resume remaining work. Protected initial setup still awaits every required operation. This release leaves the current experience version unchanged, so an installation already on the confirmed October 22 `.4` metadata does not trigger a needless resynchronization.

## Production diagnostics

The Worker logs `pilot_performance` for a 2% sample of normal requests and for slow/failed requests. Read its fields as follows:

| Field | Meaning |
|---|---|
| `route` | `webhook` for authenticated ingress, or a bounded coordinator route |
| `queue_ms` | Time waiting for this coordinator's earlier work |
| `handling_ms` | Wall-clock time inside this request's active processing |
| `db_calls`, `db_ms` | D1 round-trip count and summed call duration; one batch is one call |
| `telegram_calls`, `telegram_ms` | Completed API call count and summed duration, including failures |
| `first_reply_ms` | Time from coordinator enqueue to the first confirmed message/edit result |
| `first_action_ms` | Time from coordinator enqueue to the first confirmed delete/ban/restrict result |
| `callback_ack_ms` | Acknowledgement completion inside this timed request, when handled there |

An acknowledgement started at HTTP ingress is outside the coordinator's timing, so its coordinator field can be null. These timestamps indicate Telegram API confirmation, not when an individual user's client paints the message. Database and Telegram duration sums may overlap after parallelization. Do not add them or subtract them from wall-clock time as if they were sequential.

No production p50/p95, webhook backlog, D1 network RTT or Telegram delivery measurement was available for this comparison. The evidence establishes removable work in the code. The new stage measurements allow production logs to distinguish a busy group queue, slow D1 calls and Telegram API waits. A hosting migration, D1 replacement, read replica or placement change should follow those measurements rather than assumptions.

Platform references: [D1 batching](https://developers.cloudflare.com/d1/worker-api/d1-database/), [Workers context and waitUntil](https://developers.cloudflare.com/workers/runtime-apis/context/), [Telegram Bot API webhook responses](https://core.telegram.org/bots/api#making-requests-when-getting-updates).
