'use strict';

const { COIN, CRASH = {} } = require('../../config/constants');
const {
  getUser,
  userPayToTreasury,
  treasuryPayToUser,
} = require('../../services/economyService');
const { ensureTreasury, getTreasury, isOwner } = require('../../services/treasuryService');
const { getDb } = require('../../config/database');
const { replyHTML, editByIds, safeTelegram } = require('../../utils/telegram');
const { fmt, escHtml } = require('../../utils/format');
const { isGroupChat, mentionHtml, fullNameFromTg } = require('../../utils/helpers');

const sessions = new Map();

const CONFIG_KEY_APPROVED = 'crash_approved_users';
const BET_SECONDS = Math.max(5, Number(CRASH.betSeconds || process.env.CRASH_BET_TIME_SECONDS || 15));
const MIN_BET = Math.max(1, Number(CRASH.minBet || process.env.CRASH_MIN_BET || 50));
const MAX_BET = Math.max(MIN_BET, Number(CRASH.maxBet || process.env.CRASH_MAX_BET || 10000));
const EDIT_INTERVAL_MS = Math.max(700, Number(CRASH.editIntervalMs || process.env.CRASH_EDIT_INTERVAL_MS || 1000));
const NEXT_ROUND_DELAY_MS = Math.max(1500, Number(CRASH.nextRoundDelayMs || process.env.CRASH_NEXT_ROUND_DELAY_MS || 5000));
const MAX_PLAYERS = Math.max(2, Number(CRASH.maxPlayers || process.env.CRASH_MAX_PLAYERS || 150));
const HOUSE_EDGE = Math.max(0.05, Math.min(0.50, Number(CRASH.houseEdge ?? process.env.CRASH_HOUSE_EDGE ?? 0.24)));
const CAP_PERCENT = Math.max(0.03, Math.min(0.50, Number(CRASH.capPercent ?? process.env.CRASH_CAP_PERCENT ?? 0.12)));
const CRASH_MAX_MULTIPLIER = Math.max(1.2, Math.min(20, Number(CRASH.maxMultiplier || process.env.CRASH_MAX_MULTIPLIER || 6)));
const PAYOUT_MAX_MULTIPLIER = Math.max(1, Math.min(CRASH_MAX_MULTIPLIER, Number(CRASH.maxPayoutMultiplier || process.env.CRASH_MAX_PAYOUT_MULTIPLIER || 4)));
const INSTANT_CRASH_PERCENT = Math.max(0, Math.min(40, Number(CRASH.instantCrashPercent || process.env.CRASH_INSTANT_PERCENT || 18)));
const ALL_CASHOUT_HYPE_MIN = Math.max(8, Number(CRASH.allCashoutHypeMin || process.env.CRASH_ALL_CASHOUT_HYPE_MIN || 25));
const ALL_CASHOUT_HYPE_MAX = Math.max(ALL_CASHOUT_HYPE_MIN, Number(CRASH.allCashoutHypeMax || process.env.CRASH_ALL_CASHOUT_HYPE_MAX || 250));
const DISPLAY_PLAYER_LIMIT = Math.max(5, Number(CRASH.displayPlayerLimit || process.env.CRASH_DISPLAY_PLAYER_LIMIT || 15));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowId(prefix = 'cr') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function replyOptions(ctx) {
  const messageId = ctx.message?.message_id;
  return messageId ? { reply_to_message_id: messageId, allow_sending_without_reply: true } : {};
}

