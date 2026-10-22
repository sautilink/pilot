# SautiLink Pilot

Telegram moderation for any eligible group, with a bilingual Telegram Mini App, private member tools, and optional group controls, hosted on the owner's existing Cloudflare Worker.

- **Bot:** [@sautilinkpilotbot](https://t.me/sautilinkpilotbot)
- **Website:** https://pilot.sautilink.com
- **Worker:** `sautilink-pilot`
- **Repository:** https://github.com/sautilink/pilot

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
- `t.me/techhubtz`, `t.me/sautilink`, `t.me/sautilink_cloud`, `t.me/drcharlesofficial`.
- Public post links and `/s/` previews for those four Telegram usernames.

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

The existing link/forward policy stays active. Additional moderation behavior starts disabled and is enabled separately by a verified group admin.

| Feature | Initial state | Behavior when enabled or configured |
| --- | --- | --- |
| Extra whitelist | Empty | Adds scoped allowances for this group; the SautiLink base allowlist remains |
| Welcome messages | Off | Sends a bilingual, customizable welcome after a member joins |
| Group rules note | Empty | Appends a plain-text note to public rules and relevant welcome/join messages |
| Notice style | Detailed | Admin can choose detailed, compact, or formal notices and an extra plain-text message |
| Anti-flood | Off | Default threshold is more than 8 messages in 10 seconds; removes excess messages |
| Optional flood mute | Off; flood action defaults to delete | Admin may choose a 1–60 minute mute for eligible ordinary members in a supergroup; the default duration is 5 minutes |
| Join request screening | Off | Admin chooses manual review or a short rules acknowledgement with a simple arithmetic question |
| Problem alerts | Off for each admin/group | Opted-in admins receive private, throttled alerts while they retain their role |
| Scheduled reports | Off for each admin/group | Opted-in admins choose a daily or weekly private summary |

Pausing moderation also pauses automated flood actions, welcomes and challenge approval. Admins can still review records and make deliberate decisions.

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

### Anti-flood and join requests

Flood control is independent of the three-strike link/forward policy. It never adds a link/forward strike. Admins choose a threshold of 3–30 messages in a 5–60 second window. Edits and service join/leave messages are excluded, albums count as one event, and admin/channel exemptions remain. The normal link/forward policy takes priority. A flood mute is not used to replace an existing human restriction or extend an existing mute; excess-message removal can still occur. Flood notices are throttled to avoid producing another stream of messages.

Join screening requires Telegram join requests to be enabled for the group or invite link, and **Invite users** permission for the bot. In manual-review mode, the request remains pending for an admin. In challenge mode, Pilot sends a rules message and simple arithmetic buttons through Telegram's limited private contact window. A correct response can approve the matching current request. Expiry or an incorrect answer never bans the applicant; the request stays available for manual review. Human membership changes and newer requests invalidate older buttons. Telegram's separate guard-bot query protocol is handed back to human admins with a `queue` result.

This is a lightweight acknowledgement step, not proof that someone is human. Members who join without a join request do not go through the challenge.

### Private alerts, reports and operator health

An admin opts in separately for each group through the app or private `/alerts` and `/report` commands. Reports summarize incidents, confirmed bans, link/forward categories and pending appeals. They do not send full conversation logs. The first report is due after the chosen interval; changing the subscription starts a new interval. Alert causes include missing permissions, paused moderation, unconfirmed notices and moderation actions that need review.

The Worker runs monitoring on a ten-minute schedule. Each run processes a bounded rotating batch, so a large installation can take longer than one interval to revisit every subscription. Alerts have a cooldown and persistent issues are not sent on every pass. Current admin status is checked again at delivery, and delivery is claimed before the Telegram request. A lost response is recorded as uncertain instead of being resent automatically. Revoked admins and permanently blocked private chats have their subscription disabled. Nothing falls back to a public group message.

`/health` remains a minimal public readiness check. Operator-wide counts and monitoring status are available only through the existing `SETUP_KEY`-protected setup status endpoint; group admins do not receive infrastructure secrets.

## Swahili and English

The language choices are independent:

| Surface | Selection and fallback |
| --- | --- |
| Private Telegram chat | Use `/language` or the **Lugha / Language** button, then select a language. The saved personal choice takes precedence. Without one, Telegram's `language_code` selects English for `en` or an `en-…` code; other or missing codes use Swahili. |
| Telegram group | A verified group admin sends `/language sw` or `/language en` in that group. Unconfigured groups use Swahili. One member's personal preference does not change the group's language. |
| Mini App | The SW / EN choice and the opening button determine the current app language. Group language and personal Telegram preferences remain separate. |
| Website | The visible **SW / EN** selector uses `?lang=sw` or `?lang=en`. Internal navigation preserves the selected language. Home, the local simulator, privacy, and operator setup are translated. No browser storage is used for the choice. |

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
2. Creates the D1 schema idempotently, including delivery tracking, admin selections, language preferences, control records and optional guardrails. SQL migrations are also supplied in `migrations/`.
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
- Opt in to welcomes or flood control in a test group; verify the initial defaults remain off elsewhere.
- Enable join requests and Invite users before checking challenge/manual-review behavior; timeout must not ban an applicant.
- Opt into notifications for a test admin and verify private delivery before relying on reports.
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

The database does not retain moderated message bodies, media, captions, display names, supplied checker text, or bot tokens. It does intentionally store admin-entered group rules and templates, configured whitelist destinations, and member-written appeal text, along with case/audit/operation metadata and notification preferences. Join screening stores identifiers, a temporary challenge answer and delivery/decision state; it does not retain invite links or join-request bios. Incoming text and names are processed for the current update and may appear in messages sent to Telegram. The public `/privacy` page describes the stored metadata and retention in both languages.

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
| Welcome/flood/join-action delivery records and private admin deliveries | Removed after 30 days |
| Resolved health events | Removed 30 days after resolution; unresolved events remain available for review |
| Per-admin notification preferences | Retained for operation, including an opted-out/disabled state; delivery always rechecks the current role |
| Member strike totals | No automatic expiry; `/forgive` resets the count for the relevant group |
| Group settings and language preferences | Kept for continued service; a new language choice replaces the previous choice |
| Service and upgrade settings | Kept for continued operation |

Cleanup does not remove messages already sent to Telegram. Telegram messages, platform request logs, and backups are subject to the relevant platform and operator settings.

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
- `src/moderator.js`: enforcement, escalation, membership changes, and safe reconciliation.
- `src/commands.js`: commands, callbacks, fresh admin authorization, selected-group context, and language choices.
- `src/feature-commands.js`: private link checks, personal cases, appeals, verified group summaries, and opt-in commands.
- `src/dashboard.js`: responsive bilingual Mini App and its authenticated controls.
- `src/miniapp-auth.js` and `src/dashboard-api.js`: Telegram identity validation, request validation, and group-queue routing.
- `src/control-store.js` and `src/control-service.js`: per-group settings, custom allowances, case review, appeals, subscriptions, authorization, operation idempotency and audit records.
- `src/guardrails.js`, `src/guardrail-store.js` and `src/templates.js`: optional flood control, welcomes, join screening and safe custom copy.
- `src/monitoring.js`: opted-in private alerts/reports and protected operator health summaries.
- `src/bot-ui.js`: bilingual private pages, inline navigation, command scopes, profile copy, and experience version.
- `src/announcements.js`: bilingual penalty notices, safe text formatting, delivery tracking, and bounded retry/fallback behavior.
- `src/experience-sync.js`: versioned Telegram metadata upgrades, authenticated bot-identity checks, webhook subscriptions, and synchronization lease.
- `src/store.js`: D1 schemas, state transitions, preferences, delivery records, and retention cleanup.
- `src/telegram.js`: bounded Telegram requests and webhook authentication.
- `src/handler.js`: localized HTTP routing, authenticated setup, webhook validation, and the ready-installation upgrade trigger.
- `src/index.js`: Cloudflare entry point, per-chat Durable Object queue, scheduled monitoring, and retention cleanup.
- `src/pages.js`: bilingual public website, local interactive simulator, privacy, and operator setup.
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
