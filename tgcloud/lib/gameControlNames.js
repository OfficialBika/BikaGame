const ALIASES = Object.freeze({
  slot: 'slot',
  bj: 'blackjack',
  blackjack: 'blackjack',
  shan: 'shan',
  dice: 'dice',
  mine: 'mines',
  mines: 'mines',
});

export function normalizeGameKey(value) {
  return ALIASES[String(value || '').trim().toLowerCase()] || null;
}

export function parseGameToggle(text) {
  const value = String(text || '').trim();
  let match = value.match(/^[/.](slot|bj|blackjack|shan|dice|mine|mines)\s+(on|off)$/i);
  if (match) {
    return {
      game: normalizeGameKey(match[1]),
      enabled: match[2].toLowerCase() === 'on',
    };
  }

  match = value.match(/^\/game\s+(on|off)\s+(slot|bj|blackjack|shan|dice|mine|mines)$/i);
  if (match) {
    return {
      game: normalizeGameKey(match[2]),
      enabled: match[1].toLowerCase() === 'on',
    };
  }

  // Explicit game argument only; plain /on and /off retain their existing
  // global-maintenance meaning in the production bot.
  match = value.match(/^\/(on|off)\s+(slot|bj|blackjack|shan|dice|mine|mines)$/i);
  if (match) {
    return {
      game: normalizeGameKey(match[2]),
      enabled: match[1].toLowerCase() === 'on',
    };
  }

  return null;
}

export const GAME_CONTROL_KEYS = Object.freeze(['slot', 'blackjack', 'shan', 'dice', 'mines']);
