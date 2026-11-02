# Personalized welcome messages · SautiLink Pilot

Pilot can greet each new member of a Telegram group or supergroup after a real
join, whether Telegram sends `new_chat_members` in a service message or a
`chat_member` transition. This is **optional and OFF by default**. Join
requests awaiting approval do not trigger a premature greeting.

## Configuration

Open `@sautilinkpilotbot` privately → Dashboard → choose the group → Settings
→ Welcome message. Group admins can:

- Enable or disable automatic welcomes per group without affecting moderation.
- Set separate Kiswahili and English plain-text templates, up to 1,800 characters each.
- Tap a tag in the editor to insert it; view a live, unsent preview.
- Set a custom button title (max 48 chars) and HTTPS URL (max 350 chars).
  Both must be supplied together. When blank the button opens Pilot's group rules.
- Choose to keep the message, or remove it after 1, 5, 15, 60 minutes or 1 day.
- Save; Pilot re-checks the current group administrator role before accepting
  changes. Configurations are isolated by chat ID.

## Available placeholders

| Tag | Expansion |
| --- | --- |
| `{mention}` or `{user_mention}` | Clickable Telegram user mention (`tg://user?id=...`) |
| `{user}` or `{name}` | Display name |
| `{first_name}`, `{last_name}` | Telegram profile names |
| `{username}` | `@username`, or — if absent |
| `{user_id}` | Numeric Telegram ID |
| `{group}` or `{group_name}` | Current group name |
| `{group_id}` | Numeric group chat ID |
| `{group_link}` | Public group link, blank for private groups |
| `{rules}` | Group's current rules in its language |
| `{rules_link}` | Pilot's rules entry point |
| `{bot_username}` | Pilot's username |
| `{member_count}` | Current count where Telegram returns it, else — |
| `{date}`, `{time}` | Join-processing date and time in UTC |

Example (Kiswahili):

```text
Karibu {mention} 🌟
Umejiunga na {group_name}. Wewe ni member #{member_count}.

ID yako: {user_id}
Telegram: {username}

Soma sheria kabla ya kupost:
{rules}
```

Do **not** use HTML/JavaScript in the templates. The editor takes plain text:
Pilot escapes member-supplied names, group titles, rules, and URLs; the only
HTML entity it inserts is the verified Telegram mention. Link previews are
disabled. No promises that every Telegram client will render username mentions
identically. Text is limited again after substitution to keep Telegram's
4,096-character limit.

## Reliability, privacy and Telegram limits

- A durable per-group/member join claim prevents duplicate public greetings
  when Telegram sends both membership and service-message updates.
- Join service messages in topics retain their `message_thread_id` when available.
- Bot users, stale joins, disabled groups, paused moderation and unsupported
  chat types do not trigger the greeting.
- A failed/ambiguous Telegram send will **not** be retried blindly to avoid
  duplicate welcome spam. Operators can inspect the welcome health alert.
- Auto-delete schedules only the message ID **sent by Pilot itself**. It never
  deletes a member's message. A bounded Durable Object alarm handles it, with
  cron recovery after interruptions. Telegram can reject deletion if rights
  change or the message exceeds its deletion window.
- Telegram membership service updates and `chat_member` events are already
  subscribed on the webhook. For membership changes the bot must be an admin
  to receive the configured update category.
- This feature does not change restrictions, warnings, strikes, bans, or
  human admin permissions.

## Release checklist

CI: `npm run check`, `npm test`, `npm run build`.
Verify Cloudflare active deployment and 100% traffic. Test with two consenting
test accounts in a staging/test group. Toggle welcome ON, set template and
button, check clickable mention, language, duplicate join event prevention,
private user without username, 5-minute auto-delete, disabled mode, and
group isolation. Do not promise live Telegram verification from CI alone.
