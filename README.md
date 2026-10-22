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

For an ordinary member, a prohibited link or forwarded message is removed and
the confirmed offense follows this group-specific sequence:

| Offense | Ban |
| --- | --- |
| First | 24 hours |
| Second | 7 days |
| Third and later | Permanent |

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
- `/unban` removes a ban while retaining the strike history.
- `/forgive` resets this group's strike history while retaining an existing ban.
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
