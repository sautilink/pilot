import { UI_TOKENS, themeButton, themeHead } from './ui-system.js';
import { icon, ICON_CSS, iconScripts } from './public-icons.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const ORIGIN = 'https://pilot.sautilink.com';
const PAGES = new Set(['updates', 'roadmap', 'developers']);

const COPY = {
  en: {
    brand: 'SautiLink Pilot', updates: 'Updates', roadmap: 'Roadmap', developers: 'Developers',
    tools: 'Open community tools', bot: 'Open Pilot on Telegram', feedback: 'Share an idea or report a problem', privacy: 'Privacy',
    updateTitle: 'More ways to run your community.', updateDescription: 'What is new in SautiLink Pilot: community tools, scheduling, admin workflows and carefully scoped developer access.',
    roadmapTitle: 'Help shape what comes next.', roadmapDescription: 'Ideas under consideration for SautiLink Pilot, with community feedback guiding the next improvements.',
    developerTitle: 'Build around your community.', developerDescription: 'Use the SautiLink Pilot group API to read approved knowledge, read events and create announcement drafts for admin review.',
    release: 'Community tools', date: '22 October 2026', available: 'Release notes',
    updateIntro: 'Pilot now brings community planning, shared admin work and useful integrations into one private workspace. Choose the tools that suit each group.',
    policyTitle: 'Your group’s rules stay in place.', policyText: 'Admins and the linked channel keep their exemptions. Link and forward moderation retains the 24-hour, 7-day and permanent ban sequence. Command spam removal remains delete-only.',
    updateCards: [
      ['incidents', 'A shared report inbox', 'Members can reply with /flag and a reason. Admins can claim a report, dismiss it, mark it resolved or deliberately delete the reported message. Reports never create automatic strikes or bans.'],
      ['clock', 'Scheduled announcements', 'Preview announcements and schedule them for one group, once or on a recurring schedule. Delivery checks current admin permissions and keeps uncertain outcomes visible for review.'],
      ['users', 'Events and RSVPs', 'Publish group events and let members record their own attendance response. Admins see useful totals without a publicly exposed attendee list.'],
      ['book', 'Curated highlights', 'Select the resources, posts and announcements that matter and prepare a weekly digest from that approved material.'],
      ['settings', 'Presets, selective copying and restore', 'Start from a group preset, preview configuration differences, copy selected settings between groups you manage and restore a saved configuration.'],
      ['help', 'An approved answer library', 'Add group FAQs and source links. Members can search the knowledge base and use /ask to find answers selected by their admins.'],
      ['lock', 'Quieter replies inside groups', 'Supported commands can receive an ephemeral reply visible only to the requesting member. Delivery depends on Telegram and its clients; important information remains available in the private dashboard.'],
      ['globe', 'Optional community pages', 'Create a community page with an introduction, rules, resources and a join link. Keep it private, publish it, or share an unlisted page. Publishing the group FAQ is a separate choice.'],
      ['link', 'Links with an expiry', 'Temporarily allow one exact URL. The allowance ends at the selected time and applies to new messages while it is active.'],
      ['shield', 'Raid signals and temporary controls', 'Turn on group activity alerts and review unusual join or spam bursts. An admin can deliberately apply a temporary lockdown; restoration respects later human permission changes.'],
      ['code', 'Scoped developer access', 'Create revocable, expiring credentials for a single group. Integrations can read approved knowledge or events, or submit drafts that remain subject to admin review.'],
      ['mail', 'Feedback and a visible roadmap', 'Send a feature suggestion or a problem report from the tools workspace and follow product changes on this page.'],
    ],
    setupTitle: 'Start with one group.', setupText: 'Open Pilot in Telegram, choose your group and open community tools. Admin features appear after Pilot verifies your current role. Scheduled posts and public community pages begin only when an admin configures them.',
    roadmapIntro: 'These are directions we are exploring. They are not delivery commitments, and there are no promised release dates. Feedback helps us decide which problem to solve next.',
    exploring: 'Exploring', roadmapCards: [
      ['help', 'Optional assistance for approved answers', 'Help members find and understand the material their admins have approved. Any future AI option would be an explicit choice for each group, with clear source references.'],
      ['book', 'Reviewed source imports', 'Bring useful information from selected feeds or documents into a review queue before it becomes community knowledge or a scheduled post.'],
      ['code', 'More connectors', 'Explore direct connections to support tools, release notes and community calendars while keeping access scoped to the intended group.'],
      ['users', 'Richer event planning', 'Explore more event options and useful reminders based on how communities use the current event tools.'],
    ],
    roadmapFeedbackTitle: 'Tell us about the task you want to make easier.', roadmapFeedbackText: 'A concrete example is helpful: what your community does, what takes too much effort and what a good result would look like. Send suggestions through Pilot’s feedback tool.',
    apiIntro: 'The group API connects your own server or automation to approved community information. Every credential belongs to one group and has only the scopes its admin selected.',
    gettingStarted: 'Create a group credential', tokenSteps: [
      'Open Pilot from Telegram and choose a group where you are currently an admin.',
      'Open Community tools → Integrations. Choose a label, the minimum scopes you need and an expiry from 1 to 90 days.',
      'Confirm creation, then copy the token shown once into your server’s secret store or environment configuration.',
      'Send requests from your server. Keep the token out of chat messages, public code, browser bundles and URLs. Revoke it in Integrations when it is no longer needed.',
    ],
    accessTitle: 'Access is checked on every request.', accessText: 'Pilot stores a hash of the credential. Expired or revoked tokens stop working, and the creator must still be an admin of the bound group. Client-supplied group IDs do not select a different group.',
    scopesTitle: 'Choose the operation and its scope', operation: 'Operation', scope: 'Required scope', returns: 'Result',
    scopes: [
      ['knowledge', 'knowledge:read', 'Approved FAQ entries, optionally filtered with a query.'],
      ['events', 'events:read', 'The group’s event information, without member RSVP identities.'],
      ['draft', 'drafts:write', 'An announcement draft placed in the group’s admin review queue.'],
    ],
    requestTitle: 'Make a request', requestText: 'Send JSON to the endpoint below with an Authorization header. YOUR_GROUP_TOKEN is a placeholder for your server-held credential.',
    knowledgeTitle: 'Search approved knowledge', draftTitle: 'Create an announcement draft',
    draftExplanation: 'Use a new random requestId of 16–80 letters, numbers, underscores or hyphens for each draft. Reuse the same ID and unchanged body when checking a retry. Changing the body with the same ID creates a conflict.',
    draftReview: 'A draft is never sent automatically. An admin reviews it in Community tools → Integrations. Approval records the review; the admin deliberately chooses a separate posting or scheduling action.',
    fieldsTitle: 'Inputs and limits', fields: [
      ['knowledge', 'input: {} or {"query":"your question"}; query up to 200 characters.'],
      ['events', 'input: {}.'],
      ['draft', 'input: {"title":"Release title","text":"Announcement text"}; title up to 120 and text up to 3,500 characters. requestId is required.'],
      ['Requests', '60 requests per minute per token.'],
      ['Drafts', '20 new drafts per token in a rolling 24 hours; up to 50 pending drafts per group.'],
      ['Credentials', 'Expiry from 1–90 days; up to 10 active credentials per group. A current group admin can revoke a credential.'],
    ],
    errorsTitle: 'Handle the response', errorsText: 'A successful response uses {"ok":true,"data":...}. Errors use {"ok":false,"error":"code"}. Check the HTTP status before using the returned data.',
    errors: [
      ['401', 'The credential is missing, invalid, expired or revoked.'],
      ['403', 'The required scope is missing or the creator is no longer authorized.'],
      ['409', 'A request conflicts with an earlier operation, is still pending, or a resource limit has been reached.'],
      ['429', 'A request or draft rate limit has been reached. Pause before trying again.'],
      ['503', 'Pilot could not verify authorization or complete the request. For a draft retry, preserve the same requestId and body.'],
    ],
    developerFeedback: 'Need another integration?', developerFeedbackText: 'Describe the system and the small set of data or actions it needs. The feedback tool is the place to propose additional scopes and connectors.',
  },
  sw: {
    brand: 'SautiLink Pilot', updates: 'Maboresho', roadmap: 'Mipango', developers: 'Watengenezaji',
    tools: 'Fungua zana za community', bot: 'Fungua Pilot kwenye Telegram', feedback: 'Pendekeza feature au ripoti tatizo', privacy: 'Faragha',
    updateTitle: 'Njia zaidi za kuendesha community yako.', updateDescription: 'Maboresho ya SautiLink Pilot: zana za community, ratiba, kazi za admins na miunganisho yenye ruhusa maalumu.',
    roadmapTitle: 'Shiriki kuamua kinachofuata.', roadmapDescription: 'Mawazo yanayofikiriwa kwa SautiLink Pilot, yakiongozwa na maoni na mahitaji ya communities.',
    developerTitle: 'Unganisha zana za community yako.', developerDescription: 'Tumia API ya SautiLink Pilot kusoma majibu yaliyoidhinishwa, kusoma matukio na kuunda rasimu za matangazo kwa mapitio ya admins.',
    release: 'Zana za community', date: '22 Oktoba 2026', available: 'Taarifa za maboresho',
    updateIntro: 'Pilot sasa inaunganisha mipango ya community, kazi za pamoja za admins na miunganisho muhimu kwenye paneli moja ya faragha. Chagua zana zinazofaa kila group.',
    policyTitle: 'Kanuni za group lako zinaendelea kuheshimiwa.', policyText: 'Admins na channel iliyo linked wanaendelea kuheshimiwa. Links na forwards zisizoruhusiwa zinaendelea kufuata ban ya saa 24, siku 7 na permanent. Spam ya commands inaendelea kufutwa tu.',
    updateCards: [
      ['incidents', 'Inbox ya pamoja ya reports', 'Member anaweza kujibu ujumbe kwa /flag na sababu. Admin anaweza kuchukua report, kuikataa, kuifunga au kuamua kufuta ujumbe ulioripotiwa. Report haitoi kosa au ban moja kwa moja.'],
      ['clock', 'Ratiba za matangazo', 'Kagua tangazo na ulipangie muda kwenye group moja, mara moja au kwa ratiba inayojirudia. Pilot hukagua ruhusa za sasa na kuonyesha matokeo ambayo hayajathibitishwa kwa mapitio.'],
      ['users', 'Matukio na RSVP', 'Weka matukio ya group na uruhusu members kueleza kama watashiriki. Admins wanaona jumla zinazofaa bila kuonyesha hadharani majina ya walioitikia.'],
      ['book', 'Muhtasari uliochaguliwa', 'Chagua rasilimali, posts na matangazo muhimu, kisha andaa muhtasari wa wiki kutoka kwenye maudhui hayo yaliyoidhinishwa.'],
      ['settings', 'Presets, kunakili na kurejesha mipangilio', 'Anza na preset, kagua tofauti, nakili sehemu ulizochagua kati ya groups unazosimamia au rejesha mipangilio iliyohifadhiwa.'],
      ['help', 'Maktaba ya majibu yaliyoidhinishwa', 'Ongeza FAQ za group na links za vyanzo. Members wanaweza kutafuta majibu na kutumia /ask kupata taarifa zilizochaguliwa na admins.'],
      ['lock', 'Majibu ya faragha ndani ya groups', 'Commands zinazotumika zinaweza kupata jibu la muda linaloonekana kwa member aliyeuliza pekee. Kufika kwa jibu kunategemea Telegram na app yake; taarifa muhimu zinaendelea kupatikana kwenye paneli ya faragha.'],
      ['globe', 'Kurasa za community kwa hiari', 'Tengeneza ukurasa wenye utambulisho, kanuni, rasilimali na link ya kujiunga. Uache private, uchapishe public au ushiriki kama unlisted. Kuchapisha FAQ ni chaguo jingine la admin.'],
      ['link', 'Links zenye muda wa mwisho', 'Ruhusu URL moja kwa muda. Ruhusa inaisha kwa muda uliochaguliwa na hutumika kwa ujumbe mpya wakati ikiwa hai.'],
      ['shield', 'Taarifa za raid na udhibiti wa muda', 'Washa taarifa za shughuli za group na kagua ongezeko lisilo la kawaida la kujiunga au spam. Admin anaweza kuchagua lockdown ya muda; kurejesha ruhusa kunaheshimu mabadiliko ya baadaye ya admins.'],
      ['code', 'Ruhusa maalumu kwa developers', 'Unda credentials za group moja, zenye expiry na uwezo wa kufutwa. Integration inaweza kusoma FAQ au matukio, au kuleta rasimu zinazopitiwa na admin.'],
      ['mail', 'Maoni na mipango inayoonekana', 'Tuma pendekezo au tatizo kupitia paneli ya zana na fuatilia maboresho ya Pilot kwenye ukurasa huu.'],
    ],
    setupTitle: 'Anza na group moja.', setupText: 'Fungua Pilot kwenye Telegram, chagua group lako na uingie kwenye zana za community. Zana za admin zinaonekana baada ya jukumu lako kuthibitishwa. Ratiba na kurasa za public huanza admin anapozisanidi.',
    roadmapIntro: 'Haya ni mawazo tunayochunguza. Si ahadi za utekelezaji na hayana tarehe za kutolewa zilizopangwa. Maoni yanasaidia kuchagua tatizo linalofuata la kutatua.',
    exploring: 'Inachunguzwa', roadmapCards: [
      ['help', 'Msaada wa hiari kwa majibu yaliyoidhinishwa', 'Kuwasaidia members kupata na kuelewa taarifa ambazo admins wameidhinisha. Chaguo lolote la baadaye la AI litahitaji group kulichagua, likiwa na vyanzo vinavyoonekana.'],
      ['book', 'Kuleta taarifa kwa mapitio', 'Kuleta taarifa kutoka feeds au nyaraka zilizochaguliwa kwenye foleni ya mapitio kabla hazijawa FAQ au post iliyopangwa.'],
      ['code', 'Miunganisho zaidi', 'Kuchunguza miunganisho ya moja kwa moja na zana za support, release notes na kalenda, kila muunganisho ukiwa na ruhusa za group husika.'],
      ['users', 'Mipango zaidi ya matukio', 'Kuchunguza machaguo mapya ya matukio na vikumbusho kulingana na matumizi halisi ya communities.'],
    ],
    roadmapFeedbackTitle: 'Tuambie kazi unayotaka kurahisisha.', roadmapFeedbackText: 'Mfano halisi unasaidia: community yenu inafanya nini, nini kinachukua muda mwingi na matokeo mazuri yangekuwaje. Tuma pendekezo kupitia zana ya maoni ya Pilot.',
    apiIntro: 'API ya group inaunganisha server au automation yako na taarifa za community zilizoidhinishwa. Kila credential ni ya group moja na ina ruhusa ambazo admin amechagua pekee.',
    gettingStarted: 'Unda credential ya group', tokenSteps: [
      'Fungua Pilot kupitia Telegram na uchague group ambalo wewe ni admin wake kwa sasa.',
      'Fungua Zana za community → Miunganisho. Chagua jina, scopes unazohitaji tu na expiry ya siku 1 hadi 90.',
      'Thibitisha, kisha nakili token inayoonyeshwa mara moja na uihifadhi kwenye secret store au mazingira salama ya server yako.',
      'Tuma maombi kupitia server yako. Token isiwekwe kwenye chat, code ya public, JavaScript ya browser au URL. Ifute kupitia Miunganisho ikiwa haihitajiki tena.',
    ],
    accessTitle: 'Ruhusa zinakaguliwa kwa kila ombi.', accessText: 'Pilot huhifadhi hash ya credential. Token iliyoisha au kufutwa haifanyi kazi, na aliyeitengeneza lazima aendelee kuwa admin wa group lake. Kutuma group ID tofauti kwenye ombi hakubadilishi group la token.',
    scopesTitle: 'Chagua operation na scope yake', operation: 'Operation', scope: 'Scope inayohitajika', returns: 'Matokeo',
    scopes: [
      ['knowledge', 'knowledge:read', 'FAQ zilizoidhinishwa, zikiwa na chaguo la kutafuta kwa swali.'],
      ['events', 'events:read', 'Taarifa za matukio ya group, bila utambulisho wa members walioitikia RSVP.'],
      ['draft', 'drafts:write', 'Rasimu ya tangazo kwenye foleni ya mapitio ya admins wa group.'],
    ],
    requestTitle: 'Tuma ombi', requestText: 'Tuma JSON kwenye endpoint hapa chini ikiwa na Authorization header. YOUR_GROUP_TOKEN ni mfano tu wa credential iliyohifadhiwa kwenye server yako.',
    knowledgeTitle: 'Tafuta majibu yaliyoidhinishwa', draftTitle: 'Unda rasimu ya tangazo',
    draftExplanation: 'Tumia requestId mpya ya nasibu yenye herufi, namba, underscore au hyphen 16–80 kwa kila rasimu. Unaporudia ombi, tumia ID ileile na body ileile. Body tofauti kwa ID ileile hukataliwa kama conflict.',
    draftReview: 'Rasimu haitumwi moja kwa moja. Admin anaipitia kwenye Zana za community → Miunganisho. Approval huhifadhi uamuzi wa mapitio; admin huchagua hatua nyingine ya kutuma au kupanga post.',
    fieldsTitle: 'Inputs na mipaka', fields: [
      ['knowledge', 'input: {} au {"query":"swali lako"}; query hadi herufi 200.'],
      ['events', 'input: {}.'],
      ['draft', 'input: {"title":"Kichwa","text":"Ujumbe wa tangazo"}; title hadi herufi 120 na text hadi 3,500. requestId inahitajika.'],
      ['Maombi', 'Maombi 60 kwa dakika kwa kila token.'],
      ['Rasimu', 'Rasimu mpya 20 kwa token ndani ya saa 24 zinazohesabiwa kurudi nyuma; hadi rasimu 50 zinazosubiri kwa group.'],
      ['Credentials', 'Expiry ya siku 1–90; hadi credentials 10 zilizo hai kwa group. Admin wa sasa anaweza kufuta credential.'],
    ],
    errorsTitle: 'Shughulikia response', errorsText: 'Response iliyofanikiwa ina {"ok":true,"data":...}. Hitilafu ina {"ok":false,"error":"code"}. Kagua HTTP status kabla ya kutumia data.',
    errors: [
      ['401', 'Credential haipo, si sahihi, imeisha au imefutwa.'],
      ['403', 'Scope inayohitajika haipo au mtengenezaji hana tena ruhusa.'],
      ['409', 'Ombi linakinzana na la awali, bado linasubiri, au idadi inayoruhusiwa imefikiwa.'],
      ['429', 'Umefikia idadi ya maombi au rasimu inayoruhusiwa. Subiri kabla ya kujaribu tena.'],
      ['503', 'Pilot haikuweza kuthibitisha ruhusa au kukamilisha ombi. Unaporudia rasimu, tumia requestId na body zilezile.'],
    ],
    developerFeedback: 'Unahitaji integration nyingine?', developerFeedbackText: 'Eleza mfumo na taarifa au hatua chache unazohitaji. Tumia zana ya maoni kupendekeza scopes na miunganisho zaidi.',
  },
};

