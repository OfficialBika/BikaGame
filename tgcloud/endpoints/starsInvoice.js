import { EndpointError } from 'sdk';
import { createStarsInvoice, STAR_PACKAGES } from '../lib/stars.js';

export default async function (input, ctx) {
  const user = ctx?.initData?.user;
  if (!user?.id) throw new EndpointError('A verified Telegram Mini App user is required.', { code: 'AUTH_REQUIRED' });
  const stars = Number(input?.stars);
  if (!STAR_PACKAGES.includes(stars)) {
    throw new EndpointError('Stars package မမှန်ပါ။', { code: 'INVALID_STARS_PACKAGE', packages: STAR_PACKAGES });
  }
  return createStarsInvoice(Number(user.id), stars);
}
