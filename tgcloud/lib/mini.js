import { db, EndpointError } from 'sdk';
import { and, desc, eq, or } from 'sdk/db';
import { ensureEconomy, transferByWalletId, getUserByWalletId } from './economy.js';
import {
  ensurePreviewUser, userById, history, playSlot, playPlinko, wheelSpin, wheelDailyStatus,
  dailyWheel, crashStart, crashStatus, crashCashout, minesStart, minesStatus,
  minesOpen, minesCashout, blackjackJoin, blackjackStatus, blackjackAction,
  shanCreate, shanJoin, shanStatus, shanDeal,
} from './game.js';
import { listTopUsers } from './users.js';
import { transactions } from '../schema.js';
import { miniConfig } from './config.js';
import { getFeatureStatus } from './featureStatus.js';
import { assertGameEnabled } from './gameControls.js';
import { assertMaintenanceAccess } from './maintenance.js';

function requireVerifiedUser(ctx) {
  const telegramUser = ctx?.initData?.user;
  if (!telegramUser?.id) {
    throw new EndpointError('A verified Telegram Mini App user is required.', { code: 'AUTH_REQUIRED' });
  }
  return telegramUser;
}

function walletView(user) {
  const walletId = String(user.walletId || user.tgId);
  return {
    walletId,
    maskedWalletId: walletId.length > 4
      ? walletId.slice(0, 2) + '••••' + walletId.slice(-2)
      : walletId,
    balance: Number(user.balance || 0),
    username: user.username || null,
    firstName: user.firstName,
    lastName: user.lastName,
    photoUrl: user.photoUrl || null,
  };
}

export async function dispatch(action, input, ctx) {
  const telegramUser = requireVerifiedUser(ctx);
  const userId = Number(telegramUser.id);
  await assertMaintenanceAccess(userId);
  await ensureEconomy();
  await ensurePreviewUser(telegramUser);
  const body = input && typeof input === 'object' ? input : {};

  switch (action) {
    case 'features':
      return getFeatureStatus();

    case 'config':
      return miniConfig();

    case 'me': {
      const user = await userById(userId);
      return {
        ok: true,
        user: {
          id: user.tgId,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          languageCode: user.languageCode,
          balance: user.balance,
        },
        profile: {
          id: user.tgId,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          languageCode: user.languageCode,
        },
        wallet: {
          ...walletView(user),
          currency: '$',
          environment: 'serverless-v2',
        },
        productionDataImported: false,
      };
    }

    case 'wallet': {
      const user = await userById(userId);
      return { ok: true, wallet: walletView(user) };
    }

    case 'walletLookup': {
      const rawWalletId = String(body.walletId || '').trim();
      if (!rawWalletId || rawWalletId.length > 80) {
        throw new EndpointError('Wallet ID မမှန်ပါ။', { code: 'WALLET_INVALID' });
      }
      const target = /^\d+$/.test(rawWalletId)
        ? (await userById(Number(rawWalletId))) || await getUserByWalletId(rawWalletId)
        : await getUserByWalletId(rawWalletId);
      if (!target) throw new EndpointError('ဒီ Wallet ID ပိုင်ရှင်ကို မတွေ့ပါ။', { code: 'WALLET_NOT_FOUND' });
      return { ok: true, wallet: walletView(target) };
    }

    case 'walletTransfers': {
      const requestedLimit = Math.floor(Number(body.limit) || 50);
      const limit = Math.max(1, Math.min(100, requestedLimit));
      const rows = await db.select().from(transactions)
        .where(and(
          eq(transactions.type, 'gift'),
          or(
            eq(transactions.fromUserId, String(userId)),
            eq(transactions.toUserId, String(userId)),
          ),
        ))
        .orderBy(desc(transactions.createdAt))
        .limit(limit)
        .all();
      return {
        ok: true,
        items: rows.map((row) => {
          const sent = String(row.fromUserId) === String(userId);
          return {
            id: String(row.id),
            direction: sent ? 'sent' : 'received',
            amount: Number(row.amount || 0),
            otherUserId: sent ? row.toUserId : row.fromUserId,
            source: row.meta && typeof row.meta === 'object' ? row.meta.source || null : null,
            createdAt: row.createdAt,
          };
        }),
      };
    }

    // transferByWalletId creates one idempotent ledger row. SQLite validates
    // sender funds and recipient existence before the insert; after-insert
    // triggers move both balances in the same statement. Never split this into
    // independent user updates.
    case 'walletTransfer': {
      const amount = Number(body.amount);
      const transferId = String(body.transferId || body.requestId || body.idempotencyKey || '');
      if (!transferId) throw new EndpointError('Transfer ID မရှိပါ။', { code: 'TRANSFER_ID_REQUIRED' });
      const result = await transferByWalletId(userId, body.walletId, amount, { source: 'mini_wallet' }, 'wallet-transfer:' + userId + ':' + transferId);
      return { ok: true, amount: result.amount, sender: walletView(result.sender), recipient: walletView(result.recipient), duplicate: result.duplicate };
    }

    case 'history':
      return { ok: true, items: await history(userId, body.game || 'all', body.limit || 20) };

    case 'leaderboard':
      return { ok: true, items: await listTopUsers(body.limit || 10) };

    case 'slotSpin':
      await assertGameEnabled('slot');
      return playSlot(userId, body.bet, body.spinId || body.requestId);

    case 'plinkoDrop':
      return playPlinko(userId, body.bet, body.spinId || body.requestId);

    case 'wheelSpin':
      return wheelSpin(userId, body.bet, body.spinId || body.requestId);

    case 'wheelDailyStatus':
      return wheelDailyStatus(userId);

    case 'wheelDailySpin':
      return dailyWheel(userId);

    case 'crashStart':
    case 'crashBet':
      return crashStart(userId, body.bet, body.requestId);

    case 'crashStatus':
      return crashStatus(userId);

    case 'crashCashout':
      return crashCashout(userId);

    case 'minesStart':
      await assertGameEnabled('mines');
      return minesStart(userId, body.bet, body.requestId);

    case 'minesStatus':
      return minesStatus(userId);

    case 'minesOpen':
      return minesOpen(userId, body.index);

    case 'minesCashout':
      return minesCashout(userId);

    case 'blackjackStatus':
      return blackjackStatus(userId, body.roomId);

    case 'blackjackJoin':
      await assertGameEnabled('blackjack');
      return blackjackJoin(userId, body.roomId, body.bet, body.requestId);

    case 'blackjackHit':
      return blackjackAction(userId, body.roomId, 'hit');

    case 'blackjackStand':
      return blackjackAction(userId, body.roomId, 'stand');

    case 'shanCreate':
      await assertGameEnabled('shan');
      return shanCreate(userId, body.title, body.bankerStake, body.requestId);

    case 'shanStatus':
      return shanStatus(userId, body.roomId);

    case 'shanJoin':
      await assertGameEnabled('shan');
      return shanJoin(userId, body.roomId, body.bet, body.requestId);

    case 'shanDraw':
      return shanDeal(userId, body.roomId, 'draw');

    case 'shanStay':
      return shanDeal(userId, body.roomId, 'stay');

    case 'shanDeal':
      return shanDeal(userId, body.roomId, 'deal');

    case 'backgroundMusic':
      return { ok: true, enabled: false };

    default:
      throw new EndpointError('This Serverless feature is not available.', {
        code: 'NOT_PORTED',
        action,
      });
  }
}
