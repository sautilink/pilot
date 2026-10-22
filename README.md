# SautiLink Pilot

Telegram moderation for any eligible group, with a bilingual Telegram Mini App, private member tools, and optional group controls, hosted on the owner's existing Cloudflare Worker.

- **Bot:** [@sautilinkpilotbot](https://t.me/sautilinkpilotbot)
- **Website:** https://pilot.sautilink.com
- **Worker:** `sautilink-pilot`
- **Repository:** https://github.com/sautilink/pilot

## Shared SautiLink interface

The public site, setup and privacy pages, and Telegram Mini App use the same visual language as SautiLink Router: Inter, the official SautiLink logo, neutral grouped surfaces, rounded cards and restrained blue actions. The public home puts the group connection steps on the first screen. Swahili and English share the same layout, including narrow mobile screens.

The website opens in English unless `?lang=sw` is selected; internal links preserve the explicit language choice. Public pages and the Mini App reuse Router's self-hosted animated icon package. Icons have static SVG artwork before JavaScript loads, animate on interaction and introductory headings, and respect reduced-motion preferences. The scripts load with `defer` from cacheable same-origin routes without querying Telegram or the database. Source provenance and upstream licenses are in `src/vendor/public-icons/`.

Moderation notices end with “SautiLink Pilot · from SautiLink Corporation”. The corporate attribution links to `https://www.sautilink.com/` in Telegram, with website previews disabled. All notice styles and both languages share this footer; the plain-text fallback retains the URL.

Appearance follows Telegram or the device preference unless the visitor chooses light or dark. An explicit choice travels in a `theme` URL parameter; Pilot does not store it in browser storage or copy Telegram launch credentials into navigation links. The public site remains informational, while group data and administrative actions require the verified Telegram identity described below.

## Search discovery and indexing

The server renders the public homepage and privacy page with English and Swahili metadata. Each language has a clean canonical URL and reciprocal `hreflang` links; theme, tracking, and Telegram launch parameters do not enter search metadata. `/robots.txt` advertises `/sitemap.xml`, which lists only those four canonical public URLs. Dates are omitted until there is a reliable content modification date; every request or code deployment is not presented as a content update.

The setup and dashboard shells remain crawlable so engines can read their `noindex` directives. Private APIs, webhook responses, health responses, and error responses also carry `X-Robots-Tag: noindex, nofollow`. Existing authentication continues to protect all group and operator data. Public icon assets remain crawlable for rendering.

After a public content change has reached production, the explicit IndexNow helper can notify participating search engines in one batch:

```sh
node scripts/notify-indexnow.mjs --dry-run
node scripts/notify-indexnow.mjs --submit
```

The helper checks the deployed public proof file, response statuses, canonical URLs, and indexing directives before submitting. It uses no Telegram or Cloudflare credentials, runs no background schedule, and does not retry automatically. The random IndexNow key is a public proof-of-hosting value; it grants no access to Pilot. HTTP 200 means the notification was received; HTTP 202 means key verification is still pending. Neither response guarantees crawling, indexing, ranking, or inclusion in every search engine.

For Google, verify the domain or URL-prefix property in [Search Console](https://search.google.com/search-console), submit `https://pilot.sautilink.com/sitemap.xml`, and inspect the canonical homepage URL. Submit the same sitemap in [Bing Webmaster Tools](https://www.bing.com/webmasters). Account verification must use the real token or DNS record provided by that service. Keep Cloudflare firewall, challenge, and crawler policies compatible with the public search crawlers you want to reach; application-level robots instructions cannot override an edge block.

Reference: [Google sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), [Google noindex guidance](https://developers.google.com/search/docs/crawling-indexing/block-indexing), and the [IndexNow protocol](https://www.indexnow.org/documentation).

## Response path and performance

Each authenticated webhook reads readiness and experience metadata in one fresh D1 snapshot. Commands reuse the moderator's durable replay check; direct command handlers still check replays themselves. Recognized ordinary menu buttons start an empty Telegram acknowledgement before waiting for the group coordinator, while authorization and any requested action still run inside the normal checked path. Owner announcements and join challenges retain their separate callback handling.

Schema-family versions are persisted so a new coordinator can reuse an already prepared database without replaying table creation. Existing group/member records use a read without an unnecessary insert. Verified bot identity can be reused across coordinators sharing a database binding and token; member roles, permissions, readiness and administrator decisions are not served from that identity cache. Ordinary user violations also avoid the channel lookup needed only for messages sent on behalf of a chat.

Local before/after profiling used the same real SQLite database interface and mocked Telegram responses. For repeated private `/start`, D1 binding calls before the first reply fell from **8 to 4**; `/help` fell from **7 to 3**. These are operation counts, not measured Telegram delivery times or a production speed guarantee. Destructive decisions retain fresh role checks and the per-group serial queue.

Worker logs include `pilot_performance` records for a 2% sample of ordinary work and for slow or failed coordinator work. Records contain only bounded route/outcome categories, queue time, handling time, and Telegram call counts/time. They exclude tokens, message content, parameters, and raw chat/user/update identifiers. `handling_ms` includes all processing waits; subtracting Telegram time does not turn it into a database-only measurement. These records help distinguish waiting in a group's queue from external API waits when investigating future delays.

## Policy

An ordinary member's prohibited link or forwarded message is deleted before a ban is requested. Offenses are counted independently for `(group ID, user ID)`:

| Offense | Ban |
| --- | --- |
| First | 24 hours |
| Second | 7 days |
| Third and later | Permanent |

Group owners, administrators (including anonymous administrators), and messages sent on behalf of the group's currently linked channel are exempt. A member manually forwarding a linked channel's post is still a member's forward and is moderated. Admin status is checked again immediately before destructive actions.

Allowed HTTPS destinations:

- `sautilink.com` and every real subdomain under `.sautilink.com`, all paths.
- `t.me/techhubtz`, `t.me/sautilink`, `t.me/sautilinkcloud_bot`, `t.me/drcharlesofficial`, `t.me/drcharlestz`.
- Public post links and `/s/` previews for those five Telegram usernames.

Bare domains are interpreted as HTTPS. Actual destinations of hidden links, captions, inline keyboard URLs and poll text are checked. Allowed links do not exempt forwarded messages. A message containing both an allowed and a forbidden destination violates the rule. Similar-looking domains, credentials in a URL, unsupported schemes/ports and Telegram username prefix matches are not whitelisted.

## Private menus and group controls

Opening `/start` privately shows a short, personalized welcome and inline navigation. The public menu explains the product and routes people to the right guide; it does not expose a group's status, member histories, or a list of administrative actions.

| Private command | Purpose |
| --- | --- |
| `/start`, `/pilot` | Open the welcome menu |
| `/dashboard` | Launch the authenticated Pilot Mini App inside Telegram |
| `/checklink URL` | Check a destination against the base link policy without visiting it |
| `/mystatus` | View only your own recent cases and appeal status |
| `/appeal CASE_ID reason` | Submit one bounded appeal for a case belonging to you |
| `/about` | Learn about SautiLink Pilot |
| `/howitworks` | Understand moderation and escalation |
| `/rules` | Read the link, forward, and exemption rules |
| `/connect` | Add the bot and see the required group permissions |
| `/developer` | Open optional project and source-code information |
| `/help` | Find the relevant guide, link checker, personal cases, or appeal instructions |
| `/language` | Choose and save a private Swahili or English preference |
| `/admin` | Open the verified admin panel, or guidance for selecting a group |

Ordinary group members see a minimal command menu containing `/rules` and `/help`. `/rules` can post the rules in the group; other public guides point to the private bot. The extended group command menu is registered only for Telegram's administrator scope. Menu visibility is a convenience; authorization is enforced again on the server.

### Verified private admin panel

Send `/admin` **inside the group you manage**, then open its private panel button. Telegram delivers a private `/start manage_<GROUP_ID>` request through the `?start=manage_<GROUP_ID>` link. Pilot checks the requesting person's current owner/admin role before reading or showing that group's information. Possessing the link does not grant access.

The selected group is remembered for that person. Each private admin page, status request, and strike lookup checks the person's role again. A revoked role clears the selection; a failed permission lookup does not reveal group information. Select another group by sending `/admin` there and opening its button. Anonymous admins use the group pointer and then verify through their own private Telegram identity.

| Admin command | Where to send it | Result |
| --- | --- | --- |
| `/admin` | Group, or private chat after selecting a group | Open the private panel |
| `/status` | Group, or verified private panel | Moderation state, bot permissions, and latest announcement status |
| `/history`, `/appeals`, `/stats` | Private chat after selecting a group | Incident history, appeal summaries, and group statistics |
| `/settings`, `/whitelist` | Private chat after selecting a group | Current settings and additional link allowances, with a link to edit in the Mini App |
| `/alerts on`, `/alerts off` | Private chat after selecting a group | Opt yourself in or out of that group's private problem alerts |
| `/report daily`, `/report weekly`, `/report off` | Private chat after selecting a group | Choose or stop your own private group reports |
| `/strikes USER_ID` | Group, or verified private panel | This member's strike count in the selected group |
| `/forgive USER_ID` | Group | Reset this group's strike history; preserve an existing ban |
| `/unban USER_ID` | Group | Remove a ban; preserve strike history |
| `/pause`, `/resume` | Group | Pause or resume moderation for new messages |
| `/language sw`, `/language en` | Group | Set that group's messages and announcements to Swahili or English |
| `/testnotice` | Group | Send a clearly labeled sample announcement without deleting, banning, or adding a strike |

For member commands inside the group, replying to the member's message also works. Numeric IDs are used instead of ambiguous usernames. The original text moderation commands are initiated in the group. The Mini App supports authorized changes and case decisions through the same group queue; private subscription and appeal commands also use that queue. Detailed replies are delivered privately when possible. If Telegram cannot deliver a private reply, the group receives a short panel link instead of the administrative details.

Admin mutations are claimed before their acknowledgement is sent, so a failed reply cannot replay the action. `/testnotice` is also claimed before sending: if delivery is uncertain, check the group before deliberately issuing another test. This command checks sample-message delivery; it does not perform a real moderation incident.

A human administrator's membership decision cancels older bot attempts. A manual unban preserves previous strikes. `/forgive` resets the full history for that member in the group; the Mini App separately offers correction of one current case. A subsequent new offense may receive the next penalty. Telegram handles expiry using `until_date`; no timer later unbans someone over a newer admin decision.

## Control center and optional tools

### Launching the Mini App

Open [@sautilinkpilotbot](https://t.me/sautilinkpilotbot) privately, send `/start` or `/dashboard`, and tap **Open Pilot panel / Fungua paneli ya Pilot**. The button opens `https://pilot.sautilink.com/app` as a Telegram Mini App. No new Main Mini App registration is needed for this inline-button launch. Opening the page in a normal browser provides a route back to Telegram; it does not expose group data or a demo account.

Connect each group by sending `/admin` in the group and opening its private link. Pilot remembers verified associations for discovery, then checks current admin status again before listing the group's name or returning its information. The app contains an overview, recent incidents and notice outcomes, appeals, settings, additional allowed links, an activity log, personal cases, a link checker, and pending join requests. History views return up to 50 recent records per list. “Today” begins at midnight in East Africa Time; week and month statistics cover rolling 7-day and 30-day windows. Ordinary members see their own tools; they do not receive another member's history.

The server verifies Telegram's signed `initData` using the bot-token HMAC scheme. It rejects duplicate parameters, invalid identities, signatures older than one hour and timestamps more than 60 seconds ahead. Browser-provided user IDs, group hints and `initDataUnsafe` do not confer authority. Pilot keeps the signed data in the current page session. The application does not copy it into its own links, browser storage, logs or D1; Telegram supplies its own launch data to the Mini App.

`POST /api/pilot` accepts same-origin JSON with the signed identity in `Authorization: tma …`. Every private group view and mutation rechecks the actor's current role. All writes route to that group's Durable Object, alongside ordinary moderation updates. Operation IDs bind retries to the same actor, group, action and input; an uncertain Telegram mutation is not blindly repeated. This is an internal Mini App interface, not an unauthenticated public administration API.

### Defaults and controls

The existing link/forward policy stays active. Command spam removal starts **enabled**, including for existing groups that have not saved a choice for it. A verified group admin can disable it or add exceptions for that group. Welcomes, flood control and join screening remain disabled until an admin enables them.

| Feature | Initial state | Behavior when enabled or configured |
| --- | --- | --- |
| Extra whitelist | Empty | Adds scoped allowances for this group; the SautiLink base allowlist remains |
| Welcome messages | Off | Sends a bilingual, customizable welcome after a member joins |
| Group rules note | Empty | Appends a plain-text note to public rules and relevant welcome/join messages |
| Notice style | Detailed | Admin can choose detailed, compact, or formal notices and an extra plain-text message |
| Command spam removal | On | Silently deletes messages or captions made up of unapproved long slash-command codes; never adds a ban, mute or strike |
| Command exceptions | Empty | Exact or prefix allowances for the selected group’s command filter only |
| Anti-flood | Off | Default threshold is more than 8 messages in 10 seconds; removes excess messages |
| Optional flood mute | Off; flood action defaults to delete | Admin may choose a 1–60 minute mute for eligible ordinary members in a supergroup; the default duration is 5 minutes |
| Join request screening | Off | Admin chooses manual review or a short rules acknowledgement with a simple arithmetic question |
| Problem alerts | Off for each admin/group | Opted-in admins receive private, throttled alerts while they retain their role |
| Scheduled reports | Off for each admin/group | Opted-in admins choose a daily or weekly private summary |

Pausing moderation also pauses command spam removal, automated flood actions, welcomes and challenge approval. Admins can still review records and make deliberate decisions.

### Link checker and per-group allowances

`/checklink URL` privately uses the same URL policy as moderation, with the base allowlist. The Mini App checker can use a selected group's additional rules after checking the caller's admin status, current membership, or ownership of a case from that group. It explains whether destinations are allowed and which policy scope is being checked. It never visits the supplied website, follows redirects, scans malware, or guarantees that a website is safe. A forwarded message remains a violation even if every link is allowed.

An admin can add up to 100 extra rules per group:

| Scope | Example | Effect |
| --- | --- | --- |
| One URL | `https://example.org/welcome` | Allows the normalized exact URL, including its path and query; it does not allow arbitrary paths |
| One domain | `example.org` | Allows HTTPS paths on that exact hostname |
| Domain and subdomains | `example.org` | Allows the root hostname and its real subdomains |

The form previews the scope before saving. Removing an extra allowance affects that group only. Credentials, encoded hostnames, unsupported protocols or ports, malformed inputs and hostname lookalikes remain rejected. Administrative changes are recorded in the activity log.

### Cases, appeals and corrections

`/mystatus` and **My cases** return only the authenticated person's recent incidents. A banned member can still appeal a case that belongs to them; current group membership is not required to prove ownership of that case. Each incident accepts one appeal of up to 1,000 characters. Submissions are limited to three per rolling 24 hours, with at least one minute between them. The appeal text is shown to verified admins of that group and is never posted publicly by Pilot.

An appeal does not lift a ban. Admin decisions are separate:

| Decision | Result |
| --- | --- |
| Keep decision | Resolves the appeal while retaining the current punishment and strike history |
| Remove ban | Lifts the current matching ban and retains strikes |
| Correct one strike | Removes exactly one strike from the current latest case and preserves the existing ban |

The case actions reject stale history when a newer incident or admin override has superseded it. Ban removal additionally checks the live Telegram ban and its expiry. A corrected case cannot be replayed to restore the strike. The existing `/forgive USER_ID` command remains a distinct full-history reset, and does not itself lift an existing ban. The log records who acted, the case, action, time and relevant outcome metadata.

### Welcomes, rules and announcement templates

All custom copy is plain text; it cannot supply arbitrary HTML. Unsupported placeholders are rejected. Save separate Swahili and English versions:

| Field | Limit before substitution | Supported placeholders |
| --- | --- | --- |
| Welcome message | 400 characters | `{user}`, `{group}`, `{rules}` |
| Additional notice message | 240 characters | `{user}`, `{reason}`, `{duration}`, `{group}` |
| Additional group rules | 600 characters | Plain text |

The group language determines which version is sent. Default welcome text is used if the corresponding custom field is empty. A configured notice adds to the confirmed-action facts: name/ID, reason, strike, duration and expiry remain present in every style. Expanded welcome text is capped at 3,500 characters, and the extra notice message at 800, so repeated placeholders cannot make the final message unbounded. The preview helps admins check wording before saving. Welcome events are deduplicated so overlapping join notifications do not produce repeated greetings.

### Command spam removal

**This feature only deletes messages. It never bans, mutes, restricts or adds a strike, and it sends no public deletion notice.** The filter runs before flood counting, so a matching command-spam message does not count toward a flood mute. A separate link or forward violation still follows the existing link/forward policy.

By default, Pilot checks new and edited group messages and captions for content consisting entirely of one or more whitespace-separated slash tokens, starting with a command name longer than 32 characters. It removes the message if any long command name is not allowlisted. Names are ASCII letters, digits or underscores. A normal short command at the start keeps its arguments outside this filter, even if an argument is itself a long slash code. A `@BotUsername` suffix does not automatically exempt a long code. The full token is inspected rather than trusting the clickable entity’s length. This is a conservative format rule, not a claim that every long code is malicious.

Ordinary commands such as `/help`, `/play@MusicBot`, and `/start long_argument` remain available. General prose, file paths, mentions, hashtags, and Telegram-formatted code/preformatted examples are outside this filter when formatting covers the full token. Bot-sent messages, the group’s owner/admins/anonymous admins, and its actual linked channel remain exempt. Group pause, activation time and human overrides are respected, and Telegram admin status is checked again before deletion. The bot requires **Delete messages** permission for this feature. Telegram’s 48-hour deletion limit is measured from the original message date, including on edits; this does not scan or clear old chat history.

In **Dashboard → selected group → Settings → Command spam**, admins can switch the filter off or enter command exceptions. The private `/settings` summary shows its state; confirmed deletions and unconfirmed outcomes appear in the group’s activity log. No deleted token or message body is stored there.

A definitive Telegram rate-limit rejection waits for `retry_after` and permits at most three deletion attempts, with fresh permission and exemption checks before each attempt. Failed or uncertain outcomes are recorded for review. Observed clean edits leave only a message ID and event-time marker, so a delayed original update or retry cannot delete newer clean content. A strictly newer spam edit remains eligible; ambiguous edits within the same second are preserved. Detected command codes stay outside flood counting even when command cleanup is disabled.

Each exception is one line, with at most **20 rules / 2,000 characters** total:

| Example | Scope |
| --- | --- |
| `/get_ExampleOpaqueCode12345678901234567890` | This exact targetless command code |
| `/get_*` | Targetless command names starting with `get_` |
| `/get_*@ExampleBot` | Command names starting with `get_`, addressed specifically to `@ExampleBot` |

Names are case-sensitive; bot target usernames are case-insensitive. Targetless rules match only targetless commands. Exact names allow 1–128 ASCII letters, digits or underscores. A prefix allows 3–32 of those characters followed by one `*`; the optional bot username is 5–32 characters and ends in `bot`. Blank lines and duplicate rules are normalized. Spaces inside rules, bare wildcards, URLs and arbitrary regular expressions are rejected. An exception only bypasses this command-code filter; it does not bypass links, forwards or admin authorization.

Pilot does not automatically know the private/custom command formats of every other bot. If a group needs an unusual dynamic command, an admin should add its exact or appropriately scoped prefix exception. Ordinary members cannot create exceptions by posting a command.

### Anti-flood and join requests

Flood control is independent of the three-strike link/forward policy. It never adds a link/forward strike. Admins choose a threshold of 3–30 messages in a 5–60 second window. Edits and service join/leave messages are excluded, albums count as one event, and admin/channel exemptions remain. The normal link/forward policy takes priority. A flood mute is not used to replace an existing human restriction or extend an existing mute; excess-message removal can still occur. Flood notices are throttled to avoid producing another stream of messages.

Join screening requires Telegram join requests to be enabled for the group or invite link, and **Invite users** permission for the bot. In manual-review mode, the request remains pending for an admin. In challenge mode, Pilot sends a rules message and simple arithmetic buttons through Telegram's limited private contact window. A correct response can approve the matching current request. Expiry or an incorrect answer never bans the applicant; the request stays available for manual review. Human membership changes and newer requests invalidate older buttons. Telegram's separate guard-bot query protocol is handed back to human admins with a `queue` result.

This is a lightweight acknowledgement step, not proof that someone is human. Members who join without a join request do not go through the challenge.

### Private alerts, reports and operator health

An admin opts in separately for each group through the app or private `/alerts` and `/report` commands. Reports summarize incidents, confirmed bans, link/forward categories and pending appeals. They do not send full conversation logs. The first report is due after the chosen interval; changing the subscription starts a new interval. Alert causes include missing permissions, paused moderation, unconfirmed notices and moderation actions that need review.

The Worker runs monitoring on a ten-minute schedule. Each run processes a bounded rotating batch, so a large installation can take longer than one interval to revisit every subscription. Alerts have a cooldown and persistent issues are not sent on every pass. Current admin status is checked again at delivery, and delivery is claimed before the Telegram request. A lost response is recorded as uncertain instead of being resent automatically. Revoked admins and permanently blocked private chats have their subscription disabled. Nothing falls back to a public group message.

`/health` remains a minimal public readiness check. Operator-wide counts and monitoring status are available only through the existing `SETUP_KEY`-protected setup status endpoint; group admins do not receive infrastructure secrets.

## Owner announcements

Pilot's owner can prepare an announcement privately, inspect its saved content and target count, then confirm delivery to connected groups. This authority belongs to one permanently bound Telegram account. Being a group administrator, knowing a command, copying a button, or later obtaining the owner's old username does not grant it.

### Bind the owner once

1. Open `https://pilot.sautilink.com/setup` and authenticate with the existing `SETUP_KEY`.
2. Use the owner-pairing control to generate a one-use code. It expires after ten minutes; generating another valid code replaces the previous one.
3. From the personal Telegram account whose current username is **`@drcharlestz`**, privately send the displayed `/claimowner CODE` command to **`@sautilinkpilotbot`**.
4. Pilot binds that account's numeric Telegram user ID permanently. Later username changes do not change ownership. The bot and setup interface cannot reassign an existing binding.

The code is stored as a hash and is not echoed in the bot's reply. Pairing requires both the protected operator code and the expected account's authentic private Telegram update. Send it only to the bot privately. `/myid` privately returns the requesting person's own numeric ID without revealing owner information.

### Prepare, review and confirm

Only the bound owner sees **Pilot updates / Updates za Pilot** on the private welcome page. `/updates` opens the same panel. Broadcast commands are absent from the ordinary private, group and group-admin native command menus; the server also checks ownership on every operation.

| Owner action | Result |
| --- | --- |
| `/updates` | View target count, current draft or delivery progress, and recent broadcasts |
| `/broadcast` | Start a private composition step; send the next original message within 15 minutes |
| `/broadcast Your announcement` | Create a text draft immediately, preserving native Telegram formatting |
| **Confirm and send / Thibitisha na tuma** | Confirm the exact saved draft from its original confirmation message |
| **Change content / Badili maudhui** | Cancel the pending draft and start a replacement; a broadcast already running cannot be edited |
| **Cancel broadcast / Ghairi tangazo** | Stop the pending draft or remaining delivery work |

A draft accepts one original text message, photo, video, document, animation, audio, or voice message. Captions and supported native entities are preserved; media uses Telegram file IDs instead of fetching an external upload URL. Albums, forwarded or protected messages, service messages and unsupported content are rejected. Ordinary commands such as `/start` are never mistaken for the announcement body.

The bot sends the saved content back to the owner and a separate confirmation panel. No group receives a draft before confirmation. The content and target-group list are frozen when the draft is created, and confirmation expires after 24 hours. Editing the original source message does not change the saved draft. The confirmation is bound to the exact private bot message: an old, copied, mismatched or inaccessible confirmation cannot authorize a new send.

**Target groups** is the frozen candidate count, not a promise of successful delivery. It includes active group records and older groups whose current connection is not yet verified. Groups added after draft creation belong to a later broadcast. Pausing moderation does not unsubscribe a group from owner announcements.

### Delivery and cancellation

A dedicated global Durable Object serializes owner operations and delivery alarms. Delivery continues in bounded, paced batches; each target gets a current membership and send-permission check before sending. Removed or ineligible groups are skipped. The panel separates confirmed deliveries, definite rejections, skipped targets, uncertain outcomes, pending work and cancelled targets. Telegram rate-limit delays are persisted for later handling.

A delivery whose response was lost is marked unconfirmed and is not automatically repeated. A restarted Worker can resume work that was still pending. An unfinished broadcast expires 30 days after creation, preventing an old campaign from resuming after a long outage. Cancellation stops work that has not been committed to sending; a Telegram send already in flight may finish. Cancellation does not delete announcements already delivered. There is no automatic reposting or scheduled marketing sequence.

Broadcast content, audience and outcomes are intentionally stored for this feature; see **Storage and privacy** below. The owner panel is private and bilingual, using the owner's saved personal language. Group admins' existing moderation controls and each group's language preference are independent.

## Swahili and English

The language choices are independent:

| Surface | Selection and fallback |
| --- | --- |
| Private Telegram chat | Use `/language` or the **Lugha / Language** button, then select a language. The saved personal choice takes precedence. Without one, Telegram's `language_code` selects English for `en` or an `en-…` code; other or missing codes use Swahili. |
| Telegram group | A verified group admin sends `/language sw` or `/language en` in that group. Unconfigured groups use Swahili. One member's personal preference does not change the group's language. |
| Mini App | The SW / EN choice and the opening button determine the current app language. A direct visit without a valid language parameter uses English. Group language and personal Telegram preferences remain separate. |
| Website | English is the default for new visits and invalid language parameters. The visible **SW / EN** selector uses `?lang=sw` or `?lang=en`. Internal navigation preserves the selected language. Home, the local simulator, privacy, and operator setup are translated. No browser storage is used for the choice. |

Private admin replies use the recipient's private preference; group notices use the group's preference. Telegram's command descriptions and bot profile descriptions are registered in default/Swahili and English variants. Telegram chooses those native menu descriptions using its own language settings; Pilot's saved choice controls the messages it renders.

The public website includes a clearly labeled local moderation simulator: approved links, forbidden links, forwards, admin posts, and linked-channel posts. Its two example groups have separate strike histories, and repeat-offense examples explicitly move time forward between bans. The demo never connects to Telegram, stores its examples, or takes action against a real member.

## Moderation announcements

A notice for a confirmed ban includes an escaped display name, numeric Telegram user ID, all detected reason categories, strike stage, duration, and an explicit expiry in **East Africa Time (EAT)** or a permanent-ban label. It uses readable names without relying on `tg://` mentions of someone who has already left the group. Unconfirmed bans are never described as successful. For an unrelated channel sender, a deletion/review notice asks an admin to review the sender without claiming a ban.

Notification delivery is tracked separately from moderation:

| Stored state | Meaning |
| --- | --- |
| `pending` | Waiting for an attempt, or for a Telegram rate-limit delay to expire |
| `sending` | An attempt has been claimed, but its outcome is not yet recorded |
| `sent` | Telegram returned a valid message ID |
| `unknown` | Delivery may have succeeded, but cannot be confirmed |
| `failed` | Telegram definitively rejected delivery and permitted fallbacks are exhausted |
| `cancelled` | The pending notice became obsolete, such as after an admin override |

The first attempt uses an HTML notice and, when applicable, the original forum topic. An explicit Telegram **400 rejection** permits a bounded fallback: an unavailable topic is removed, or rich formatting and buttons are replaced with plain text. There are at most three attempts in that fallback sequence. These fallbacks are used only after Telegram explicitly rejected the previous attempt.

An explicit **429** response saves the retry time from `retry_after` and leaves the original webhook update eligible for Telegram redelivery. A later retry resumes the existing incident and notice; it does not add another strike or blindly reapply the ban. There is no separate scheduled sender queue.

A timeout, lost response, invalid success payload, or an interrupted `sending` attempt is treated as **unknown**. The bot does not automatically resend it, because Telegram offers no `sendMessage` idempotency key and the original notice may already exist. `/status` in the verified private panel reports the latest recorded delivery state and a categorized cause when available. Existing legacy notice claims are not replayed during an upgrade.

## Deploy to the existing Cloudflare Worker

The repository contains deployable code. It does **not** contain a Telegram token or a live Cloudflare session.

### 1. Connect GitHub to the existing Worker

In Cloudflare, open **Workers & Pages → sautilink-pilot → Settings → Builds**. Connect the `sautilink/pilot` GitHub repository, select `main`, and use:

| Setting | Value |
| --- | --- |
| Root directory | Repository root (`/`) |
| Build command | `npm run check && npm test` |
| Deploy command | `npm run deploy` |
| Preview/non-production deploy command | Leave unused for this initial production setup |

The Worker name in `wrangler.jsonc` must match the existing Worker. This config preserves `pilot.sautilink.com` as its custom domain. Wrangler provisions a D1 database binding `DB` and a SQLite Durable Object binding `GROUPS`; the latter serializes moderation decisions within each chat. Different groups can operate independently. The Durable Object is infrastructure, not an extra public bot.

If you already created the D1 database manually, add its actual `database_id` to the `d1_databases` entry before deploying, so it is reused. Never paste an API token into the repository. Resource IDs are not secrets.

### 2. Store BOT_TOKEN

**Worker → Settings → Variables and Secrets → Add → Secret**:

- Name: `BOT_TOKEN`
- Value: the token issued by BotFather for **@sautilinkpilotbot**.

Save/deploy the secret. Runtime secrets belong to the Worker, not the GitHub build environment. The application derives a separate webhook authentication secret using HMAC-SHA-256; it never exposes the bot token in browser JavaScript, public URLs or responses.

### 3. Generate and store SETUP_KEY

After the new code is deployed, visit **https://pilot.sautilink.com/setup**. Use the page's local generator to create a random key. Add another Cloudflare **Secret**:

- Name: `SETUP_KEY`
- Value: the generated key (at least 32 characters; the generator creates 64).

Keep the key in a password manager. The setup page does not save it in local storage or put it in URLs.

### 4. Complete setup

Return to `/setup`, enter the setup key and run setup. The server:

1. Verifies that `BOT_TOKEN` identifies the expected `sautilinkpilotbot`.
2. Creates the D1 schema idempotently, including delivery tracking, admin selections, language preferences, control records, optional guardrails and owner announcements. SQL migrations are also supplied in `migrations/`.
3. Registers localized private, group, and administrator command menus, plus the bot's profile descriptions.
4. Sets `https://pilot.sautilink.com/telegram/webhook` with a secret header.
5. Explicitly subscribes to `message`, `edited_message`, `my_chat_member`, `chat_member`, `callback_query`, and `chat_join_request` updates. These enable inline navigation and optional join screening.
6. Marks setup complete. The public page then enables the add-to-group button.

Pending updates are not silently dropped. Messages older than the activation time are not moderated. Re-running setup is safe and preserves strikes.

### Updating an already configured installation

Deploy the new code through the existing GitHub/Cloudflare connection. A bot that has completed setup updates its versioned Telegram experience on the next **authenticated, valid webhook update**. Sending `/start` privately supplies an ordinary update for this purpose. Public website visits, health checks, and unauthenticated requests do not trigger metadata changes.

The upgrade verifies the expected bot identity, confirms the webhook subscription including `callback_query` and `chat_join_request`, and updates the localized profile descriptions and scoped command menus. Callback subscription is awaited before the triggering update proceeds; the remaining profile work can finish through the Worker's `waitUntil`. A shared D1 lease prevents competing upgrades, and failures are categorized and delayed before retrying on a later eligible update. Metadata-refresh failures are caught so moderation can still process the incoming update.

The completed experience version is stored only after the metadata operations succeed. Supplemental tables are created idempotently as needed. The upgrade does not reset strikes, rewrite the original activation time, drop queued Telegram updates, or require another `/setup` run. Keep the existing Worker, bindings, secrets, and database in place. Do not create a replacement database merely to update the bot's menus.

### 5. Verify in a test supergroup

Use a separate ordinary test account; admins are intentionally exempt. Add the bot as admin with **Delete messages** and **Ban users**. Open `/admin` from the group and confirm the private `/status` view shows complete permissions. The following are manual acceptance checks to run against the deployed bot:

- Open private `/start`; use the inline guides and switch between Swahili and English.
- Change the group's language as an admin and confirm it does not alter the personal language choice.
- Run `/testnotice` and verify the labeled sample appears without a ban, deletion, or strike.
- An allowed SautiLink link remains visible.
- A forbidden link is deleted; the member is banned for 24 hours; the notice shows the correct name, ID, reason, stage, duration, and EAT expiry.
- Admin posts and linked-channel automatic posts remain untouched.
- A forwarded message from an ordinary member is moderated.
- `/unban` preserves strikes; a later new offense produces seven days, then permanent.
- `/forgive` resets the counter; `/pause` and `/resume` work only for admins.
- An ordinary member cannot use a copied admin-panel link to read group status or strike records.
- Launch the Mini App from the private bot; verify that copied group hints do not grant a non-admin access.
- Check a link privately, then add an extra allowance to one test group and confirm another group is unaffected.
- Submit an appeal from the affected member and verify that only the relevant group's admins can review it.
- Distinguish a one-strike correction from a full `/forgive` reset, and from ban removal.
- Verify long slash-code messages and edited captions are removed silently without a ban, mute or strike; ordinary commands and configured exceptions must pass. Disable the filter for one group and confirm the choice does not affect another.
- Opt in to welcomes or flood control in a test group; verify their initial defaults remain off elsewhere.
- Enable join requests and Invite users before checking challenge/manual-review behavior; timeout must not ban an applicant.
- Opt into notifications for a test admin and verify private delivery before relying on reports.
- Verify owner pairing and the private draft preview without confirming a broadcast to live groups; nonowners must not receive target counts or owner controls.
- The website's language selector and demo work without changing live group state.

The automated suite uses a fake Telegram API, real local SQLite, and browser-script harnesses. Passing it is not a claim that these live Telegram checks have been performed.

## Reliability and limits

- A Durable Object queues each chat's decisions across network awaits. D1 persists incidents and update IDs. Albums/retries count once; delayed messages from an existing ban episode cannot skip penalty levels.
- Deletion, attempted ban and confirmed ban are separate states. A lost ban response causes Telegram to retry; the bot reconciles current membership and never blindly reapplies an uncertain ban. Only a confirmed action increments the strike.
- Notices have separate delivery records. Definite rejections may allow a fallback or delayed retry; uncertain delivery is never automatically repeated. A missing notice does not imply that the ban failed. See **Moderation announcements** above.
- **Timed bans require a supergroup.** A legacy basic group receives guidance and is not silently given permanent bans.
- **Telegram ban behavior can delete other messages from that user**, because `revoke_messages` is always true for supergroup bans.
- An unrelated channel sender does not disclose the underlying person. Pilot deletes offending content and asks admins to review it, rather than banning Telegram's fake compatibility user or applying the wider permanent `banChatSenderChat` action.
- Copy-pasted/reuploaded content without forward metadata cannot reliably be classified as forwarded. Image text/QR codes and remote redirects are not scanned. URLs inside allowed sites are judged by the allowed destination, not by following later redirects.
- Deletion is subject to Telegram's 48-hour limit. Stale messages are skipped. API outages or missing privileges can delay or prevent moderation; failures are not announced as successful bans.

## Storage and privacy

D1 stores chat/user IDs, per-group strike counts, incident reason categories/action status, and processed update IDs. Delivery records add the notice state, attempt count, retry time, categorized error, and Telegram message ID when confirmed. Admin selections store the person and last selected group; these records never substitute for a fresh Telegram role check. Language preferences store separate `user` and `group` choices. Service settings also hold readiness, bot identity, and experience-upgrade metadata.

The database does not retain ordinary moderated message bodies, their media or captions, member display names from moderation, supplied checker text, or bot tokens. It does intentionally store admin-entered group rules and templates, configured whitelist destinations and command exceptions, and member-written appeal text, along with case/audit/operation metadata and notification preferences. Join screening stores identifiers, a temporary challenge answer and delivery/decision state; it does not retain invite links or join-request bios. Incoming text and names are processed for the current update and may appear in messages sent to Telegram. The public `/privacy` page describes the stored metadata and retention in both languages.

Owner announcements deliberately retain the owner's selected text/caption, native entity data and Telegram media file IDs, along with a content hash, target group IDs, preview ID, delivery outcomes and action records. Media files are not downloaded into D1. The owner binding stores the permanent numeric user ID and pairing time; an unclaimed pairing code is held only as a temporary hash. The connection registry stores group IDs and observed bot membership states, without group conversation content.

Daily cleanup applies these rules. Control-history deletion uses bounded batches of 500 records per table, so a backlog can take more than one sweep:

| Data | Retention |
| --- | --- |
| Processed update IDs | Removed when older than 7 days |
| Incident details and their delivery records | Removed when the incident is older than 30 days |
| Selected admin group context | Removed when its last selection/update is older than 30 days |
| Appeal text and decision records | Eligible for deletion 30 days after creation |
| Activity log and control operation records | Eligible for deletion after 30 days; operation age uses its last update |
| Single-case correction markers | Eligible after 30 days once the corresponding incident has been removed |
| Verified admin/group discovery associations | Eligible for deletion 180 days after their last verification; every use still rechecks the role |
| Join request/challenge records | Removed when the request is older than 7 days |
| Flood event counters | Entries older than 120 seconds are pruned during relevant traffic and scheduled cleanup |
| Welcome/flood/command/join-action delivery records and private admin deliveries | Removed after 30 days |
| Resolved health events | Removed 30 days after resolution; unresolved events remain available for review |
| Per-admin notification preferences | Retained for operation, including an opted-out/disabled state; delivery always rechecks the current role |
| Member strike totals | No automatic expiry; `/forgive` resets the count for the relevant group |
| Group settings and language preferences | Kept for continued service; a new language choice replaces the previous choice |
| Owner binding | Kept permanently for authorization; usernames are not used as the persistent identity |
| Unclaimed owner-pairing hash | Invalid after ten minutes; cleared on successful binding, replacement or expiry cleanup |
| Broadcast composition step | Expires after 15 minutes |
| Unconfirmed broadcast draft | Confirmation expires after 24 hours; remaining staged targets are cancelled |
| Broadcast content, campaign metadata, target outcomes and action records | Eligible for bounded cleanup after 30 days; content is cleared independently of a large delivery-record backlog |
| Broadcast group connection registry | Kept for discovery and delivery checks; every delivery still verifies the live connection |
| Service and upgrade settings | Kept for continued operation |

Cleanup does not remove messages already sent to Telegram. Telegram messages, platform request logs, and backups are subject to the relevant platform and operator settings.

## Community tools release — 22 October 2026

Open **`/tools` in the bot**, or choose **Community tools** from `/start` or the moderation panel. The new workspace is at `/tools`; the existing moderation workspace remains at `/app`. Both use signed Telegram Mini App identity, English and Kiswahili, shared animated icons, and the same theme controls. A normal browser visitor sees a public welcome, never a private group workspace. New optional group features start inactive until a current admin configures them.

### Commands and access

| Command | Purpose |
| --- | --- |
| `/tools` | Open Community tools; group admins can select a managed group |
| `/flag reason` | Reply to an ordinary member's group message to place a report in the admin inbox |
| `/ask question` | Search that group's admin-approved FAQ; current membership is required |
| `/events` | See group events and open the member RSVP page |
| `/changelog` | Open public release notes and the roadmap |
| `/feedback` | Open the feature/problem form, readable only by the bound Pilot owner |

`/report` continues to configure daily/weekly moderation reports. **`/updates` continues to belong to the owner-only global broadcast workflow.** Group administrators cannot use the scheduler, integrations, reports or feedback to send a global announcement.

Group menu commands for reports, FAQ, events, tools and link checking use Telegram's ephemeral command support. Selected admin reads can also be ephemeral. The incoming `message_id: 0` and reusable `ephemeral_message_id` are never used as ordinary moderation case IDs: these private interactions bypass message penalties and flood counting, while their Telegram update IDs still prevent retries from repeating commands. Responses use Bot API 10.3 `ephemeral_message_parameters.receiver_user_id`. A definite rejection can fall back to a private bot chat; an ambiguous outcome is not sent again. Sensitive text is never downgraded to a public group reply. Ordinary existing admin commands still deliver their durable results privately. Telegram does not guarantee ephemeral delivery, especially for offline users; `/dashboard` and `/tools` remain the durable routes.

### Reports and the shared inbox

Only a trusted Telegram reply can create report evidence. The HTTP API cannot accept an invented target message or reporter ID. The report stores the reason, at most 500 characters from the target, message metadata and the reporter identity. Current group admins can claim, dismiss, resolve, or explicitly delete the reported message. Claims coordinate concurrent admins; a claim whose owner lost admin authority can be recovered. A report never automatically bans, mutes or adds a strike. Admins, bots, anonymous senders and channel posts are protected; deletion rechecks the target's current role and the bot's permission.

Reports are bounded to 3 per hour per member/group, 10 per day per member, 5 open reports per target, and 100 open reports per group. Reports and their operation evidence are eligible for removal after 30 days. A deletion with an unknown Telegram outcome cannot be blindly repeated.

### Announcements, events and highlights

Admins review the text, group, language, recurrence and **EAT (Africa/Dar_es_Salaam, UTC+3)** time before confirming a schedule. One-time, daily and weekly announcements are supported, with up to 20 active schedules per group. Recurring schedules expire after 90 days. Each due occurrence rechecks the creator's current admin status and the bot's current group status before sending. Removed admins' schedules pause. One-time work over 24 hours overdue expires; recurring work skips missed intervals without sending a backlog.

Per-group Durable Object alarms serialize scheduled sends with moderation and admin changes. A durable occurrence record precedes each Telegram send. Known rate limits have bounded retries; ambiguous sends become `unknown` for review and do not automatically repeat. Cron wakes due groups after an outage, independently of the owner broadcast queue.

Events contain an admin-supplied title, description, times and optional HTTPS resource. Members can select going, maybe or declined through the member view. Other members see totals and only their own response. No attendee roster is exposed by the integration API. Up to 50 events and 50 curated highlight entries per group are supported.

Highlights contain only text/links deliberately entered by an admin. Choose entries for a one-time digest, or schedule a weekly digest of fresh, unconsumed entries from the previous seven days. Empty weeks are skipped. The bot does not archive the group's whole conversation to produce summaries.

### Presets and configuration history

Community, study, tech and business presets provide a starting point. Admins can copy selected settings, language and permanent whitelist rules from another group they currently manage, or restore a saved configuration. A server-generated preview shows the changes; its hash binds both the current target and proposed source state, so concurrent changes require a new preview.

Configuration changes made from either workspace are captured before replacement. History is limited to the latest 100 snapshots per group and 90 days. Copy/restore never includes members, penalties, bans, reports, appeals, owner permissions, integration credentials or temporary link exceptions. Existing base allowlist rules and the 24-hour → 7-day → permanent policy remain intact.

### Temporary links and raid controls

Temporary exceptions allow **one exact HTTPS URL** until the chosen expiry, between one minute and 30 days. Up to 50 active temporary exceptions supplement the existing 100 permanent group rules. Expiry is checked at policy evaluation time; it does not depend on a cleanup cron and never revisits old messages. A forward still violates the forwarding rule even when its URL is allowed.

Raid detection is opt-in and counts distinct accounts joining or producing confirmed spam actions within a configured 30–300-second window. It records a bounded warning, with a ten-minute duplicate alert cooldown; existing opted-in admin alerts can notify about it. It does not automatically punish accounts or lock the group. Quiet or disabled raid detection resolves its health warning.

A current admin may deliberately activate a 1–60-minute emergency posting lockdown. This changes group default posting permissions without adding individual strikes or bans. Pilot records the previous and applied permission states. At expiry it restores only when the creator still has admin authority and the live permissions still match the applied state. A different human decision is preserved. An uncertain action or departed creator requires manual review; a new confirmation can recheck a `review` state without replaying an old action. All low-level permission comparisons normalize Telegram's optional booleans and documented defaults.

### FAQ and Community Hubs

Each group can hold up to 50 approved questions and answers with optional HTTPS sources. `/ask` performs deterministic search over this material; no AI service or API key is required. A current group member can read the group's FAQ. A hub starts **private**; an admin can publish it as public or unlisted at `/community/<slug>`. Unlisted means anyone with the URL can read it, while crawlers receive `noindex`.

Only admin-selected introduction, rules, resources and join link are published. Sharing FAQ entries on the hub requires a separate explicit choice. Public projections exclude chat IDs, member IDs, reporter details, moderation history and private settings. There is no public connected-groups directory. Published hub responses use `no-store` so unpublishing is immediate. Group FAQ/hub configuration stays until an admin changes or removes it.

### Scoped developer API

The public guide is at **`/developers`**. An admin creates a token for one group and chooses one or more scopes:

| Scope | Operation | Result |
| --- | --- | --- |
| `knowledge:read` | `knowledge` | Approved FAQ content, optionally filtered by `input.query` |
| `events:read` | `events` | Event content and times, without participant identities or the creator's RSVP |
| `drafts:write` | `draft` | A bounded announcement proposal in the admin review inbox |

Call `POST /api/integrations` with `Authorization: Bearer YOUR_GROUP_TOKEN` and a JSON body containing `operation`, `input`, and—for draft creation—a fresh 16–80-character `requestId`. Draft input is `{ "title": "Release proposal", "text": "Text for an admin to review." }`. Credential scope determines the group; callers cannot supply an arbitrary group ID. An approved draft can prefill the scheduling form and still requires an admin's scheduling confirmation. Integrations never send a message by themselves.

Tokens are shown once, stored only as SHA-256 digests, revocable, and valid for up to 90 days. Each group can have up to 10 active tokens. Every authorized API operation checks that the token creator is still a current group admin. Limits are 60 requests/minute/token, 20 draft proposals/day/token, and 50 pending drafts/group. Keep tokens in the integrating application's secret store; do not paste them into a group, a public URL or source control. Expired/revoked credentials, scopes and current roles are enforced on the server.

### Additional retention and public information

| Data | Retention |
| --- | --- |
| Completed/cancelled/paused/unknown schedules | Eligible 30 days after last update |
| Scheduled-delivery evidence, curated highlights and operations audit | Eligible after 30 days |
| Events and their RSVP responses | Eligible 30 days after the event's end; RSVPs cascade with event removal |
| Configuration snapshots | Latest 100 per group, up to 90 days |
| Expired temporary allowances | Stop applying immediately; eligible for cleanup after one day |
| Raid account signals | Eligible after 24 hours |
| Raid warnings | Eligible after 30 days |
| Integration draft proposals | Eligible after 30 days |
| Expired integration-token digests/metadata | Eligible 30 days after expiry |
| Integration rate counters | Eligible after one day |
| Feature/problem feedback | Eligible after 90 days; bound owner only |

Daily sweeps are bounded, so physical deletion of large backlogs may require multiple runs. Read queries apply their retention windows independently. `/updates`, `/roadmap` and `/developers` are bilingual indexable pages included in the sitemap; `/tools` remains `noindex` and its data authenticated. Roadmap items describe possibilities without promised release dates. AI-generated answers, automatic RSS/GitHub imports, and outbound third-party webhooks are not enabled in this release; the curated FAQ and scoped API operate immediately without additional accounts, credentials or services.

## Development and validation

Node 24 is recommended (Node 22.13+ provides the SQLite API used by tests).

```sh
npm ci
npm run check
npm test
npm run build
```

`build` runs Wrangler's dry run and does not deploy. `npm run dev` runs a local Worker; local credentials, if used, go in ignored `.dev.vars` files.

For named test output in environments that wrap Node subprocesses:

```sh
node --test --test-isolation=none tests/*.test.js
```

### Main files

- `src/policy.js`: URL allowlist and forward detection.
- `src/command-spam.js`: conservative long slash-code classification and bounded per-group command exceptions.
- `src/moderator.js`: enforcement, escalation, membership changes, and safe reconciliation.
- `src/commands.js`: commands, callbacks, fresh admin authorization, selected-group context, and language choices.
- `src/feature-commands.js`: private link checks, personal cases, appeals, verified group summaries, and opt-in commands.
- `src/broadcast-commands.js`: private owner composition, native content snapshots, previews, confirmation and progress in both languages.
- `src/owner-auth.js`: one-time operator pairing and permanent numeric owner authorization.
- `src/broadcast-store.js`, `src/broadcast-service.js` and `src/broadcast-router.js`: connection registry, frozen drafts/audiences, owner-only dispatch, paced delivery and recovery records.
- `src/dashboard.js`: responsive bilingual Mini App and its authenticated controls.
- `src/miniapp-auth.js` and `src/dashboard-api.js`: Telegram identity validation, request validation, and group-queue routing.
- `src/control-store.js` and `src/control-service.js`: per-group settings, custom allowances, case review, appeals, subscriptions, authorization, operation idempotency and audit records.
- `src/guardrails.js`, `src/guardrail-store.js` and `src/templates.js`: silent command spam removal, optional flood control, welcomes, join screening and safe custom copy.
- `src/monitoring.js`: opted-in private alerts/reports and protected operator health summaries.
- `src/bot-ui.js`: bilingual private pages, inline navigation, command scopes, profile copy, and experience version.
- `src/announcements.js`: bilingual penalty notices, safe text formatting, delivery tracking, and bounded retry/fallback behavior.
- `src/experience-sync.js`: versioned Telegram metadata upgrades, authenticated bot-identity checks, webhook subscriptions, and synchronization lease.
- `src/store.js`: D1 schemas, state transitions, preferences, delivery records, and retention cleanup.
- `src/telegram.js`: bounded Telegram requests and webhook authentication.
- `src/handler.js`: localized HTTP routing, authenticated setup, webhook validation, and the ready-installation upgrade trigger.
- `src/index.js`: Cloudflare entry point, per-chat and global broadcast Durable Object queues, delivery alarms, scheduled monitoring, and retention cleanup.
- `src/pages.js`: bilingual public website, local interactive simulator, privacy, and operator setup.
- `src/public-icons.js` and `src/vendor/public-icons/`: shared Router icon artwork, deferred browser motion assets, cacheable asset responses and upstream provenance/licenses.
- `migrations/`: initial and supplemental notification, admin, language, control-center and guardrail schemas.
- `wrangler.jsonc`: existing Worker/domain, resource bindings, ten-minute monitoring, and daily cleanup schedules.
- `tests/`: policy, moderation, command, handler, and page checks using controlled Telegram responses and local SQLite.

## Official references

- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Telegram Mini Apps: launch and signed-data validation](https://core.telegram.org/bots/webapps)
- [Cloudflare automatic resource provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)
- [D1 Worker API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Workers Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/)
