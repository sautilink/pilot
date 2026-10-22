// Admin templates are plain text. Formatting is applied only after substitution.
export function fillTemplate(template,values,maxLength=3500) {
  const text=String(template || '').replace(/\{([a-z]+)\}/g,(token,key)=>Object.hasOwn(values,key) ? String(values[key] ?? '') : token);
  // Expansion can be much larger than the saved template; preserve a safe margin
  // below Telegram's limit and never cut through a UTF-16 surrogate pair.
  return text.length>maxLength ? text.slice(0,maxLength-1).replace(/[\uD800-\uDBFF]$/,'')+'…' : text;
}

export function memberName(user,language='sw') {
  return [user?.first_name,user?.last_name].filter(Boolean).join(' ').slice(0,160) || (language==='en' ? 'Member' : 'Mtumiaji');
}

export function publicGroupRules(settings,language='sw') {
  const base=language==='en'
    ? 'Unapproved links and forwarded messages are removed. Penalties: 24 hours → 7 days → permanent ban.'
    : 'Links zisizoruhusiwa na ujumbe wa forward huondolewa. Adhabu: saa 24 → siku 7 → ban ya kudumu.';
  const commands=settings?.command_spam_enabled!==false
    ? language==='en'
      ? 'Messages made up of unapproved long /command codes are silently deleted. This does not add a ban, mute or strike. Ordinary bot commands remain available.'
      : 'Ujumbe wenye code ndefu tu za /command zisizoruhusiwa hufutwa kimya kimya. Hakuna ban, mute wala kosa linaloongezwa kwa code hizo. Commands za kawaida za bots zinaendelea kufanya kazi.'
    : '';
  const extra=settings?.[`rules_${language==='en' ? 'en' : 'sw'}`];
  return [base,commands,extra].filter(Boolean).join('\n\n');
}