const REQUESTS = {
  knowledge: `curl https://pilot.sautilink.com/api/integrations \\\n  --request POST \\\n  --header 'Authorization: Bearer YOUR_GROUP_TOKEN' \\\n  --header 'Content-Type: application/json' \\\n  --data '{"operation":"knowledge","input":{"query":"registration"}}'`,
  draft: `{
  "operation": "draft",
  "requestId": "YOUR_UNIQUE_REQUEST_ID",
  "input": {
    "title": "Community update",
    "text": "Our next community session is ready for review."
  }
}`,
};

function metadata(page, t, lang) {
  const prefix = { updates: 'update', roadmap: 'roadmap', developers: 'developer' }[page];
  const title = `${t[prefix + 'Title']} · SautiLink Pilot`, description = t[prefix + 'Description'];
  const base = `${ORIGIN}/${page}`, canonical = base + (lang === 'sw' ? '?lang=sw' : '');
  const data = JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', name: title, description, url: canonical, inLanguage: lang,
    isPartOf: { '@type': 'WebSite', name: 'SautiLink Pilot', url: `${ORIGIN}/` }, publisher: { '@type': 'Organization', name: 'SautiLink Corporation', url: 'https://www.sautilink.com/' } })
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  return `<title>${escape(title)}</title><meta name="description" content="${escape(description)}"><meta name="robots" content="index,follow,max-image-preview:large"><link rel="canonical" href="${canonical}"><link rel="alternate" hreflang="en" href="${base}"><link rel="alternate" hreflang="sw" href="${base}?lang=sw"><link rel="alternate" hreflang="x-default" href="${base}"><meta property="og:type" content="website"><meta property="og:site_name" content="SautiLink Pilot"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="https://sautilink.com/logo.png"><meta property="og:locale" content="${lang === 'sw' ? 'sw_TZ' : 'en_US'}"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(description)}"><meta name="twitter:image" content="https://sautilink.com/logo.png"><script type="application/ld+json">${data}</script>`;
}

