const { toNum, fmt } = require('../../utils/format');

// Slot symbols and payouts. For simplicity we define a fixed payout table.
const SYMBOLS = ['⭐', '7', 'BAR', '🍒', '🍋'];
const PAYOUTS = {
  '⭐⭐⭐': 20,
  '777': 15,
  'BARBARBAR': 10,
};

function spinReel() {
  // Weighted random: stars rarer
  const weights = { '⭐': 1, '7': 2, BAR: 3, '🍒': 4, '🍋': 4 };
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const rand = Math.random() * total;
  let sum = 0;
  for (const [symbol, w] of Object.entries(weights)) {
    sum += w;
    if (rand <= sum) return symbol;
  }
  return '🍋';
}

function evaluate(reels) {
  const key = reels.join('');
  if (PAYOUTS[key]) return PAYOUTS[key];
  // Two of a kind pays 1.5x
  const [a, b, c] = reels;
  if (a === b || b === c || a === c) return 1.5;
  return 0;
}

module.exports = function registerSlot(bot, { userService }, config) {
  bot.command('slot', async (ctx) => {
    const args = ctx.message.text.trim().split(/\s+/);
    const amount = toNum(args[1]);
    const bet = amount || 0;
    if (bet <= 0) return ctx.reply('Usage: /slot <bet>');
    if (bet < 100) return ctx.reply('Minimum bet is 100.');
    const user = await userService.getUserById(ctx.from.id);
    if (!user || user.balance < bet) return ctx.reply('Insufficient balance.');
    // Deduct bet
    await userService.subtractBalance(ctx.from.id, bet);
    // Spin
    const reels = [spinReel(), spinReel(), spinReel()];
    const multiplier = evaluate(reels);
    let payout = 0;
    if (multiplier > 0) {
      payout = Math.floor(bet * multiplier);
      await userService.addBalance(ctx.from.id, payout);
    }
    const resultText = reels.join(' | ');
    if (payout > 0) {
      await ctx.reply(`${resultText}\nYou won ${fmt(payout)} ${config.coin}!`);
    } else {
      await ctx.reply(`${resultText}\nYou lost ${fmt(bet)} ${config.coin}.`);
    }
  });
};