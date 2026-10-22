// This router is reachable only through the Worker's Durable Object binding.
// No public HTTP route or group-admin Mini App action forwards here.
export async function routeBroadcast({ owner, service, payload }) {
  const actor = payload?.actor;
  if (!Number.isSafeInteger(actor?.id) || actor.id <= 0 || actor.is_bot || actor.chatType !== 'private' || actor.chatId !== actor.id) {
    const error = new Error('owner_private_required');
    error.code = 'owner_private_required'; error.status = 403; throw error;
  }
  const input = payload.input && typeof payload.input === 'object' && !Array.isArray(payload.input) ? payload.input : {};
  switch (payload.action) {
    case 'claim': return owner.claim(actor, input.code);
    case 'compose_start': return service.composeStart({ actor, replaceDraftId: input.replaceDraftId });
    case 'compose_state': return service.composeState({ actor });
    case 'compose_clear': return service.clearCompose({ actor });
    case 'draft_create': return service.createDraft({ actor, content: input.content, sourceUpdateId: input.sourceUpdateId });
    case 'draft_get': return service.getDraft({ actor, id: input.id });
    case 'preview_set': return service.setPreview({ actor, id: input.id, messageId: input.messageId });
    case 'confirm': return service.confirm({ actor, id: input.id, previewMessageId: input.previewMessageId });
    case 'cancel': return service.cancel({ actor, id: input.id });
    case 'panel': return service.panel({ actor });
    default: {
      const error = new Error('broadcast_action_invalid');
      error.code = 'broadcast_action_invalid'; error.status = 400; throw error;
    }
  }
}