function cards(items, badge = '') {
  return `<div class="cards">${items.map(([symbol, title, description]) => `<article class="card"><div class="card-icon">${icon(symbol)}</div>${badge ? `<p class="badge">${escape(badge)}</p>` : ''}<h2>${escape(title)}</h2><p>${escape(description)}</p></article>`).join('')}</div>`;
}
const table = (headers, rows) => `<div class="table-wrap"><table>${headers ? `<thead><tr>${headers.map(value => `<th scope="col">${escape(value)}</th>`).join('')}</tr></thead>` : ''}<tbody>${rows.map(row => `<tr>${row.map((cell, i) => i === 0 ? `<th scope="row"><code>${escape(cell)}</code></th>` : `<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const codeBlock = value => `<pre tabindex="0"><code>${escape(value)}</code></pre>`;

export function renderReleasePage(page, { lang = 'en' } = {}) {
  page = String(page).replace(/^\//, '');
  if (!PAGES.has(page)) throw new TypeError('Unknown public Pilot release page');
  lang = lang === 'sw' ? 'sw' : 'en';
  const t = COPY[lang], sw = lang === 'sw', suffix = sw ? '?lang=sw' : '';
  const toolsLink = `/tools${sw ? '?lang=sw' : ''}`;
  const feedbackLink = `/tools?section=feedback${sw ? '&lang=sw' : ''}`;
  const action = (href, label, className = 'button') => `<a class="${className}" href="${escape(href)}">${escape(label)}${icon('arrow-right')}</a>`;
  const feedback = (title, description) => `<section class="callout"><div><h2>${escape(title)}</h2><p>${escape(description)}</p></div>${action(feedbackLink, t.feedback)}</section>`;
  let main;
  if (page === 'updates') {
    main = `<div class="release-label"><span class="badge">${escape(t.release)}</span><time datetime="2026-10-22">${escape(t.date)}</time></div><p class="lead">${escape(t.updateIntro)}</p>${cards(t.updateCards)}<section class="note"><h2>${icon('shield')}${escape(t.policyTitle)}</h2><p>${escape(t.policyText)}</p></section><section class="callout"><div><h2>${escape(t.setupTitle)}</h2><p>${escape(t.setupText)}</p></div><div class="action-stack">${action(toolsLink, t.tools)}${action('https://t.me/sautilinkpilotbot', t.bot, 'text-link')}</div></section>`;
  } else if (page === 'roadmap') {
    main = `<p class="lead">${escape(t.roadmapIntro)}</p>${cards(t.roadmapCards, t.exploring)}${feedback(t.roadmapFeedbackTitle, t.roadmapFeedbackText)}`;
  } else {
    main = `<p class="lead">${escape(t.apiIntro)}</p><div class="developer-content"><section class="doc-section"><h2>${icon('key')}${escape(t.gettingStarted)}</h2><ol>${t.tokenSteps.map(step => `<li>${escape(step)}</li>`).join('')}</ol>${action(`/tools?section=integrations${sw ? '&lang=sw' : ''}`, t.tools, 'text-link')}</section><section class="note"><h2>${icon('lock')}${escape(t.accessTitle)}</h2><p>${escape(t.accessText)}</p></section><section class="doc-section"><h2>${escape(t.scopesTitle)}</h2>${table([t.operation, t.scope, t.returns], t.scopes)}</section><section class="doc-section"><h2>${escape(t.requestTitle)}</h2><p>${escape(t.requestText)}</p><p class="endpoint"><span>POST</span><code>https://pilot.sautilink.com/api/integrations</code></p><h3>${escape(t.knowledgeTitle)}</h3>${codeBlock(REQUESTS.knowledge)}<h3>${escape(t.draftTitle)}</h3>${codeBlock(REQUESTS.draft)}<p>${escape(t.draftExplanation)}</p><p class="notice">${escape(t.draftReview)}</p></section><section class="doc-section"><h2>${escape(t.fieldsTitle)}</h2>${table(null, t.fields)}</section><section class="doc-section"><h2>${escape(t.errorsTitle)}</h2><p>${escape(t.errorsText)}</p>${table(null, t.errors)}</section></div>${feedback(t.developerFeedback, t.developerFeedbackText)}`;
  }
  const prefix = { updates: 'update', roadmap: 'roadmap', developers: 'developer' }[page];
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#ffffff">${metadata(page, t, lang)}<link rel="icon" href="https://sautilink.com/logo.png">${themeHead()}<style>${UI_TOKENS}${ICON_CSS}
body{margin:0;color:var(--text);background:var(--page);font:15px/1.7 var(--font-primary);-webkit-font-smoothing:antialiased}a{color:var(--primary);text-decoration:none}a:hover{text-decoration:underline}.shell{width:min(1060px,calc(100% - 48px));margin:auto}header{border-bottom:1px solid var(--line)}.topbar{min-height:76px;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{display:flex;align-items:center;gap:11px;font-size:15px;font-weight:650;color:var(--text);white-space:nowrap}.brand img{width:32px;height:32px;border-radius:8px}.header-actions{display:flex;align-items:center;gap:16px;font-size:13px}.header-actions a[aria-current=page]{color:var(--text);font-weight:650}.hero{padding:72px 0 28px;max-width:850px}.eyebrow{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--primary);font-weight:650}.eyebrow .public-icon{width:20px;height:20px}h1{margin:20px 0 0;font-size:clamp(38px,5.7vw,64px);line-height:1.08;letter-spacing:-.055em;font-weight:750}h2{margin:0 0 10px;font-size:20px;line-height:1.35;letter-spacing:-.025em}h3{font-size:17px;letter-spacing:-.02em;margin:26px 0 12px}p{margin:0 0 16px;color:var(--text-soft)}.lead{max-width:790px;font-size:18px;line-height:1.75;margin:0 0 38px}.release-label{display:flex;flex-wrap:wrap;align-items:center;gap:16px;margin:8px 0 22px;font-size:13px;color:var(--text-soft)}.badge{display:inline-flex;background:var(--primary-soft);color:var(--primary);padding:4px 10px;border-radius:99px;font-size:11px;font-weight:650;line-height:1.5;margin:0 0 10px}.release-label .badge{margin:0;font-size:12px}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;margin:0 0 40px}.card{padding:25px;border:1px solid var(--line);border-radius:24px;background:var(--surface)}.card h2{font-size:18px;margin-top:14px}.card p:not(.badge){font-size:14px;line-height:1.75;margin-bottom:0}.card-icon{width:42px;height:42px;border-radius:13px;display:grid;place-items:center;background:var(--primary-soft);color:var(--primary);margin-bottom:16px}.card-icon .public-icon{width:23px;height:23px}.note{padding:26px 30px;border-radius:22px;background:var(--surface-soft);margin:0 0 34px}.note h2,.doc-section>h2{display:flex;gap:10px;align-items:center}.note h2 .public-icon,.doc-section>h2 .public-icon{width:22px;height:22px;color:var(--primary);flex:none}.note p{margin:0;font-size:14px}.callout{padding:34px 0 60px;display:flex;justify-content:space-between;align-items:center;gap:36px}.callout>div:first-child{max-width:650px}.callout p{margin:0;font-size:14px}.button,.text-link{display:inline-flex;justify-content:center;align-items:center;gap:10px;font-size:13px;font-weight:600}.button{padding:12px 18px;background:var(--button);color:#fff;border-radius:99px;white-space:nowrap}.button:hover{background:var(--button-hover);text-decoration:none}.button .public-icon,.text-link .public-icon{width:17px;height:17px;flex:none}.action-stack{display:flex;flex-direction:column;align-items:center;gap:12px;flex:none}.developer-content{max-width:900px}.doc-section{padding:22px 0 28px;border-bottom:1px solid var(--line);margin-bottom:18px}.doc-section>p{font-size:14px}.doc-section ol{padding-left:22px;color:var(--text-soft);font-size:14px}.doc-section li{padding-left:5px;margin:12px 0}.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:16px;margin:18px 0}table{border-collapse:collapse;min-width:100%;text-align:left;font-size:13px}th,td{padding:14px 16px;border-bottom:1px solid var(--line);vertical-align:top}th{font-weight:600}thead th{background:var(--surface-soft);white-space:nowrap}td{color:var(--text-soft)}tr:last-child td,tr:last-child th{border-bottom:0}code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.9em;overflow-wrap:anywhere}pre{padding:22px;border:1px solid var(--line);border-radius:16px;background:var(--surface-soft);overflow-x:auto;color:var(--text);font-size:13px;line-height:1.8;tab-size:2}pre code{font-size:inherit;overflow-wrap:normal}.endpoint{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:15px 18px;background:var(--primary-soft);border-radius:13px;color:var(--text)}.endpoint span{font-size:11px;font-weight:750;color:var(--primary)}.notice{border-left:3px solid var(--primary);padding:4px 0 4px 17px;margin-top:22px}footer{border-top:1px solid var(--line);padding:28px 0 40px;font-size:13px;color:var(--text-soft)}.footer-row{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}.footer-links{display:flex;gap:18px;flex-wrap:wrap}@media(max-width:900px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.header-actions{gap:12px}.brand{font-size:14px}.callout{align-items:flex-start;flex-direction:column;gap:22px}}@media(max-width:600px){.shell{width:calc(100% - 32px)}.topbar{min-height:72px;flex-wrap:wrap;padding:16px 0;gap:14px}.brand img{width:29px;height:29px}.header-actions{width:100%;justify-content:space-between;gap:9px;font-size:12px}.header-actions .theme-toggle{height:32px;width:32px}.hero{padding:43px 0 24px}h1{font-size:41px}.lead{font-size:16px;margin-bottom:28px}.cards{grid-template-columns:1fr;gap:14px;margin-bottom:28px}.card{padding:22px}.card h2{font-size:19px}.note{padding:22px}.callout{padding:24px 0 44px}.button{white-space:normal;text-align:center}.action-stack{align-items:flex-start}.table-wrap{margin:14px 0}th,td{padding:12px}pre{padding:16px;font-size:12px}.endpoint{padding:12px}.footer-links{gap:13px}}
</style></head><body data-public-icons><header><div class="shell topbar"><a class="brand" href="/${suffix}"><img src="https://sautilink.com/logo.png" alt="" width="32" height="32">${escape(t.brand)}</a><nav class="header-actions" aria-label="${sw ? 'Kurasa za Pilot' : 'Pilot pages'}">${[...PAGES].map(name => `<a href="/${name}${suffix}"${name === page ? ' aria-current="page"' : ''}>${escape(t[name])}</a>`).join('')}<a href="/${page}${sw ? '' : '?lang=sw'}" lang="${sw ? 'en' : 'sw'}">${sw ? 'English' : 'Kiswahili'}</a>${themeButton(lang)}</nav></div></header><main class="shell"><section class="hero"><div class="eyebrow">${icon({ updates: 'radio', roadmap: 'compass', developers: 'code' }[page])}${escape(t[page])}</div><h1>${escape(t[prefix + 'Title'])}</h1></section>${main}</main><footer><div class="shell footer-row"><span>from <a href="https://www.sautilink.com/">SautiLink Corporation</a></span><div class="footer-links"><a href="${escape(feedbackLink)}">${escape(t.feedback)}</a><a href="/privacy${suffix}">${escape(t.privacy)}</a></div></div></footer>${iconScripts()}</body></html>`;
}
