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
import { getFeatureStatus } from './featureStatus.js';

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

    case 'walletTransfers':
      throw new EndpointError('Transfer history is unavailable until ledger settlement is verified.', { code: 'ATOMIC_SETTLEMENT_UNAVAILABLE' });

    // The current Serverless SDK contract has no verified transactional
    // settlement primitive. Keep any balance-moving call disabled until a
    // single-operation atomic balance + ledger settlement is tested.
    case 'walletTransfer':
      throw new EndpointError(
        'Wallet transfers are disabled until atomic balance and ledger settlement is verified.',
        { code: 'ATOMIC_SETTLEMENT_UNAVAILABLE' },
      );

    case 'history':
      return { ok: true, items: await history(userId, body.game || 'all', body.limit || 20) };

    case 'leaderboard':
      return { ok: true, items: await listTopUsers(body.limit || 10) };

    case 'slotSpin':
      throw new EndpointError('This balance-moving game is disabled until atomic settlement is verified.', { code: 'ATOMIC_SETTLEMENT_UNAVAILABLE' });

    case 'plinkoDrop':
      throw new EndpointError('This balance-moving game is disabled until atomic settlement is verified.', { code: 'ATOMIC_SETTLEMENT_UNAVAILABLE' });

    case 'wheelSpin':
      throw new EndpointError('This balance-moving game is disabled until atomic settlement is verified.', { code: 'ATOMIC_SETTLEMENT_UNAVAILABLE' });

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
      throw new EndpointError('This balance-moving game is disabled until atomic settlement is verified.', { code: 'ATOMIC_SETTLEMENT_UNAVAILABLE' });

    case 'crashStart':
    case 'crashBet':
      throw new EndpointError('This balance-moving game is disabled until atomic settlement is verified.', { code: 'ATOMIC_SETTLEMENT_UNAVAILABLE' });

    case 'crashStatus':
      throw new EndpointError('Active game sessions are disabled until settlement is verified.', { code: 'ATOMIC_SETTLEMENT_UNAVAILABLE' });

    case 'crashCashout':
      throw new EndpointError('This balance-moving game is disabled until atomic settlement is verified.', { code: 'ATOMIC_SETTLEMENT_UNAVAILABLE' });

    case 'minesStart':
      throw new EndpointError('This balance-moving game is disabled until atomic settlement is verified.', { code: 'ATOMIC_SETTLEMENT_UNAVAILABLE' });

    case 'minesStatus':
      throw new EndpointError('Active game sessions are disabled until settlement is verified.', { code: 'ATOMIC_SETTLEMENT_UNAVAILABLE' });

    case 'minesOpen':
      throw new EndpointError('This balance-moving game is disabled until atomic settlement is verified.', { code: 'ATOMIC_SETTLEMENT_UNAVAILABLE' });

    case 'minesCashout':
      throw new EndpointError('This balance-moving game is disabled until atomic settlement is verified.', { code: 'ATOMIC_SETTLEMENT_UNAVAILABLE' });

    case 'blackjackStatus':
      throw new EndpointError('Active game sessions are disabled until settlement is verified.', { code: 'ATOMIC_SETTLEMENT_UNAVAILABLE' });

    case 'blackjackJoin':
      throw new EndpointError('This balance-moving game is disabled until atomic settlement is verified.', { code: 'ATOMIC_SETTLEMENT_UNAVAILABLE' });

    case 'blackjackHit':
      throw new EndpointError('This balance-moving game is disabled until atomic settlement is verified.', { code: 'ATOMIC_SETTLEMENT_UNAVAILABLE' });

    case 'blackjackStand':
      throw new EndpointError('This balance-moving game is disabled until atomic settlement is verified.', { code: 'ATOMIC_SETTLEMENT_UNAVAILABLE' });

    case 'shanCreate':
      throw new EndpointError('Multiplayer tables are disabled until settlement is verified.', { code: 'ATOMIC_SETTLEMENT_UNAVAILABLE' });

    case 'shanStatus':
      throw new EndpointError('Multiplayer tables are disabled until settlement is verified.', { code: 'ATOMIC_SETTLEMENT_UNAVAILABLE' });

    case 'shanJoin':
      throw new EndpointError('This balance-moving game is disabled until atomic settlement is verified.', { code: 'ATOMIC_SETTLEMENT_UNAVAILABLE' });

    case 'shanDraw':
      throw new EndpointError('This balance-moving game is disabled until atomic settlement is verified.', { code: 'ATOMIC_SETTLEMENT_UNAVAILABLE' });

    case 'shanStay':
      throw new EndpointError('This balance-moving game is disabled until atomic settlement is verified.', { code: 'ATOMIC_SETTLEMENT_UNAVAILABLE' });

    case 'shanDeal':
      throw new EndpointError('This balance-moving game is disabled until atomic settlement is verified.', { code: 'ATOMIC_SETTLEMENT_UNAVAILABLE' });

    case 'backgroundMusic':
      return { ok: true, enabled: false };

    default:
      throw new EndpointError('This Serverless feature is not available.', {
        code: 'NOT_PORTED',
        action,
      });
  }
}
