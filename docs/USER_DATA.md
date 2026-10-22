# Pilot user data guide

This guide describes information used by the service. The current public
[Privacy page](https://pilot.sautilink.com/privacy) provides additional context
and contact information.

## What is used

Pilot uses the Telegram identifiers and message information needed to perform
the requested moderation and group tools. Routine moderation does not create an
archive of group conversations. Admin-entered settings, approved content and
member-submitted appeals or reports are retained for their stated purpose.

Case history belongs to the relevant group. Members can view their own cases;
current group admins can review that group's administrative information.
Possessing a panel link does not grant access.

## Retention

| Information | Retention or control |
| --- | --- |
| Incident details and moderation notices' delivery records | 30 days |
| Appeals and their decisions | 30 days under the relevant record's retention window |
| Admin activity and completed action records | 30 days |
| Join requests and screening records | 7 days |
| Reports submitted through `/flag`, including an excerpt of up to 500 characters | 30 days |
| Feature and problem feedback | 90 days; visible to the Pilot owner |
| Completed or cancelled schedules and delivery history | Eligible for cleanup after 30 days |
| Events and RSVP responses | Eligible for cleanup 30 days after the event ends |
| Event waiting-list and reminder subscriptions | Eligible for cleanup 30 days after the event ends |
| Completed, failed or unconfirmed event-notice delivery records | Eligible for cleanup after 30 days |
| Support tickets, their messages and delivery history | Eligible for cleanup after 90 days without activity |
| Private-contact eligibility information | Telegram identifier and contact timestamps; eligible for cleanup after 365 days without new contact |
| Aggregated service performance summaries | Eligible for cleanup after 7 days; no message text or Telegram user/group identifiers |
| Curated community highlights | Eligible for cleanup after 30 days |
| Configuration history | Up to 100 recent snapshots per group, for up to 90 days |
| Temporary link allowances | Apply only until expiry; eligible for cleanup one day later |
| Raid account signals | Up to 24 hours |
| Raid warnings | Up to 30 days |
| Integration draft proposals | Up to 30 days |
| Integration credentials | Expire within 90 days or when revoked; expired records are eligible for cleanup 30 days after expiry |
| Owner broadcast content and delivery outcomes | Eligible for cleanup after 30 days |
| Strike totals | Remain until a group admin resets them |
| Group settings, approved answers, community pages and language preferences | Retained for continued service until changed or removed |

Cleanup is periodic, so deletion of eligible records may take more than one pass.
Removing a service record does not delete a message already delivered to Telegram
or a calendar file already downloaded.

## Publication choices

Community pages start private. A group admin may publish selected information
as public or unlisted. Anyone with an unlisted URL can read it. Sharing approved
answers on a community page is a separate admin choice.

Appearing in **Explore communities** requires another explicit admin choice.
A public page is not listed automatically, and private or unlisted pages cannot
be listed. Opting out or unpublishing removes the directory listing.

Only information deliberately selected for publication belongs on a public page.
Private moderation histories, reports, member identifiers and credentials are
not part of the public community page.

## Private support and event notices

Support is enabled separately by each group. Only the ticket's member and the
relevant group's current admins can read and handle the conversation through Pilot.

Event reminders are a member's explicit choice for each event after opening
Pilot privately. The choice also covers event changes, cancellations and
waiting-list confirmations. Members can turn it off; declining an event turns
it off automatically. Other members see aggregate attendance counts and their
own response, not a participant roster.

## Questions

Use [SautiLink Contact](https://sautilink.com/contact) for privacy questions or
requests. For a group case, open the bot privately or contact that group's
admins. Never include a bot token, integration credential or login code in a
public report.
