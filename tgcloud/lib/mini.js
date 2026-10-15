import { db, EndpointError } from 'sdk';
import { and, desc, eq, or } from 'sdk/db';
import {
  ensurePreviewUser, userById, history, playSlot, playPlinko, wheelSpin,
  dailyWheel, crashStart, crashStatus, crashCashout, minesStart, minesStatus,
  minesOpen, minesCashout, blackjackJoin, blackjackStatus, blackjackAction,
  shanCreate, shanJoin, shanStatus, shanDeal,
} from './game.js';
import { listTopUsers } from './users.js';
import { transactions } from '../schema.js';
import { miniConfig } from './config.js';

function requireVerifiedUser(ctx) {
  const telegramUser = ctx?.initData?.user;
  if (!telegramUser?.id) {
    throw new EndpointError('A verified Telegram Mini App user is required.', { code: 'AUTH_REQUIRED' });
  }
  return telegramUser;
}

function walletView(user) {
  const walletId = String(user.tgId);
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
  await ensurePreviewUser(telegramUser);
  const body = input && typeof input === 'object' ? input : {};

  switch (action) {
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
          environment: 'serverless-preview',
        },
        productionDataImported: false,
      };
    }

    case 'wallet': {
      const user = await userById(userId);
      return { ok: true, wallet: walletView(user) };
    }

    case 'walletLookup': {
      const targetId = Number(String(body.walletId || ''));
      if (!Number.isSafeInteger(targetId) || targetId <= 0) {
        throw new EndpointError('Wallet ID မမှန်ပါ။', { code: 'WALLET_INVALID' });
      }
      const target = await userById(targetId);
      if (!target) {
        throw new EndpointError('ဒီ Wallet ID ပိုင်ရှင်ကို မတွေ့ပါ။', { code: 'WALLET_NOT_FOUND' });
      }
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

    // Keep preview transfers disabled until the platform exposes a supported
    // atomic settlement primitive. Two independent balance writes can partially
    // succeed, even in an isolated preview database.
    case 'walletTransfer':
      throw new EndpointError(
        'Wallet transfers are disabled in this preview until atomic balance and ledger settlement is implemented.',
        { code: 'PREVIEW_TRANSFER_DISABLED' },
      );

    case 'history':
      return { ok: true, items: await history(userId, body.game || 'all', body.limit || 20) };

    case 'leaderboard':
      return { ok: true, items: await listTopUsers(body.limit || 10) };

    case 'slotSpin':
      return playSlot(userId, body.bet);

    case 'plinkoDrop':
      return playPlinko(userId, body.bet);

    case 'wheelSpin':
      return wheelSpin(userId, body.bet);

    case 'wheelDailyStatus': {
      const user = await userById(userId);
      const today = new Date().toISOString().slice(0, 10);
      const lastClaim = user.dailyClaimedAt
        ? new Date(user.dailyClaimedAt).toISOString().slice(0, 10)
        : '';
      return {
        ok: true,
        available: today !== lastClaim,
        claimed: today === lastClaim,
        date: today,
        baseReward: 100,
      };
    }

    case 'wheelDailySpin':
      return dailyWheel(userId);

    case 'crashStart':
    case 'crashBet':
      return crashStart(userId, body.bet);

    case 'crashStatus':
      return crashStatus(userId);

    case 'crashCashout':
      return crashCashout(userId);

    case 'minesStart':
      return minesStart(userId, body.bet);

    case 'minesStatus':
      return minesStatus(userId);

    case 'minesOpen':
      return minesOpen(userId, body.index);

    case 'minesCashout':
      return minesCashout(userId);

    case 'blackjackStatus':
      return blackjackStatus(userId, body.roomId);

    case 'blackjackJoin':
      return blackjackJoin(userId, body.roomId, body.bet);

    case 'blackjackHit':
      return blackjackAction(userId, body.roomId, 'hit');

    case 'blackjackStand':
      return blackjackAction(userId, body.roomId, 'stand');

    case 'shanCreate':
      return shanCreate(userId, body.title);

    case 'shanStatus':
      return shanStatus(userId, body.roomId);

    case 'shanJoin':
      return shanJoin(userId, body.roomId, body.bet);

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
