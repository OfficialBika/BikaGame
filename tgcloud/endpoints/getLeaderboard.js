import { EndpointError } from 'sdk';
import { ensureUser, listTopUsers, displayName } from '../lib/users.js';

export default async function (input, ctx) {
  const telegramUser = ctx?.initData?.user;
  if (!telegramUser?.id) {
    throw new EndpointError('A verified Telegram Mini App user is required.', { code: 'AUTH_REQUIRED' });
  }

  await ensureUser(telegramUser);
  const requestedLimit = Number(input?.limit ?? 10);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(20, Math.floor(requestedLimit))) : 10;
  const rows = await listTopUsers(limit);

  return {
    environment: 'serverless-preview',
    productionDataImported: false,
    generatedAt: new Date().toISOString(),
    entries: rows.map((row, index) => ({
      rank: index + 1,
      userId: row.tgId,
      name: displayName(row),
      balance: row.balance,
      currency: '$',
    })),
  };
}
