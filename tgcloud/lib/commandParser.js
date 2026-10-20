export function parseCommand(text) {
  const value = String(text || '').trim();
  const slash = value.match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i);
  const dot = value.match(/^\.(slot|bj|blackjack|shan|dice|mine|mines|plinko|wheel|crash|daily|dailyclaim|mybalance|myhistory|top10|leaderboard|history|gift|tour|dt|minestop|bet|bid|stopbet|betwin|tournament|dailytournament)(?:\s+([\s\S]*))?$/i);
  const match = slash || dot;
  if (!match) return null;
  let name = match[1].toLowerCase();
  if (name === 'bj') name = 'blackjack';
  if (name === 'mine') name = 'mines';
  if (name === 'dailyclaim') name = 'daily';
  if (name === 'mybalance') name = 'balance';
  if (name === 'myhistory') name = 'history';
  if (name === 'leaderboard') name = 'top10';
  if (name === 'tour' || name === 'dt' || name === 'minestop') name = 'dailytournament';
  return { name, args: (match[2] || '').trim() };
}
