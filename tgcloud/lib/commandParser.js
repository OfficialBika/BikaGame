export function parseCommand(text) {
  const value = String(text || '').trim();
  const slash = value.match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i);
  const dot = value.match(/^\.(slot|bj|blackjack|shan|dice|mine|mines|plinko|wheel|crash)(?:\s+([\s\S]*))?$/i);
  const match = slash || dot;
  if (!match) return null;
  let name = match[1].toLowerCase();
  if (name === 'bj') name = 'blackjack';
  if (name === 'mine') name = 'mines';
  return { name, args: (match[2] || '').trim() };
}
