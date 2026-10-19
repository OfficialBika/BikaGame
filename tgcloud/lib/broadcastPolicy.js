export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isPermanentRecipientError(error) {
  const text = String(error?.description || error?.message || error || '').toLowerCase();
  return /bot was blocked by the user|user is deactivated|chat not found|bot was kicked|bot is not a member|not enough rights to send|have no rights to send|group chat was upgraded|user not found|forbidden/.test(text);
}

export function broadcastRetryDelayMs(error, attempt) {
  const status = Number(error?.code || error?.error_code || 0);
  const retryAfter = Number(
    error?.parameters?.retry_after ??
    error?.response?.parameters?.retry_after ??
    error?.details?.parameters?.retry_after ??
    0
  );
  if (retryAfter > 0) return Math.min(60000, retryAfter * 1000 + 250);
  if (status === 429 || status >= 500 || status === 0) {
    return Math.min(8000, 250 * (2 ** Math.max(0, Number(attempt || 1) - 1)));
  }
  return 0;
}

export function parseBroadcastRequest(rawText, hasReply) {
  const raw = String(rawText || '').trim();
  if (/(^|\s)(?:-h|--help|help)(?:\s|$)/i.test(raw)) {
    return { action: 'help' };
  }
  if (/^(?:resume|--resume|-resume)$/i.test(raw)) {
    return { action: 'resume' };
  }
  if (/^(?:cancel|stop|end|--cancel|-cancel)$/i.test(raw)) {
    return { action: 'cancel' };
  }
  if (/^(?:status|--status|-status)$/i.test(raw)) {
    return { action: 'status' };
  }

  const forceCopy = /(^|\s)(?:-copy|--copy)(?=\s|$)/i.test(raw);
  const text = raw.replace(/(^|\s)(?:-copy|--copy)(?=\s|$)/ig, ' ').trim();
  if (forceCopy || (!text && hasReply)) {
    return hasReply ? { action: 'start', mode: 'copy', text: '' } : { action: 'invalid-copy' };
  }
  if (!text) return { action: 'help' };
  return { action: 'start', mode: 'text', text };
}
