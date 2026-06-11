'use strict';

const SELL_BOTS = {
  catchbot: {
    key: 'catchbot',
    name: 'CatchBot',
    aliases: ['catch', 'catchbot'],
    rarities: [
      { key: 'legendary', label: '🟡 Legendary', name: 'Legendary', defaultPrice: 10000 },
      { key: 'mystical', label: '💮 Mystical', name: 'Mystical', defaultPrice: 100000 },
      { key: 'divine', label: '⚜️ Divine', name: 'Divine', defaultPrice: 300000 },
    ],
  },

  hallowbot: {
    key: 'hallowbot',
    name: 'HallowBot',
    aliases: ['hallow', 'hallowbot'],
    rarities: [
      { key: 'legendary', label: '🟡 Legendary', name: 'Legendary', defaultPrice: 10000 },
      { key: 'eldritch', label: '💮 Eldritch', name: 'Eldritch', defaultPrice: 100000 },
      { key: 'oblivion', label: '⚜️ Oblivion', name: 'Oblivion', defaultPrice: 300000 },
    ],
  },

  yelan: {
    key: 'yelan',
    name: 'Yelan Card',
    aliases: ['yelan', 'yelancard', 'yelan_card', 'yelan-card'],
    note: 'CatchBot & HallowBot Only',
    rarities: [
      { key: 'common', label: '🔵 Common', name: 'Common', defaultPrice: 5000 },
      { key: 'uncommon', label: '🟣 Uncommon', name: 'Uncommon', defaultPrice: 8000 },
      { key: 'rare', label: '🟠 Rare', name: 'Rare', defaultPrice: 10000 },
      { key: 'legendary', label: '🟡 Legendary', name: 'Legendary', defaultPrice: 30000 },
      { key: 'mystical', label: '💮 Mystical', name: 'Mystical', defaultPrice: 150000 },
      { key: 'divine', label: '⚜️ Divine', name: 'Divine', defaultPrice: 500000 },
      { key: 'crossverse', label: '⚡️ CrossVerse', name: 'CrossVerse', defaultPrice: 1000000 },
    ],
  },

  bikabot: {
    key: 'bikabot',
    name: 'BikaBot',
    aliases: ['bika', 'bikabot'],
    rarities: [
      { key: 'legendary', label: '🟡 Legendary', name: 'Legendary', defaultPrice: 10000 },
      { key: 'mystical', label: '💮 Mystical', name: 'Mystical', defaultPrice: 100000 },
      { key: 'divine', label: '⚜️ Divine', name: 'Divine', defaultPrice: 300000 },
    ],
  },
};

function normalize(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function getBotConfig(botKey) {
  return SELL_BOTS[String(botKey || '').toLowerCase()] || null;
}

function getRarityConfig(botKey, rarityKey) {
  const bot = getBotConfig(botKey);
  if (!bot) return null;
  return bot.rarities.find((item) => item.key === String(rarityKey || '').toLowerCase()) || null;
}

function resolveBotKey(input) {
  const value = normalize(input);
  if (!value) return null;

  for (const bot of Object.values(SELL_BOTS)) {
    if (normalize(bot.key) === value || normalize(bot.name) === value) return bot.key;
    if ((bot.aliases || []).some((alias) => normalize(alias) === value)) return bot.key;
  }

  return null;
}

function resolveRarityKey(botKey, input) {
  const bot = getBotConfig(botKey);
  if (!bot) return null;

  const value = normalize(input);
  if (!value) return null;

  const rarity = bot.rarities.find((item) => {
    return normalize(item.key) === value || normalize(item.name) === value || normalize(item.label) === value;
  });

  return rarity?.key || null;
}

function allBotKeys() {
  return Object.keys(SELL_BOTS);
}

module.exports = {
  SELL_BOTS,
  normalize,
  getBotConfig,
  getRarityConfig,
  resolveBotKey,
  resolveRarityKey,
  allBotKeys,
};
