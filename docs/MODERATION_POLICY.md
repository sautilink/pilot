# First prohibited-link warning

Pilot records one first-link warning for each Telegram member in each group.
After confirmed deletion of the first prohibited link, it records a warning
incident and tags the member with a clear explanation that posting another
prohibited link will trigger a ban. The warning adds no ban strike.

For a member with no prior ban strikes, later prohibited links progress through
24 hours, 7 days and permanent bans. A message with both a prohibited link and
forward metadata receives the link warning if due. Forward-only violations,
including forwards containing only permitted links, keep the existing direct
ban progression. Exempt senders, permitted links, paused groups, message age
checks and human admin decisions retain their existing behavior.

## Existing records and admin decisions

The warning marker is separate from `members.strikes`. Deployment does not
reinterpret or clear old strikes, fabricate past warnings, or lift existing
bans. An eligible member with legacy strikes and no recorded link warning
receives one warning on their next prohibited link. The following violation
resumes at their retained next ban level, for example an existing strike count
of 1 leads to a 7-day ban after the warning. An existing active ban still wins
over a queued message.

An earlier warning-first release may already have recorded warnings as incidents
without a separate durable marker. Existing deleted, `warned` link incidents are
adopted into the new per-member/group ledger, preserving the warning already
given. Delivery is adopted only from a matching confirmed `sent` notification
record with a valid Telegram message ID. The notification's delivery timestamp
is retained for the queued-message protection below. A notified flag, an old
strike, an incident alone, or an unknown/failed/pending delivery is not proof
that a warning reached Telegram. Without delivery proof, later prohibited links
receive warning reminders rather than bans. Existing ledger entries, strikes,
ban state and admin overrides are preserved during adoption.

This release explicitly replaces the earlier prototype's stricter handling of
mixed link/forward messages, legacy strikes and same-second messages with the
policies stated here. It does not replay old warnings merely because the
storage format changed, or reverse a ban already sent by that release.

An unsent legacy link incident still in the planned state is converted to a
warning if there is no confirmed warning delivery. This includes a retry after
failed deletion or a definite rate-limit rejection. Already sent, uncertain or
confirmed ban requests keep their existing reconciliation path, because Telegram
may have applied the ban already.

`/strikes USER_ID` privately shows ban strikes and whether the link warning is
still due, recorded with delivery unconfirmed, or confirmed delivered. A warning
unlocks later link bans only once Telegram confirms its delivery.
Queued messages with an event timestamp at or before that delivery time are
deleted without a ban strike; this also protects messages sent in the same
second as delivery. A later edit is evaluated using its edit timestamp.
`/status` and case history show announcement delivery separately.
`/unban` preserves strikes and warning state. `/forgive` resets both in that
group, granting a fresh warning, and does not itself lift a Telegram ban.
Correcting one ban strike through a case review does not reset the warning.
`/bancheck` continues to diagnose the latest recorded ban rather than treating a
warning as a ban.

## Persistence and recovery

The additive migration creates a warning-marker table; it does not rewrite
legacy members or incidents. The runtime prepares this schema family and adopts
eligible warning and delivery records for existing Workers installations. The
durable marker survives the existing
30-day incident cleanup. Warning incidents have strike 0 and no ban end date;
they must be displayed as warnings, never interpreted as permanent bans.

Deletion must be confirmed before a warning is consumed. A failed deletion
leaves the warning available for retry. Edits, duplicate deliveries and album
parts reuse the incident identity, so they do not create a second warning or
advance ban strikes. The existing per-chat Durable Object serializes moderation
updates and admin commands. Announcement delivery uses its existing claim and
recovery state separately from moderation state. If a warning fails or its
delivery is ambiguous, another distinct prohibited-link message is deleted and
receives a warning reminder, without a ban strike. Only a confirmed warning or
reminder delivery unlocks bans for later prohibited links. Replaying one warning
incident never sends it twice; distinct later messages can carry reminders.
Ambiguous Telegram sends remain unconfirmed rather than being announced as
delivered. Forward-only violations retain their existing progression.

## Release checks

Run `npm ci`, `npm run check`, `npm test` and `npm run build`. Apply D1 migrations
through the existing deployment procedure, then deploy the tested Worker.
Verify the production Worker version and a controlled test supergroup before
claiming live Telegram behavior has been verified. Test the first prohibited
link, the tagged warning, a duplicate/album, a second prohibited link and the
appropriate ban duration. Do not use production members as test subjects.
