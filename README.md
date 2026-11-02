
## Personalized group welcome messages

Admins can enable customized bilingual welcome messages in **Dashboard →
Group Settings → Welcome message**. The existing on-join feature now supports
18 safe tags, including `{mention}`, `{name}`, `{user_id}`,
`{username}`, `{group_name}`, `{member_count}`, `{rules}` and
`{date}`; optional custom HTTPS button; live Mini App preview; and automatic
deletion of Pilot's own welcome after a chosen interval. Settings are per
group and OFF by default; older saved `{user}/{group}/{rules}` messages
keep working. Members are not punished for failing to read a welcome.

See [Welcome messages](docs/WELCOME_MESSAGES.md) for complete tag references,
Telegram permissions, delivery constraints and safety details.

# SautiLink Pilot

SautiLink Pilot helps Telegram communities manage moderation, member support
and group activities.

- **Bot:** [@sautilinkpilotbot](https://t.me/sautilinkpilotbot)
- **Website:** [pilot.sautilink.com](https://pilot.sautilink.com)
- **Integration guide:** [For developers](https://pilot.sautilink.com/developers)
- **Support:** [Contact SautiLink](https://sautilink.com/contact)

## Connect your group

1. Open the official bot privately and send `/start`.
2. Choose **Connect your group**, or send `/connect`.
3. Add Pilot to a Telegram supergroup that you manage.
4. Give it **Delete messages** and **Ban users** administrator permissions.
5. Send `/admin` in the group and open the private panel.
6. Use `/doctor` to check readiness, then choose the language and optional settings.

Join-request screening also needs **Invite users** permission and a group or
invite link configured to require join requests. Timed bans require a
supergroup.

The service runs through the official bot. Group admins do not need a bot token,
hosting account or a copy of this repository.

## Moderation rules

For an ordinary member, the first prohibited link in each group is removed
and the member receives a tagged educational **warning** (no strike). After
Telegram confirms warning delivery, further prohibited links progress through
five **no-post restrictions**. The person stays in the supergroup and can read
other people's posts, but cannot send messages or media during the restriction.
Only after **Restriction 5/5** do the original bans begin:

| Stage | Action | Duration | Still a member? |
| --- | --- | --- | --- |
| Warning | Delete link and tag member | No timed penalty | Yes |
| Restriction 1/5 | Prevent posting | 1 hour | Yes |
| Restriction 2/5 | Prevent posting | 12 hours | Yes |
| Restriction 3/5 | Prevent posting | 24 hours | Yes |
| Restriction 4/5 | Prevent posting | 3 days | Yes |
| Restriction 5/5 | Prevent posting | 7 days | Yes |
| Ban 1/3 | Remove from group | 24 hours | No |
| Ban 2/3 | Remove from group | 7 days | No |
| Ban 3/3 | Remove from group | Permanent | No |

Restrictions are implemented through Telegram `restrictChatMember`, never a
ban. Telegram lifts posting restrictions after `until_date`; Pilot retains
the attained level so that a new violation after expiry advances one level.
Old ban strikes are preserved, but **they never skip the five new
restrictions**. A member with an old 1/3 or 2/3 ban strike still starts with
the link warning (unless it has already been delivered), followed by
restriction 1/5 through 5/5. Once all five restrictions are complete,
the next prohibited link resumes their preserved ban ladder (for example,
old 1/3 becomes 2/3). No prior ban is automatically removed.
`/forgive` explicitly resets the warning, restrictions and ban strikes for
the specified group, without lifting any active Telegram punishment.

If delivery of the warning is unconfirmed, new prohibited links are deleted
and may receive warning reminders, never a premature restriction or ban.
Updates and media albums are idempotent. Forward-only messages continue to
use the earlier ban sequence, and an approved link does not exempt a forward.
A forwarded message containing a prohibited link follows the prohibited-link
sequence. Members do not automatically rejoin after a temporary ban expires.

See the [policy and rollout guide](docs/MODERATION_POLICY.md) for compatibility,
recovery and release checks.

Group owners, admins, anonymous admins and the group's actual linked-channel
posts are exempt. A member manually forwarding a channel post is still subject
to the forwarding rule. Admin decisions take precedence.

Approved destinations include HTTPS links to `sautilink.com` and its real
subdomains, plus these official Telegram destinations:

- `t.me/techhubtz`
- `t.me/sautilink`
- `t.me/sautilinkcloud_bot`
- `t.me/drcharlesofficial`
- `t.me/drcharlestz`

Group admins can configure additional allowances. Allowing a link does not
allow a forwarded message.

Long slash-code spam is deleted silently without a ban, mute or strike.
Normal bot commands remain available. Admins can configure exceptions for
unusual commands needed by their group.

## Member tools

| Command | Purpose |
| --- | --- |
| `/start`, `/help` | Open the menu and guides |
| `/rules` | Read moderation rules |
| `/language` | Choose English or Kiswahili |
| `/checklink URL` | Check whether a link meets the base link policy |
| `/mystatus` | View your own cases |
| `/appeal CASE_ID reason` | Appeal one of your cases privately |
| `/tools` | Open community tools |
| `/ask question` | Search your group's approved answers |
| `/events` | View group events, RSVP and optional reminders |
| `/support` | Open a private ticket with group admins when enabled |
| `/communities` | Explore communities that opted into the public directory |
| `/flag reason` | Reply to a group message to ask admins to review it |
| `/feedback` | Send product feedback to the Pilot owner |

Use a group's commands from that group when Pilot needs to identify the relevant
community. Private information is available only to the people entitled to see it.

## Group administration

Open `/admin` or `/dashboard` to manage groups for which your current Telegram
account has administrator rights. The panel provides settings, allowed links,
incident history, appeals, reports and optional community tools.

Optional tools include welcomes, flood control, join screening, scheduled
announcements, events, approved answers and community pages. Review each setting
before enabling it.

- `/doctor` checks the group’s permissions and readiness.
- `/policytest` tries sample messages against group rules without deleting messages or applying penalties.
- `/pause` and `/resume` control new-message moderation.
- `/strikes USER_ID` shows this group's ban strikes and link-warning state.
- `/unban` removes a ban while retaining strikes and the link warning.
- `/forgive` resets this group's strikes and link warning while retaining an existing Telegram ban.
- `/alerts` and `/report` manage your private group notifications.

Global Pilot product announcements are reserved for the authorized Pilot owner.
Managing a group does not grant permission to announce to other groups.

## Events and reminders

In **Community tools → Events**, admins can choose the group's event timezone,
publish events and set an optional attendance capacity. A full event places
additional Going responses on a waiting list.

Members can respond to an event and download its calendar entry. To receive
private reminders, first open Pilot privately, then enable reminders for that
event. This choice also covers event changes, cancellations and waiting-list
confirmations. Declining an event turns its reminders off. Download the calendar
entry again after an event is changed.

## Private member support

A group admin can enable **Member support** in Community tools. Members open
Pilot privately and use the selected group's support page to create a ticket.
Only that member and current admins of the relevant group can read the ticket.

Admins can claim, reply to and resolve tickets. Members can read replies in
their ticket even if a private Telegram notification cannot be confirmed.
Pausing new tickets keeps existing tickets available for handling.

## Discover communities

[Explore communities](https://pilot.sautilink.com/communities) lists only groups
whose admins deliberately enable discovery for a public community page.
Publishing a page does not list it automatically. Private and unlisted pages
cannot appear in the directory.

Admins can choose a category and remove their community from the directory at
any time. The public listing contains the approved community description and
link; it does not expose members, reports or moderation history.

## Integrate with Pilot

The [integration guide](https://pilot.sautilink.com/developers) describes the
supported API and examples. A current group admin can create a scoped credential
for approved knowledge, events or draft proposals. Credentials apply to their
selected group and can be revoked.

Keep credentials in your application's secret storage. Never publish them in
source code, public URLs or group messages. An integration draft still needs
admin review before publication.

## Privacy and help

Read the [Privacy page](https://pilot.sautilink.com/privacy) and the
[user data guide](docs/USER_DATA.md). For a moderation decision, contact the
relevant group admin or use the private appeal tool. For a service problem,
contact [SautiLink](https://sautilink.com/contact).

## Ownership and permitted use

Copyright © 2026 SautiLink Corporation. All rights reserved.

This project is proprietary. Copying, reusing, distributing or repackaging its
protected implementation requires prior written permission, subject to the
exceptions in [LICENSE](LICENSE). Using the hosted bot and documented
integrations does not grant a license to the implementation.

Third-party components retain their own licenses and notices.