function clampMoney(value) {
  const n = Number(String(value || '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? Math.floor(n) : NaN;
}

function round2(value) {
  return Math.max(1, Math.floor(Number(value || 1) * 100) / 100);
}

function multiplierText(value) {
  return `x${round2(value).toFixed(2)}`;
}

function playerName(tg) {
  return escHtml(fullNameFromTg(tg));
}

function configCollection() {
  return getDb().collection('config');
}

async function getApprovedDoc() {
  return configCollection().findOne({ key: CONFIG_KEY_APPROVED });
}

async function isCrashManager(ctx) {
  const treasury = await ensureTreasury();
  if (isOwner(ctx, treasury)) return true;

  const doc = await getApprovedDoc();
  const userId = String(ctx.from?.id || '');
  return !!doc?.users?.[userId]?.approved;
}

async function approveCrashUser(user, approvedBy) {
  const userId = Number(user?.id);
  if (!Number.isFinite(userId) || userId <= 0) throw new Error('INVALID_USER');

  await configCollection().updateOne(
    { key: CONFIG_KEY_APPROVED },
    {
      $set: {
        key: CONFIG_KEY_APPROVED,
        [`users.${userId}`]: {
          approved: true,
          userId,
          username: user?.username ? String(user.username).toLowerCase() : null,
          firstName: user?.first_name || null,
          lastName: user?.last_name || null,
          approvedBy: approvedBy || null,
          approvedAt: new Date(),
        },
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  return userId;
}

async function revokeCrashUser(user, revokedBy) {
  const userId = Number(user?.id);
  if (!Number.isFinite(userId) || userId <= 0) throw new Error('INVALID_USER');

  await configCollection().updateOne(
    { key: CONFIG_KEY_APPROVED },
    {
      $set: {
        [`users.${userId}.approved`]: false,
        [`users.${userId}.revokedBy`]: revokedBy || null,
        [`users.${userId}.revokedAt`]: new Date(),
        updatedAt: new Date(),
      },
      $setOnInsert: { key: CONFIG_KEY_APPROVED, createdAt: new Date() },
    },
    { upsert: true }
  );

  return userId;
}

function getSession(chatId) {
  return sessions.get(String(chatId));
}

function setSession(chatId, session) {
  sessions.set(String(chatId), session);
}

function clearSession(chatId) {
  sessions.delete(String(chatId));
}

async function pinMessage(bot, chatId, messageId) {
  if (!messageId) return false;
  try {
    await safeTelegram(() => bot.telegram.pinChatMessage(chatId, messageId, { disable_notification: true }), { maxRetries: 2 });
    return true;
  } catch (err) {
    console.warn('CRASH_PIN_FAILED:', err?.message || err);
    return false;
  }
}

async function unpinMessage(bot, chatId, messageId) {
  if (!messageId) return false;
  try {
    await safeTelegram(() => bot.telegram.unpinChatMessage(chatId, messageId), { maxRetries: 2 });
    return true;
  } catch (_) {
    return false;
  }
}

function activePlayers(round) {
  return [...round.players.values()].filter((player) => !player.cashedOut);
}

function totalBet(round) {
  let total = 0;
  for (const player of round.players.values()) total += Number(player.bet || 0);
  return total;
}

function totalPaid(round) {
  let total = 0;
  for (const player of round.players.values()) total += Number(player.payout || 0);
  return total;
}

function cashoutCount(round) {
  let count = 0;
  for (const player of round.players.values()) if (player.cashedOut) count += 1;
  return count;
}

function allPlayersCashedOut(round) {
  return round.players.size > 0 && cashoutCount(round) >= round.players.size;
}

function generateCrashPoint(round, treasuryBalance = 0) {
  const betTotal = totalBet(round);
  const playerCount = round.players.size;

  if (Math.random() * 100 < INSTANT_CRASH_PERCENT) {
    return round2(1 + Math.random() * 0.18);
  }

  const r = Math.max(0.0001, Math.min(0.9999, Math.random()));
  let point = (1 - HOUSE_EDGE) / (1 - r);

  // Damping makes the game harder than a raw crash curve.
  point *= 0.68 + Math.random() * 0.20;

  if (playerCount >= 8) point *= 0.88;
  else if (playerCount >= 4) point *= 0.94;

  if (betTotal >= MAX_BET * 8) point *= 0.76;
  else if (betTotal >= MAX_BET * 4) point *= 0.84;
  else if (betTotal >= MAX_BET * 2) point *= 0.92;

  if (treasuryBalance > 0) {
    const possibleMaxPayout = betTotal * PAYOUT_MAX_MULTIPLIER;
    const treasuryRiskLimit = Math.max(MAX_BET, treasuryBalance * CAP_PERCENT);

    if (possibleMaxPayout > treasuryRiskLimit) {
      point *= Math.max(0.60, treasuryRiskLimit / possibleMaxPayout);
    }
  }

  point = Math.min(point, CRASH_MAX_MULTIPLIER);
  point = Math.max(point, 1.01);

  return round2(point);
}

function generateHypeTarget() {
  const min = ALL_CASHOUT_HYPE_MIN;
  const max = ALL_CASHOUT_HYPE_MAX;
  const curved = Math.pow(Math.random(), 1.8);
  return round2(min + curved * (max - min));
}

function nextMultiplier(current, target, hypeMode = false) {
  const c = Math.max(1, Number(current || 1));
  let next;

  if (hypeMode) {
    if (c < 5) next = c + 0.7 + Math.random() * 1.4;
    else if (c < 20) next = c + 2 + Math.random() * 5;
    else if (c < 80) next = c + 7 + Math.random() * 16;
    else next = c + 18 + Math.random() * 45;
  } else {
    const growth = c < 1.6 ? 0.085 : c < 2.5 ? 0.105 : 0.13;
    next = c * (1 + growth) + 0.01;
  }

  if (next >= target) return round2(target);
  return round2(next);
}

async function capPayout(player, rawPayout) {
  const treasury = await getTreasury();
  const ownerBalance = Math.max(0, Number(treasury?.ownerBalance || 0));
  const maxByPercent = Math.floor(ownerBalance * CAP_PERCENT);
  const maxByBet = Math.floor(Number(player.bet || 0) * PAYOUT_MAX_MULTIPLIER);
  const hardMax = Math.max(Number(player.bet || 0), Math.min(ownerBalance, maxByPercent > 0 ? maxByPercent : ownerBalance, maxByBet));
  return Math.max(0, Math.min(Math.floor(Number(rawPayout) || 0), hardMax));
}

function bettingText(session, round, secondsLeft = BET_SECONDS) {
  return (
    `🚀 <b>BIKA Multiplayer Crash</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Round: <b>#${round.no}</b>\n` +
    `Bet Time: <b>${secondsLeft}s</b>\n` +
    `Bet Range: <b>${fmt(MIN_BET)}</b> - <b>${fmt(MAX_BET)}</b> ${COIN}\n` +
    `Players: <b>${fmt(round.players.size)}</b>\n` +
    `Total Bet: <b>${fmt(totalBet(round))}</b> ${COIN}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `ဝင်လောင်းရန်: <code>.bet 1000</code>\n` +
    `Cash Out: <code>.co</code> or <code>.crashout</code>\n\n` +
    `<i>.endcrash ပို့မှ crash auto loop ရပ်ပါမယ်။</i>`
  );
}

function closedText(round) {
  return (
    `🔒 <b>လောင်းကြေး ပိတ်လိုက်ပါပြီ။</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Round: <b>#${round.no}</b>\n` +
    `Players: <b>${fmt(round.players.size)}</b>\n` +
    `Total Bet: <b>${fmt(totalBet(round))}</b> ${COIN}\n` +
    `Crash စတင်ပါမယ်...`
  );
}

function playerLines(round, final = false) {
  const players = [...round.players.values()];
  if (!players.length) return 'Players: <b>0</b>';

  const lines = players.slice(0, DISPLAY_PLAYER_LIMIT).map((player, index) => {
    const prefix = `${index + 1}. ${mentionHtml(player.tg)}`;
    if (player.cashedOut) {
      return `${prefix} — ✅ ${fmt(player.bet)} → <b>${fmt(player.payout)}</b> ${COIN} (${multiplierText(player.cashoutMultiplier)})`;
    }
    if (final) {
      return `${prefix} — 💥 Lost <b>${fmt(player.bet)}</b> ${COIN}`;
    }
    return `${prefix} — ⏳ Bet <b>${fmt(player.bet)}</b> ${COIN}`;
  });

  if (players.length > DISPLAY_PLAYER_LIMIT) {
    lines.push(`...and ${players.length - DISPLAY_PLAYER_LIMIT} more`);
  }

  return lines.join('\n');
}

function runningText(round, note = '') {
  const left = activePlayers(round).length;
  const cashed = cashoutCount(round);
  const hype = round.hypeMode ? '\n🚀 <b>All players cashed out — multiplier keeps flying!</b>' : '';

  return (
    `🚀 <b>BIKA Crash Running</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Round: <b>#${round.no}</b>\n` +
    `Multiplier: <b>${multiplierText(round.currentMultiplier)}</b>\n` +
    `Players: <b>${fmt(round.players.size)}</b> | Cash Out: <b>${fmt(cashed)}</b> | Left: <b>${fmt(left)}</b>\n` +
    `Total Bet: <b>${fmt(totalBet(round))}</b> ${COIN}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `${playerLines(round)}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `ထုတ်ရန်: <code>.co</code> or <code>.crashout</code>` +
    `${hype}${note ? `\n${note}` : ''}`
  );
}

function finalText(round) {
  const paid = totalPaid(round);
  const lostPlayers = activePlayers(round).length;
  const cashed = cashoutCount(round);
  const ownerNet = totalBet(round) - paid;

  return (
    `💥 <b>CRASHED!</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Round: <b>#${round.no}</b>\n` +
    `Crash Point: <b>${multiplierText(round.currentMultiplier)}</b>\n` +
    `Players: <b>${fmt(round.players.size)}</b>\n` +
    `Cash Out: <b>${fmt(cashed)}</b> | Lost: <b>${fmt(lostPlayers)}</b>\n` +
    `Total Bet: <b>${fmt(totalBet(round))}</b> ${COIN}\n` +
    `Total Paid: <b>${fmt(paid)}</b> ${COIN}\n` +
    `House Net: <b>${fmt(ownerNet)}</b> ${COIN}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `${playerLines(round, true)}`
  );
}

async function refundRound(bot, session, round, reason = 'crash_stop_refund') {
  const refunds = [];

  for (const player of round.players.values()) {
    if (player.cashedOut) continue;
    try {
      await treasuryPayToUser(player.userId, player.bet, {
        type: 'crash_refund',
        roundId: round.id,
        bet: player.bet,
        reason,
      });
      player.cashedOut = true;
      player.payout = player.bet;
      player.cashoutMultiplier = 1;
      refunds.push(player.userId);
    } catch (_) {}
  }

  if (round.betMessageId) await unpinMessage(bot, session.chatId, round.betMessageId);
  if (round.crashMessageId) await unpinMessage(bot, session.chatId, round.crashMessageId);

  return refunds.length;
}

async function settleCashout(bot, session, round, player, reason = 'cashout') {
  const effectiveMultiplier = Math.min(round.currentMultiplier, PAYOUT_MAX_MULTIPLIER);
  const rawPayout = Math.floor(player.bet * effectiveMultiplier);
  const payout = await capPayout(player, rawPayout);

  await treasuryPayToUser(player.userId, payout, {
    type: 'crash_win',
    roundId: round.id,
    bet: player.bet,
    payout,
    rawPayout,
    multiplier: effectiveMultiplier,
    shownMultiplier: round.currentMultiplier,
    reason,
  });

  player.cashedOut = true;
  player.cashoutMultiplier = effectiveMultiplier;
  player.payout = payout;
  player.cashedOutAt = new Date();

  if (allPlayersCashedOut(round) && !round.hypeMode) {
    round.hypeMode = true;
    round.hypeTarget = generateHypeTarget();
  }

  return { payout, effectiveMultiplier, rawPayout };
}

async function finishRound(bot, session, round) {
  round.state = 'ended';
  round.crashed = true;

  await editByIds(bot, session.chatId, round.crashMessageId, finalText(round));
  await unpinMessage(bot, session.chatId, round.crashMessageId);

  session.round = null;
  session.state = session.stopping ? 'stopped' : 'idle';

  if (session.stopping || !session.active) {
    clearSession(session.chatId);
    await safeTelegram(() => bot.telegram.sendMessage(session.chatId, '🛑 <b>Crash Game stopped.</b>', { parse_mode: 'HTML' }), { maxRetries: 2 }).catch(() => {});
    return;
  }

  await sleep(NEXT_ROUND_DELAY_MS);
  startBetRound(bot, session).catch((err) => console.error('CRASH_NEXT_ROUND_FAILED:', err?.stack || err));
}

async function runCrashRound(bot, session, round) {
  const treasury = await getTreasury();
  round.crashPoint = generateCrashPoint(round, Number(treasury?.ownerBalance || 0));
  round.currentMultiplier = 1;
  round.state = 'running';
  session.state = 'running';

  const sent = await safeTelegram(() => bot.telegram.sendMessage(session.chatId, runningText(round, '🚀 Crash စတင်ပါပြီ!'), {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  }), { maxRetries: 3 });

  round.crashMessageId = sent?.message_id || null;
  session.lastCrashMessageId = round.crashMessageId;
  await pinMessage(bot, session.chatId, round.crashMessageId);

  while (session.active && session.round === round && !round.crashed) {
    await sleep(EDIT_INTERVAL_MS);

    const hypeMode = round.hypeMode && allPlayersCashedOut(round);
    const target = hypeMode ? round.hypeTarget : round.crashPoint;
    round.currentMultiplier = nextMultiplier(round.currentMultiplier, target, hypeMode);

    if (round.currentMultiplier >= target) {
      break;
    }

    await editByIds(bot, session.chatId, round.crashMessageId, runningText(round));
  }

  if (!session.active && !session.stopping) return;

  const target = round.hypeMode && allPlayersCashedOut(round) ? round.hypeTarget : round.crashPoint;
  round.currentMultiplier = round2(target || round.currentMultiplier);
  await finishRound(bot, session, round);
}

async function startBetRound(bot, session) {
  if (!session.active || session.stopping) return;

  session.roundNo += 1;
  const round = {
    id: nowId('cr'),
    no: session.roundNo,
    chatId: session.chatId,
    state: 'betting',
    players: new Map(),
    pendingBets: new Set(),
    betMessageId: null,
    crashMessageId: null,
    currentMultiplier: 1,
    crashPoint: null,
    hypeMode: false,
    hypeTarget: null,
    crashed: false,
    createdAt: new Date(),
  };

  session.round = round;
  session.state = 'betting';

  const sent = await safeTelegram(() => bot.telegram.sendMessage(session.chatId, bettingText(session, round, BET_SECONDS), {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  }), { maxRetries: 3 });

  round.betMessageId = sent?.message_id || null;
  session.lastBetMessageId = round.betMessageId;
  await pinMessage(bot, session.chatId, round.betMessageId);

  let remaining = BET_SECONDS;
  while (remaining > 0 && session.active && session.round === round && round.state === 'betting') {
    const step = Math.min(5, remaining);
    await sleep(step * 1000);
    remaining -= step;

    if (remaining > 0 && session.active && session.round === round && round.state === 'betting') {
      await editByIds(bot, session.chatId, round.betMessageId, bettingText(session, round, remaining));
    }
  }

  if (!session.active || session.round !== round || round.state !== 'betting') return;

  round.state = 'closed';
  session.state = 'closed';
  await editByIds(bot, session.chatId, round.betMessageId, closedText(round));
  await unpinMessage(bot, session.chatId, round.betMessageId);

  if (!round.players.size) {
    await safeTelegram(() => bot.telegram.sendMessage(session.chatId, 'ℹ️ ဒီ round မှာ bet ဝင်သူမရှိပါ။ နောက် round ပြန်စပါမယ်။'), { maxRetries: 2 }).catch(() => {});
    session.round = null;
    session.state = 'idle';

    if (session.stopping || !session.active) {
      clearSession(session.chatId);
      return;
    }

    await sleep(NEXT_ROUND_DELAY_MS);
    return startBetRound(bot, session);
  }

  return runCrashRound(bot, session, round);
}

async function startCrashSession(ctx, bot) {
  if (!isGroupChat(ctx)) {
    return replyHTML(ctx, 'ℹ️ <code>.startcrash</code> ကို group ထဲမှာပဲ သုံးနိုင်ပါတယ်။', replyOptions(ctx));
  }

  if (!(await isCrashManager(ctx))) {
    return replyHTML(ctx, '⛔ Crash game စတင်ခွင့်မရှိပါ။ Owner က reply ထောက်ပြီး <code>/approvecrash</code> ပေးထားမှ သုံးနိုင်ပါတယ်။', replyOptions(ctx));
  }

  const chatId = ctx.chat.id;
  const existing = getSession(chatId);
  if (existing?.active) {
    return replyHTML(ctx, '🚀 Crash game က ဒီ group မှာ run နေပြီးသားပါ။ ရပ်ချင်ရင် <code>.endcrash</code> ပို့ပါ။', replyOptions(ctx));
  }

  const session = {
    chatId,
    active: true,
    stopping: false,
    state: 'idle',
    round: null,
    roundNo: 0,
    startedBy: ctx.from?.id || null,
    startedAt: new Date(),
    lastBetMessageId: null,
    lastCrashMessageId: null,
  };

  setSession(chatId, session);

  await replyHTML(
    ctx,
    `✅ <b>Multiplayer Crash Started</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `Bet Time: <b>${BET_SECONDS}s</b>\n` +
      `Bet Range: <b>${fmt(MIN_BET)}</b> - <b>${fmt(MAX_BET)}</b> ${COIN}\n` +
      `Stop: <code>.endcrash</code>`,
    replyOptions(ctx)
  );

  session.loopPromise = startBetRound(bot, session).catch(async (err) => {
    console.error('CRASH_LOOP_ERROR:', err?.stack || err?.message || err);
    clearSession(chatId);
    await safeTelegram(() => bot.telegram.sendMessage(chatId, '⚠️ Crash loop error ဖြစ်လို့ game ရပ်သွားပါတယ်။', { parse_mode: 'HTML' }), { maxRetries: 2 }).catch(() => {});
  });

  return null;
}

async function endCrashSession(ctx, bot) {
  if (!isGroupChat(ctx)) {
    return replyHTML(ctx, 'ℹ️ <code>.endcrash</code> ကို group ထဲမှာပဲ သုံးနိုင်ပါတယ်။', replyOptions(ctx));
  }

  if (!(await isCrashManager(ctx))) {
    return replyHTML(ctx, '⛔ Crash game ရပ်ခွင့်မရှိပါ။', replyOptions(ctx));
  }

  const session = getSession(ctx.chat.id);
  if (!session?.active) {
    return replyHTML(ctx, 'ℹ️ ဒီ group မှာ Crash game run မနေပါ။', replyOptions(ctx));
  }

  session.stopping = true;
  session.active = false;

  const round = session.round;
  if (round?.state === 'betting' || round?.state === 'closed') {
    const refunded = await refundRound(bot, session, round, 'crash_manual_stop');
    clearSession(ctx.chat.id);
    return replyHTML(
      ctx,
      `🛑 <b>Crash Game stopped.</b>\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `Current betting round cancelled.\n` +
        `Refunded Players: <b>${fmt(refunded)}</b>`,
      replyOptions(ctx)
    );
  }

  if (round?.state === 'running') {
    session.active = true;
    return replyHTML(ctx, '🛑 <b>Crash auto loop will stop after this round.</b>', replyOptions(ctx));
  }

  clearSession(ctx.chat.id);
  return replyHTML(ctx, '🛑 <b>Crash Game stopped.</b>', replyOptions(ctx));
}

async function handleBet(ctx, bot) {
  if (!isGroupChat(ctx)) return;

  const match = String(ctx.message?.text || '').trim().match(/^(?:\.bet|\/bet)(?:@\w+)?\s+(\d[\d,]*)\s*$/i);
  if (!match) return;

  const session = getSession(ctx.chat.id);
  const round = session?.round;
  const userId = ctx.from?.id;
  const amount = clampMoney(match[1]);

  if (!session?.active || !round || round.state !== 'betting') {
    return replyHTML(ctx, '⏳ အခု bet time မဟုတ်ပါ။ နောက် round 15s bet time စတဲ့အခါ <code>.bet amount</code> ပို့ပါ။', replyOptions(ctx));
  }

  if (!Number.isInteger(amount) || amount < MIN_BET || amount > MAX_BET) {
    return replyHTML(ctx, `⚠️ Bet amount ကို <b>${fmt(MIN_BET)}</b> - <b>${fmt(MAX_BET)}</b> ${COIN} ကြားထားပါ။`, replyOptions(ctx));
  }

  if (round.players.has(userId) || round.pendingBets.has(userId)) {
    const old = round.players.get(userId);
    return replyHTML(ctx, `ℹ️ ${mentionHtml(ctx.from)} ဒီ Round မှာပါဝင်ပြီးသားပါ။\nBet: <b>${fmt(old?.bet || amount)}</b> ${COIN}`, replyOptions(ctx));
  }

  if (round.players.size >= MAX_PLAYERS) {
    return replyHTML(ctx, '⛔ ဒီ Crash round မှာ player ပြည့်သွားပါပြီ။', replyOptions(ctx));
  }

  round.pendingBets.add(userId);

  try {
    const user = await getUser(userId);
    if (Number(user?.balance || 0) < amount) {
      return replyHTML(ctx, '❌ Balance မလုံလောက်ပါ။', replyOptions(ctx));
    }

    await userPayToTreasury(userId, amount, {
      type: 'crash_bet',
      roundId: round.id,
      roundNo: round.no,
      chatId: ctx.chat.id,
    });

    round.players.set(userId, {
      userId,
      tg: ctx.from,
      bet: amount,
      cashedOut: false,
      cashingOut: false,
      payout: 0,
      cashoutMultiplier: 0,
      joinedAt: new Date(),
    });

    await editByIds(bot, ctx.chat.id, round.betMessageId, bettingText(session, round)).catch(() => {});

    return replyHTML(
      ctx,
      `✅ ${mentionHtml(ctx.from)} ဒီ Round မှာပါဝင်ပြီးပါပြီ။\nBet: <b>${fmt(amount)}</b> ${COIN}`,
      replyOptions(ctx)
    );
  } catch (err) {
    const reason = String(err?.message || err);
    return replyHTML(
      ctx,
      reason.includes('USER_INSUFFICIENT') ? '❌ Balance မလုံလောက်ပါ။' : `⚠️ Bet error: <code>${escHtml(reason)}</code>`,
      replyOptions(ctx)
    );
  } finally {
    round.pendingBets.delete(userId);
  }
}

async function handleCashout(ctx, bot) {
  if (!isGroupChat(ctx)) return;

  const session = getSession(ctx.chat.id);
  const round = session?.round;
  const userId = ctx.from?.id;

  if (!session?.active || !round || round.state !== 'running') {
    return replyHTML(ctx, '⏳ အခု Cash Out လုပ်လို့မရသေးပါ။ Crash running ဖြစ်မှ <code>.co</code> ပို့ပါ။', replyOptions(ctx));
  }

  const player = round.players.get(userId);
  if (!player) {
    return replyHTML(ctx, 'ℹ️ သင် ဒီ Crash round မှာ bet မဝင်ထားပါ။', replyOptions(ctx));
  }

  if (player.cashedOut) {
    return replyHTML(ctx, `✅ Cash Out လုပ်ပြီးသားပါ။\nPayout: <b>${fmt(player.payout)}</b> ${COIN}`, replyOptions(ctx));
  }

  if (player.cashingOut) {
    return replyHTML(ctx, '⏳ Cash Out processing... ခဏစောင့်ပါ။', replyOptions(ctx));
  }

  if (round.currentMultiplier >= round.crashPoint && !round.hypeMode) {
    return replyHTML(ctx, '💥 Crash ဖြစ်သွားပြီးပါပြီ။', replyOptions(ctx));
  }

  player.cashingOut = true;

  try {
    const result = await settleCashout(bot, session, round, player, 'manual_cashout');

    await editByIds(bot, ctx.chat.id, round.crashMessageId, runningText(round)).catch(() => {});

    return replyHTML(
      ctx,
      `🎉 <b>Congratulations</b>\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `Player: ${mentionHtml(ctx.from)}\n` +
        `Bet: <b>${fmt(player.bet)}</b> ${COIN}\n` +
        `Multiplier: <b>${multiplierText(result.effectiveMultiplier)}</b>\n` +
        `Payout: <b>${fmt(result.payout)}</b> ${COIN}`,
      replyOptions(ctx)
    );
  } catch (err) {
    const reason = String(err?.message || err);
    return replyHTML(ctx, `⚠️ Cash Out error: <code>${escHtml(reason)}</code>`, replyOptions(ctx));
  } finally {
    player.cashingOut = false;
  }
}

module.exports = (bot) => {
  bot.command('approvecrash', async (ctx) => {
    const treasury = await ensureTreasury();
    if (!isOwner(ctx, treasury)) {
      return replyHTML(ctx, '⛔ Owner only.', replyOptions(ctx));
    }

    const target = ctx.message?.reply_to_message?.from;
    if (!target?.id) {
      return replyHTML(ctx, 'Usage: user ကို reply ထောက်ပြီး <code>/approvecrash</code> ပို့ပါ။', replyOptions(ctx));
    }

    await approveCrashUser(target, ctx.from?.id);
    return replyHTML(ctx, `✅ ${mentionHtml(target)} ကို Crash start/end permission ပေးပြီးပါပြီ။`, replyOptions(ctx));
  });

  bot.command('unapprovecrash', async (ctx) => {
    const treasury = await ensureTreasury();
    if (!isOwner(ctx, treasury)) {
      return replyHTML(ctx, '⛔ Owner only.', replyOptions(ctx));
    }

    const target = ctx.message?.reply_to_message?.from;
    if (!target?.id) {
      return replyHTML(ctx, 'Usage: user ကို reply ထောက်ပြီး <code>/unapprovecrash</code> ပို့ပါ။', replyOptions(ctx));
    }

    await revokeCrashUser(target, ctx.from?.id);
    return replyHTML(ctx, `✅ ${mentionHtml(target)} ရဲ့ Crash permission ကိုဖြုတ်ပြီးပါပြီ။`, replyOptions(ctx));
  });

  bot.hears(/^\.startcrash\s*$/i, (ctx) => startCrashSession(ctx, bot));
  bot.hears(/^\.endcrash\s*$/i, (ctx) => endCrashSession(ctx, bot));

  bot.hears(/^(?:\.bet|\/bet)(?:@\w+)?\s+\d[\d,]*\s*$/i, (ctx) => handleBet(ctx, bot));

  bot.hears(/^(?:\.co|\.crashout|\/co|\/crashout)(?:@\w+)?\s*$/i, (ctx) => handleCashout(ctx, bot));
};

module.exports._private = {
  generateCrashPoint,
  nextMultiplier,
  round2,
};
