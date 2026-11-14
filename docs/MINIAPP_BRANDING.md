# Telegram Mini App loading and BotFather branding

Pilot's `/app` (Dashboard) and `/tools` (Community Tools) contain a
shared bilingual, animated **Please wait… / Tafadhali subiri…** screen.

- On receiving signed Telegram initData, the page displays a progress
  indicator while its API requests are pending, and removes it only when
  verified data is ready or an error is shown.
- After eight seconds, it explains that Telegram and group permissions
  may take longer, with a way to reopen the bot. No fake percentage,
  claimed connection success, or automatic permissions bypass.
- The HTML/CSS uses the existing app font and theme, no extra network
  requests, accessible status text, and reduced-motion support.
- Normal anonymous website visitors see the public landing page,
  not a perpetual spinner.

## BotFather: configure Telegram's *native* splash icon

Telegram's splash screen appears **before the web page loads**. It is
controlled by the bot owner inside Telegram, not through Pilot's GitHub
repository or a Bot API call:

1. Open the official [@BotFather](https://t.me/BotFather) account.
2. Send `/mybots`, choose `@sautilinkpilotbot`.
3. Go to **Bot Settings → Configure Mini App → Configure Splash Screen**.
   On some BotFather versions this first requires enabling/configuring
   the Main Mini App.
4. Upload **the approved SautiLink Pilot icon** when prompted. Use a
   clean, square, transparent logo source; never a screenshot or an
   imitation of the brand. Follow any file-type/size constraints shown
   by BotFather (not all clients allow arbitrary PNGs). Do not upload
   or disclose bot tokens.
5. Configure the light and dark background/header colors, preview the
   result with **Open Splash Screen Preview**, then save.
   Suggested neutral app theme: light `#ffffff`, dark `#0b0b0e`.
   Keep the Pilot logo visible with adequate contrast; no extra
   background disc behind the logo.

Telegram also offers a **Main Mini App** (Launch App button on the bot
profile) with **photo/video preview media**. This is different from the
splash logo. In BotFather configure a Main Mini App URL such as
`https://pilot.sautilink.com/app` if the bot owner wants a direct
profile launcher. Upload approved screenshots/demo videos for the
Main Mini App profile separately; previews may be localized. Test
actual Telegram launch context before enabling it publicly.

The BotFather steps require the account that owns the bot. Repository
deployments cannot prove that the splash logo or previews were updated.

References:
- https://core.telegram.org/bots/features#customizable-loading-screens
- https://core.telegram.org/bots/webapps#launching-the-main-mini-app
