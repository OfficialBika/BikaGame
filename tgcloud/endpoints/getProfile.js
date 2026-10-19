import { EndpointError } from 'sdk';
import { ensureUser } from '../lib/users.js';

export default async function (_input, ctx) {
  const telegramUser = ctx?.initData?.user;
  if (!telegramUser?.id) {
    throw new EndpointError('A verified Telegram Mini App user is required.', { code: 'AUTH_REQUIRED' });
  }

  const user = await ensureUser(telegramUser);
  return {
    profile: {
      id: user.tgId,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      languageCode: user.languageCode,
    },
    wallet: {
      balance: user.balance,
      currency: '$',
      environment: 'serverless-preview',
    },
    productionDataImported: false,
  };
}
