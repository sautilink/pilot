# SautiLink Pilot

Telegram moderation for any eligible group, hosted on the owner's Cloudflare Worker.

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

### Admin controls

| Command | Action |
| --- | --- |
| `/start`, `/help`, `/rules`, `/pilot` | Explain the bot and rules |
| `/status` | Show group moderation/permission status (admins) |
| `/strikes USER_ID` | Show this group's strikes for the member (admins) |
| `/forgive USER_ID` | Reset this group's strike history; does not remove an existing ban |
| `/unban USER_ID` | Remove a ban while preserving strike history |
| `/pause`, `/resume` | Pause/resume moderation in this group |

For member commands, replying to a user's message also works. Numeric IDs are used instead of ambiguous usernames. Commands are authorized server-side on every request. Admin mutations cannot be replayed merely because their acknowledgement failed.

A human administrator's membership decision cancels older bot attempts. A manual unban preserves previous strikes; only `/forgive` resets them. A subsequent new offense may receive the next penalty. Telegram handles expiry using `until_date`; no timer later unbans someone over a newer admin decision.

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
2. Creates the D1 schema idempotently (also supplied in `migrations/0001_initial.sql`).
3. Registers member/admin command menus.
4. Sets `https://pilot.sautilink.com/telegram/webhook` with a secret header.
5. Explicitly subscribes to `message`, `edited_message`, `my_chat_member` and `chat_member` updates.
6. Marks setup complete. The public page then enables the add-to-group button.

Pending updates are not silently dropped. Messages older than the activation time are not moderated. Re-running setup is safe and preserves strikes.

### 5. Verify in a test supergroup

Use a separate ordinary test account; admins are intentionally exempt. Add the bot as admin with **Delete messages** and **Ban users**. Confirm `/status` shows complete permissions, then verify:

- An allowed SautiLink link remains visible.
- A forbidden link is deleted; the member is banned for 24 hours; the notice names the correct member and reason.
- Admin posts and linked-channel automatic posts remain untouched.
- A forwarded message from an ordinary member is moderated.
- `/unban` preserves strikes; a later new offense produces seven days, then permanent.
- `/forgive` resets the counter; `/pause` and `/resume` work only for admins.

Do not claim live Telegram validation until these checks have actually been run. The automated suite uses a fake Telegram API and real local SQLite.

## Reliability and limits

- A Durable Object queues each chat's decisions across network awaits. D1 persists incidents and update IDs. Albums/retries count once; delayed messages from an existing ban episode cannot skip penalty levels.
- Deletion, attempted ban and confirmed ban are separate states. A lost ban response causes Telegram to retry; the bot reconciles current membership and never blindly reapplies an uncertain ban. Only a confirmed action increments the strike.
- Success notices are best effort and at most once. An uncertain `sendMessage` response can mean the notice is absent; retrying could produce duplicates. Telegram supplies no idempotency key for this operation.
- **Timed bans require a supergroup.** A legacy basic group receives guidance and is not silently given permanent bans.
- **Telegram ban behavior can delete other messages from that user**, because `revoke_messages` is always true for supergroup bans.
- An unrelated channel sender does not disclose the underlying person. Pilot deletes offending content and asks admins to review it, rather than banning Telegram's fake compatibility user or applying the wider permanent `banChatSenderChat` action.
- Copy-pasted/reuploaded content without forward metadata cannot reliably be classified as forwarded. Image text/QR codes and remote redirects are not scanned. URLs inside allowed sites are judged by the allowed destination, not by following later redirects.
- Deletion is subject to Telegram's 48-hour limit. Stale messages are skipped. API outages or missing privileges can delay or prevent moderation; failures are not announced as successful bans.

## Storage and privacy

D1 stores chat/user IDs, per-group strike counts, incident reason categories/action status and update IDs. It does not store message text, media, captions, full links or bot tokens. The public `/privacy` page explains this behavior.

Daily retention cleanup removes processed-update IDs after seven days and incident details after thirty days. Member strike totals remain until an admin resets them; group settings remain for continued operation. Platform request logs and backups have their own Cloudflare retention settings.

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
- `src/moderator.js`: authorization, escalation, admin commands and safe reconciliation.
- `src/store.js`: D1 schema and state transitions.
- `src/telegram.js`: bounded Telegram requests and webhook authentication.
- `src/handler.js`: HTTP routing, authenticated setup and webhook validation.
- `src/index.js`: Cloudflare entry point and per-chat Durable Object queue.
- `src/pages.js`: public website, privacy and operator setup page.

## Official references

- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Cloudflare automatic resource provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)
- [D1 Worker API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Workers Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/)
