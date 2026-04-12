/**
 * Escape HTML special characters to safely display untrusted strings.
 */
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fullNameFromTg(tg) {
  const full = [tg?.first_name, tg?.last_name].filter(Boolean).join(' ').trim();
  return full || tg?.username || 'User';
}

function mentionHtml(tg) {
  const fullName = fullNameFromTg(tg);
  const id = tg?.id;
  if (!id) return `<b>${escHtml(fullName)}</b>`;
  return `<a href="tg://user?id=${id}">${escHtml(fullName)}</a>`;
}

module.exports = { escHtml, fullNameFromTg, mentionHtml };