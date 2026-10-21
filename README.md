# SautiLink Pilot

Telegram moderation for any eligible group, with Swahili and English experiences, hosted on the owner's Cloudflare Worker.

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
| `/about` | Learn about SautiLink Pilot |
| `/howitworks` | Understand moderation and escalation |
| `/rules` | Read the link, forward, and exemption rules |
| `/connect` | Add the bot and see the required group permissions |
| `/developer` | Open optional project and source-code information |
| `/help` | Find the relevant guide or contact the group's admin about a penalty |
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
| `/strikes USER_ID` | Group, or verified private panel | This member's strike count in the selected group |
| `/forgive USER_ID` | Group | Reset this group's strike history; preserve an existing ban |
| `/unban USER_ID` | Group | Remove a ban; preserve strike history |
| `/pause`, `/resume` | Group | Pause or resume moderation for new messages |
| `/language sw`, `/language en` | Group | Set that group's messages and announcements to Swahili or English |
| `/testnotice` | Group | Send a clearly labeled sample announcement without deleting, banning, or adding a strike |

For member commands inside the group, replying to the member's message also works. Numeric IDs are used instead of ambiguous usernames. Administrative actions are initiated in the group; the private panel supports inspection and guidance. Detailed replies are delivered privately when possible. If Telegram cannot deliver a private reply, the group receives a short panel link instead of the administrative details.

Admin mutations are claimed before their acknowledgement is sent, so a failed reply cannot replay the action. `/testnotice` is also claimed before sending: if delivery is uncertain, check the group before deliberately issuing another test. This command checks sample-message delivery; it does not perform a real moderation incident.

A human administrator's membership decision cancels older bot attempts. A manual unban preserves previous strikes; only `/forgive` resets them. A subsequent new offense may receive the next penalty. Telegram handles expiry using `until_date`; no timer later unbans someone over a newer admin decision.

## Swahili and English

The three language choices are independent:

| Surface | Selection and fallback |
| --- | --- |
| Private Telegram chat | Use `/language` or the **Lugha / Language** button, then select a language. The saved personal choice takes precedence. Without one, Telegram's `language_code` selects English for `en` or an `en-…` code; other or missing codes use Swahili. |
| Telegram group | A verified group admin sends `/language sw` or `/language en` in that group. Unconfigured groups use Swahili. One member's personal preference does not change the group's language. |
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
2. Creates the D1 schema idempotently, including delivery tracking, admin selections, and language preferences. SQL migrations are also supplied in `migrations/`.
3. Registers localized private, group, and administrator command menus, plus the bot's profile descriptions.
4. Sets `https://pilot.sautilink.com/telegram/webhook` with a secret header.
5. Explicitly subscribes to `message`, `edited_message`, `my_chat_member`, `chat_member`, and `callback_query` updates. The last type enables inline menu navigation.
6. Marks setup complete. The public page then enables the add-to-group button.

Pending updates are not silently dropped. Messages older than the activation time are not moderated. Re-running setup is safe and preserves strikes.

### Updating an already configured installation

Deploy the new code through the existing GitHub/Cloudflare connection. A bot that has completed setup updates its versioned Telegram experience on the next **authenticated, valid webhook update**. Sending `/start` privately supplies an ordinary update for this purpose. Public website visits, health checks, and unauthenticated requests do not trigger metadata changes.

The upgrade verifies the expected bot identity, confirms the webhook subscription including `callback_query`, and updates the localized profile descriptions and scoped command menus. Callback subscription is awaited before the triggering update proceeds; the remaining profile work can finish through the Worker's `waitUntil`. A shared D1 lease prevents competing upgrades, and failures are categorized and delayed before retrying on a later eligible update. Metadata-refresh failures are caught so moderation can still process the incoming update.

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

The database does not store message text, media, captions, full links, display names, or bot tokens. Incoming text and names are processed for the current update and may appear in messages sent to Telegram. The public `/privacy` page describes the stored metadata and retention in both languages.

Daily cleanup applies these rules:

| Data | Retention |
| --- | --- |
| Processed update IDs | Removed when older than 7 days |
| Incident details and their delivery records | Removed when the incident is older than 30 days |
| Selected admin group context | Removed when its last selection/update is older than 30 days |
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
- `src/bot-ui.js`: bilingual private pages, inline navigation, command scopes, profile copy, and experience version.
- `src/announcements.js`: bilingual penalty notices, safe text formatting, delivery tracking, and bounded retry/fallback behavior.
- `src/experience-sync.js`: versioned Telegram metadata upgrades, authenticated bot-identity checks, webhook subscriptions, and synchronization lease.
- `src/store.js`: D1 schemas, state transitions, preferences, delivery records, and retention cleanup.
- `src/telegram.js`: bounded Telegram requests and webhook authentication.
- `src/handler.js`: localized HTTP routing, authenticated setup, webhook validation, and the ready-installation upgrade trigger.
- `src/index.js`: Cloudflare entry point, per-chat Durable Object queue, and scheduled retention cleanup.
- `src/pages.js`: bilingual public website, local interactive simulator, privacy, and operator setup.
- `migrations/`: initial tables and the supplemental notification/admin/language schema.
- `wrangler.jsonc`: existing Worker/domain, resource bindings, and daily cleanup schedule.
- `tests/`: policy, moderation, command, handler, and page checks using controlled Telegram responses and local SQLite.

## Official references

- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Cloudflare automatic resource provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)
- [D1 Worker API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Workers Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/)
