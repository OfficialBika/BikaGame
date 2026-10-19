import { table, integer, text, boolean, json, index, real } from 'sdk/db';

export const users = table('users', {
  tgId: integer('tg_id').primaryKey(),
  username: text('username'),
  firstName: text('first_name').notNull().default('Player'),
  lastName: text('last_name'),
  photoUrl: text('photo_url'),
  languageCode: text('language_code'),
  walletId: text('wallet_id').unique(),
  isBanned: boolean('is_banned').notNull().default(false),
  balance: integer('balance').notNull().default(0),
  totalWon: integer('total_won').notNull().default(0),
  totalLost: integer('total_lost').notNull().default(0),
  isVip: boolean('is_vip').notNull().default(false),
  startBonusClaimed: boolean('start_bonus_claimed').notNull().default(false),
  dailyClaimedAt: integer('daily_claimed_at', { mode: 'timestamp' }),
  startedBot: boolean('started_bot').notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  balanceIdx: index('idx_users_balance').on(t.balance),
}));

export const transactions = table('transactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  fromUserId: text('from_user_id'),
  toUserId: text('to_user_id'),
  amount: integer('amount').notNull(),
  idempotencyKey: text('idempotency_key').unique(),
  accountUserId: integer('account_user_id'),
  balanceDelta: integer('balance_delta'),
  requiredBalance: integer('required_balance'),
  totalWonDelta: integer('total_won_delta'),
  totalLostDelta: integer('total_lost_delta'),
  treasuryDelta: integer('treasury_delta'),
  requiredTreasury: integer('required_treasury'),
  fromAccountUserId: integer('from_account_user_id'),
  toAccountUserId: integer('to_account_user_id'),
  betAmount: integer('bet_amount'),
  payoutAmount: integer('payout_amount'),
  multiplier: real('multiplier'),
  gameKey: text('game_key'),
  historyUserId: integer('history_user_id'),
  gameResult: json('game_result'),
  payouts: json('payouts'),
  refunds: json('refunds'),
  histories: json('histories'),
  meta: json('meta'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  recipientTimeIdx: index('idx_transactions_recipient_created').on(t.toUserId, t.createdAt),
  typeTimeIdx: index('idx_transactions_type_created').on(t.type, t.createdAt),
}));

