# SautiLink Pilot moderation policy — warning, restrictions and bans

> Applies to prohibited links in Telegram supergroups running SautiLink Pilot.
> Member/group history is separate; normal admins and linked-channel exemptions remain.

## User-visible stages

| Event | Response | Can still read group? | Can post? |
|---|---|---|---|
| First prohibited link | Delete message; tag member with educational warning, no strike | Yes | Yes |
| Next prohibited link | Restrict posting 1 hour — Restriction 1/5 | Yes | No |
| Next after expiry | Restrict posting 12 hours — Restriction 2/5 | Yes | No |
| Next after expiry | Restrict posting 24 hours — Restriction 3/5 | Yes | No |
| Next after expiry | Restrict posting 3 days — Restriction 4/5 | Yes | No |
| Next after expiry | Restrict posting 7 days — Restriction 5/5 | Yes | No |
| Next after expiry | Ban 24 hours — Ban strike 1/3 | No | No |
| Next after expiry/rejoin | Ban 7 days — Ban strike 2/3 | No | No |
| Next after expiry/rejoin | Permanent ban — Ban strike 3/3 | No | No |

Each **restriction** calls `restrictChatMember` with all posting/media
permissions disabled and `use_independent_chat_permissions=true`. The
member remains in the group and can view messages. Telegram applies the
`until_date` automatically; the bot never grants all permissions on a timer,
as that could inadvertently override group default restrictions or manual
admin settings. Restrictions do not affect group-wide defaults. Owners/admins
may intervene through Telegram permissions.

Only a prohibited link after a **confirmed delivered warning** progresses
the restriction ladder. If warning notification cannot be proven delivered,
the next prohibited link is removed and another warning may be attempted; no
restriction or ban is issued. Messages sent at or before delivery (including
the same Telegram second), edited messages and media-album duplicates do not
advance a stage. A new link posted *during* an active restriction is removed
without escalation. After the restriction ends, a new prohibited link advances
to the next level.

**Forwards** without prohibited links preserve the prior ban escalation
(24 hours, 7 days, permanent). Messages containing a prohibited link,
including a forwarded prohibited link, use the link ladder. Whitelisted URLs,
bot/admin/linked-channel exemptions, command spam, raid/flood controls and
other independent features retain their pre-existing behavior.

## State and migration

`member_link_warnings` is the one-time per-member/group warning-delivery
ledger. `member_restrictions` is a separate five-level durable ledger
(`level`, `until_date`, `episode_at`, `incident_id`). Restriction
incidents use **negative strike values -1 through -5**, with the confirmed
status `restricted`. This is not a ban strike. Regular ban strikes remain
`members.strikes` 0..3, and old ban history is not rewritten. Telegram
restriction timestamps are stored in Unix seconds.

The **five restrictions apply to every member**, including those with
pre-existing confirmed ban strikes (1/3, 2/3 or 3/3). A member who has no
confirmed link-warning delivery gets the warning first. After confirmed
delivery, their next prohibited link starts Restriction 1/5, regardless of
old ban strike history. The five restriction levels are tracked separately.
No old ban strike is counted as a completed restriction and no existing
active Telegram ban is lifted during deployment.

After completing Restriction 5/5, the next prohibited link returns to the
member's preserved ban escalation: an old 1/3 becomes 2/3 (7-day ban), while
an old 2/3 becomes 3/3 (permanent ban). New users with no old ban strikes
begin with 1/3 (24-hour ban). Admins can use /forgive to reset the group
history explicitly, but rollout itself never wipes previous strikes.

A planned positive ban incident from the previous release that has **not**
been executed is translated to the correct negative restriction stage before
Telegram is contacted. Confirmed or uncertain ban outcomes are never
rewritten or retried blindly. Historical restrictions and warnings are
preserved, including any delivered warning from an older release.

`/unban` changes a Telegram ban but preserves strike/warning/restriction
history. `/forgive` resets both ban strikes, link warning and the
restriction ladder for that specific group; it does **not** lift a current
Telegram ban/restriction automatically. Admin overrides cancel old incidents
and stop reapplying them. A restricted member must wait until the timeout or
be released manually by a group administrator in Telegram; do not use
`unbanChatMember` to remove a restriction.

## Failure and idempotency safeguards

All moderation is processed through the group's serialized coordinator.
Deletion must succeed before restrictions or bans are requested. A confirmed
Telegram `true` response is required before marking a restriction
confirmed, incrementing the durable restriction level or announcing success.
`restriction_sent` and `restriction_uncertain` are explicit recovery
states; after an uncertain response, inspect `getChatMember` and compare
the exact `until_date` rather than blindly retrying a potentially
completed action. On definitive failure, preserve the incident for review
or a known safe retry. Telegram API 429 responses retain their retry budget.
Warnings, restrictions, ban strikes and notification delivery are tracked
independently, with no duplicate punishment on Telegram update replays.
Notifications do not claim that an unconfirmed restriction happened.

Telegram's API requires a supergroup and a bot admin with
`can_restrict_members`; deletion additionally requires
`can_delete_messages`. An account-wide Telegram restriction, e.g. inability
to participate in public groups, is *not* a Pilot group ban and cannot be
removed by Pilot.

## Public-facing disclosure and testing

Bot /rules, /howitworks, /status, group welcome messages, notices, Mini App,
the landing page, the website interactive simulator and README should display
the complete ladder and distinguish a mute from a ban. A warning and all
five restrictions should never be labeled 'permanent ban'.

Run `npm ci`, `npm run check`, `npm test`, `npm run build`.
Apply migration `0014_restriction_ladder.sql` in the existing D1 deployment
path, deploy to Cloudflare, then live-test with **consenting test accounts in
a test supergroup**. Do not punish real members for testing. Confirm the
5 restrictions in Telegram member permissions; simulate clocks in unit tests
for the full ban ladder. Confirm old strikes, command permissions,
overrides, duplicate updates, edited posts and notification retries.
Never claim a successful live Telegram test from CI tests alone.