export const treasury = table('treasury', {
  key: text('key').primaryKey(),
  ownerBalance: integer('owner_balance').notNull().default(0),
  vipWinRate: real('vip_win_rate').notNull().default(90),
  maintenance: boolean('maintenance').notNull().default(false),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const settings = table('settings', {
  key: text('key').primaryKey(),
  value: json('value'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// Serverless-native state. These tables are intentionally independent from MongoDB.
export const gameSessions = table('game_sessions', {
  id: text('id').primaryKey(),
  userId: integer('user_id').notNull(),
  game: text('game').notNull(),
  status: text('status').notNull(),
  state: json('state'),
  version: integer('version').notNull().default(0),
  roomId: text('room_id'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  userGameIdx: index('idx_game_sessions_user_game').on(t.userId, t.game),
  statusIdx: index('idx_game_sessions_status').on(t.game, t.status),
}));

export const gameHistory = table('game_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  game: text('game').notNull(),
  bet: integer('bet').notNull().default(0),
  payout: integer('payout').notNull().default(0),
  multiplier: integer('multiplier').notNull().default(0),
  result: json('result'),
  title: text('title'),
  outcome: text('outcome'),
  net: integer('net'),
  settlementId: text('settlement_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  userTimeIdx: index('idx_game_history_user_created').on(t.userId, t.createdAt),
  gameTimeIdx: index('idx_game_history_game_created').on(t.game, t.createdAt),
}));

export const paymentEvents = table('payment_events', {
  id: text('id').primaryKey(),
  userId: integer('user_id').notNull(),
  stars: integer('stars').notNull().default(0),
  amount: integer('amount').notNull().default(0),
  status: text('status').notNull(),
  payload: json('payload'),
  telegramPaymentChargeId: text('telegram_payment_charge_id'),
  invoicePayload: text('invoice_payload'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  userTimeIdx: index('idx_payment_events_user_created').on(t.userId, t.createdAt),
}));

export const orders = table('orders', {
  id: text('id').primaryKey(),
  userId: integer('user_id').notNull(),
  kind: text('kind').notNull(),
  status: text('status').notNull(),
  amount: integer('amount').notNull().default(0),
  itemId: text('item_id'),
  receiptCode: text('receipt_code'),
  meta: json('meta'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  userTimeIdx: index('idx_orders_user_created').on(t.userId, t.createdAt),
  statusIdx: index('idx_orders_status').on(t.status, t.createdAt),
}));

// Compact replay guards outlive visible-history retention.
export const idempotencyKeys = table('idempotency_keys', {
  key: text('key').primaryKey(), kind: text('kind').notNull(),
  userId: integer('user_id'), createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({ userTimeIdx: index('idx_idempotency_user_created').on(t.userId, t.createdAt) }));

export const userCooldowns = table('user_cooldowns', {
  id: text('id').primaryKey(), userId: integer('user_id').notNull(),
  action: text('action').notNull(), lastUsedAt: integer('last_used_at').notNull(),
}, (t) => ({ userActionIdx: index('idx_cooldowns_user_action').on(t.userId, t.action) }));

export const groups = table('groups', {
  groupId: integer('group_id').primaryKey(), title: text('title'), username: text('username'),
  type: text('type'), approvalStatus: text('approval_status').notNull().default('pending'),
  botIsAdmin: boolean('bot_is_admin').notNull().default(false), inviteLink: text('invite_link'),
  data: json('data'), createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({ approvalUpdatedIdx: index('idx_groups_approval_updated').on(t.approvalStatus, t.updatedAt) }));

export const shopCards = table('shop_cards', {
  id: integer('id').primaryKey({ autoIncrement: true }), botKey: text('bot_key'), cardId: text('card_id'),
  name: text('name'), anime: text('anime'), rarity: text('rarity'), mediaUrl: text('media_url'),
  ownerUserId: integer('owner_user_id'), status: text('status').notNull().default('AVAILABLE'),
  price: integer('price'), soldToUserId: integer('sold_to_user_id'),
  soldAt: integer('sold_at', { mode: 'timestamp' }), data: json('data'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  statusUpdatedIdx: index('idx_shop_cards_status_updated').on(t.status, t.updatedAt),
  ownerStatusIdx: index('idx_shop_cards_owner_status').on(t.ownerUserId, t.status),
  rarityStatusIdx: index('idx_shop_cards_rarity_status').on(t.rarity, t.status),
}));

export const shopSettings = table('shop_settings', {
  key: text('key').primaryKey(), value: json('value'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const twoDEvents = table('two_d_events', {
  id: text('id').primaryKey(), dateKey: text('date_key').unique(),
  status: text('status').notNull().default('open'), result: text('result'),
  openedAt: integer('opened_at', { mode: 'timestamp' }), closeAt: integer('close_at', { mode: 'timestamp' }),
  publishedAt: integer('published_at', { mode: 'timestamp' }), data: json('data'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({ statusDateIdx: index('idx_two_d_events_status_date').on(t.status, t.dateKey) }));

export const twoDBets = table('two_d_bets', {
  id: text('id').primaryKey(), eventId: text('event_id').notNull(), userId: integer('user_id').notNull(),
  number: text('number').notNull(), amount: integer('amount').notNull(),
  potentialWin: integer('potential_win').notNull().default(0), status: text('status').notNull().default('pending'),
  data: json('data'), createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  eventUserIdx: index('idx_two_d_bets_event_user').on(t.eventId, t.userId),
  userCreatedIdx: index('idx_two_d_bets_user_created').on(t.userId, t.createdAt),
}));

export const twoDPositions = table('two_d_positions', {
  id: text('id').primaryKey(), eventId: text('event_id').notNull(), userId: integer('user_id').notNull(),
  number: text('number').notNull(), amount: integer('amount').notNull().default(0), data: json('data'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  eventNumberIdx: index('idx_two_d_positions_event_number').on(t.eventId, t.number),
  eventUserIdx: index('idx_two_d_positions_event_user').on(t.eventId, t.userId),
}));

export const twoDOffdates = table('two_d_offdates', {
  dateKey: text('date_key').primaryKey(), reason: text('reason'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const sportsEvents = table('sports_events', {
  id: text('id').primaryKey(), title: text('title').notNull(),
  status: text('status').notNull().default('open'), result: text('result'),
  commentChatId: integer('comment_chat_id'), threadRootMessageId: integer('thread_root_message_id'),
  threadMessageIds: json('thread_message_ids'), data: json('data'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  statusCreatedIdx: index('idx_sports_events_status_created').on(t.status, t.createdAt),
  threadIdx: index('idx_sports_events_thread').on(t.commentChatId, t.threadRootMessageId),
}));

export const sportsBets = table('sports_bets', {
  id: text('id').primaryKey(), eventId: text('event_id').notNull(), userId: integer('user_id').notNull(),
  choice: text('choice'), amount: integer('amount').notNull(), potentialWin: integer('potential_win').notNull().default(0),
  status: text('status').notNull().default('pending'), data: json('data'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  eventUserIdx: index('idx_sports_bets_event_user').on(t.eventId, t.userId),
  userCreatedIdx: index('idx_sports_bets_user_created').on(t.userId, t.createdAt),
}));

export const auctions = table('auctions', {
  id: text('id').primaryKey(), auctionId: text('auction_id').unique(),
  channelId: integer('channel_id'), channelMessageId: integer('channel_message_id'),
  status: text('status').notNull().default('open'), endAt: integer('end_at', { mode: 'timestamp' }),
  currentBid: integer('current_bid').notNull().default(0), highestBidderId: integer('highest_bidder_id'),
  data: json('data'), createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  statusEndIdx: index('idx_auctions_status_end').on(t.status, t.endAt),
  channelMessageIdx: index('idx_auctions_channel_message').on(t.channelId, t.channelMessageId),
}));

export const auctionBids = table('auction_bids', {
  id: text('id').primaryKey(), auctionId: text('auction_id').notNull(),
  bidderId: integer('bidder_id').notNull(), amount: integer('amount').notNull(),
  messageId: integer('message_id'), data: json('data'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  auctionCreatedIdx: index('idx_auction_bids_created').on(t.auctionId, t.createdAt),
  bidderCreatedIdx: index('idx_auction_bids_bidder_created').on(t.bidderId, t.createdAt),
}));

export const sellOrders = table('sell_orders', {
  id: text('id').primaryKey(), sellerId: integer('seller_id').notNull(), buyerId: integer('buyer_id'),
  status: text('status').notNull().default('pending'), price: integer('price').notNull().default(0),
  receiptCode: text('receipt_code'), data: json('data'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  sellerCreatedIdx: index('idx_sell_orders_seller_created').on(t.sellerId, t.createdAt),
  statusUpdatedIdx: index('idx_sell_orders_status_updated').on(t.status, t.updatedAt),
}));

export const sellPrices = table('sell_prices', {
  key: text('key').primaryKey(), price: integer('price').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const dailyTournaments = table('daily_tournaments', {
  id: text('id').primaryKey(), dayKey: text('day_key').notNull(), userId: integer('user_id').notNull(),
  wins: integer('wins').notNull().default(0), wagered: integer('wagered').notNull().default(0), data: json('data'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  dayWinsIdx: index('idx_daily_tournaments_day_wins').on(t.dayKey, t.wins),
  dayWagerIdx: index('idx_daily_tournaments_day_wager').on(t.dayKey, t.wagered),
}));

export const promoRtps = table('promo_rtps', {
  game: text('game').primaryKey(), rtp: real('rtp').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const broadcastJobs = table('broadcast_jobs', {
  id: text('id').primaryKey(), status: text('status').notNull().default('pending'),
  targetType: text('target_type').notNull(), payload: json('payload'),
  cursor: integer('cursor').notNull().default(0), sentCount: integer('sent_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({ statusUpdatedIdx: index('idx_broadcast_jobs_status_updated').on(t.status, t.updatedAt) }));
