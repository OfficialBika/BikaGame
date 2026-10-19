import { table, integer, real, text, boolean, json, index, uniqueIndex, sql } from 'sdk/db';

export const users = table('users', {
  tgId: integer('tg_id').primaryKey(),
  username: text('username'),
  firstName: text('first_name').notNull().default('Player'),
  lastName: text('last_name'),
  photoUrl: text('photo_url'),
  languageCode: text('language_code'),
  walletId: text('wallet_id').unique(),
  starsBalance: integer('stars_balance').notNull().default(0),
  legacyData: json('legacy_data'),
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
  meta: json('meta'),
  sourceId: text('source_id').unique(),
  settlementId: text('settlement_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  recipientTimeIdx: index('idx_transactions_recipient_created').on(t.toUserId, t.createdAt),
  typeTimeIdx: index('idx_transactions_type_created').on(t.type, t.createdAt),
}));

export const treasury = table('treasury', {
  key: text('key').primaryKey(),
  ownerBalance: integer('owner_balance').notNull().default(0),
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
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  userGameIdx: index('idx_game_sessions_user_game').on(t.userId, t.game),
  statusIdx: index('idx_game_sessions_status').on(t.game, t.status),
  activeUserGameUnique: uniqueIndex('uq_game_sessions_active_user_game')
    .on(t.userId, t.game)
    .where(sql`${t.status} = 'active'`),
}));

export const gameHistory = table('game_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  game: text('game').notNull(),
  bet: integer('bet').notNull().default(0),
  payout: integer('payout').notNull().default(0),
  multiplier: integer('multiplier').notNull().default(0),
  result: json('result'),
  sourceId: text('source_id').unique(),
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
  telegramChargeId: text('telegram_charge_id').unique(),
  providerChargeId: text('provider_charge_id'),
  invoicePayload: text('invoice_payload'),
  payload: json('payload'),
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
  meta: json('meta'),
  sourceId: text('source_id').unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  userTimeIdx: index('idx_orders_user_created').on(t.userId, t.createdAt),
  statusIdx: index('idx_orders_status').on(t.status, t.createdAt),
}));

// Production Mongo collection parity tables. These are additive migration targets;
// they do not import or mutate any source data by themselves.
export const groups = table('groups', {
  groupId: integer('group_id').primaryKey(),
  title: text('title'),
  username: text('username'),
  type: text('type'),
  approvalStatus: text('approval_status').notNull().default('pending'),
  botIsAdmin: boolean('bot_is_admin').notNull().default(false),
  inviteLink: text('invite_link'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  payload: json('payload'),
}, (t) => ({
  approvalUpdatedIdx: index('idx_groups_approval_updated').on(t.approvalStatus, t.updatedAt),
}));

export const shopCards = table('shop_cards', {
  id: text('id').primaryKey(),
  botKey: text('bot_key'),
  cardId: text('card_id'),
  rarity: text('rarity'),
  status: text('status').notNull().default('AVAILABLE'),
  soldToUserId: integer('sold_to_user_id'),
  soldAt: integer('sold_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  payload: json('payload'),
}, (t) => ({
  botCardUnique: uniqueIndex('uq_shop_cards_bot_card')
    .on(t.botKey, t.cardId)
    .where(sql`${t.botKey} IS NOT NULL AND ${t.cardId} IS NOT NULL`),
  cardLookupIdx: index('idx_shop_cards_card_id').on(t.cardId),
  rarityStatusIdx: index('idx_shop_cards_rarity_status_card').on(t.rarity, t.status, t.cardId),
  statusUpdatedIdx: index('idx_shop_cards_status_updated').on(t.status, t.updatedAt),
  soldToTimeIdx: index('idx_shop_cards_sold_to_time').on(t.soldToUserId, t.soldAt),
}));

export const shopSettings = table('shop_settings', {
  key: text('key').primaryKey(),
  value: json('value'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const twoDEvents = table('two_d_events', {
  eventId: text('event_id').primaryKey(),
  status: text('status').notNull(),
  resultAt: integer('result_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  payload: json('payload'),
}, (t) => ({
  statusResultIdx: index('idx_two_d_status_result').on(t.status, t.resultAt),
}));

export const twoDBets = table('two_d_bets', {
  id: text('id').primaryKey(),
  eventId: text('event_id').notNull(),
  userId: integer('user_id').notNull(),
  amount: integer('amount').notNull().default(0),
  status: text('status'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  payload: json('payload'),
}, (t) => ({
  eventUserIdx: index('idx_two_d_bets_event_user').on(t.eventId, t.userId),
  userTimeIdx: index('idx_two_d_bets_user_time').on(t.userId, t.createdAt),
}));

export const twoDPositions = table('two_d_positions', {
  id: text('id').primaryKey(),
  eventId: text('event_id').notNull(),
  userId: integer('user_id'),
  position: text('position'),
  amount: integer('amount').notNull().default(0),
  payload: json('payload'),
});

export const twoDOffdates = table('two_d_offdates', {
  id: text('id').primaryKey(),
  offDate: text('off_date').notNull(),
  reason: text('reason'),
  payload: json('payload'),
});

export const sportsEvents = table('sports_events', {
  id: text('id').primaryKey(),
  eventId: text('event_id'),
  status: text('status').notNull(),
  commentChatId: integer('comment_chat_id'),
  threadRootMessageId: integer('thread_root_message_id'),
  settledAt: integer('settled_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  payload: json('payload'),
}, (t) => ({
  statusCreatedIdx: index('idx_sports_events_status_created').on(t.status, t.createdAt),
  threadRootStatusIdx: index('idx_sports_events_thread_root_status').on(t.commentChatId, t.threadRootMessageId, t.status),
}));

export const sportsBets = table('sports_bets', {
  id: text('id').primaryKey(),
  eventId: text('event_id').notNull(),
  userId: integer('user_id').notNull(),
  potentialWin: integer('potential_win').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  payload: json('payload'),
}, (t) => ({
  eventUserUnique: uniqueIndex('uq_sports_bets_event_user').on(t.eventId, t.userId),
  eventPotentialIdx: index('idx_sports_bets_event_potential').on(t.eventId, t.potentialWin),
  userTimeIdx: index('idx_sports_bets_user_time').on(t.userId, t.createdAt),
}));

export const auctions = table('auctions', {
  auctionId: text('auction_id').primaryKey(),
  channelId: integer('channel_id'),
  status: text('status').notNull(),
  endAt: integer('end_at', { mode: 'timestamp' }),
  channelMessageId: integer('channel_message_id'),
  historyExpiresAt: integer('history_expires_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  payload: json('payload'),
}, (t) => ({
  activeEndIdx: index('idx_auctions_channel_status_end').on(t.channelId, t.status, t.endAt),
  channelMessageUnique: uniqueIndex('uq_auctions_channel_message').on(t.channelMessageId),
}));

export const auctionBids = table('auction_bids', {
  id: text('id').primaryKey(),
  auctionId: text('auction_id').notNull(),
  messageId: integer('message_id'),
  userId: integer('user_id'),
  amount: integer('amount').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  payload: json('payload'),
}, (t) => ({
  auctionTimeIdx: index('idx_auction_bids_auction_time').on(t.auctionId, t.createdAt),
  auctionMessageUnique: uniqueIndex('uq_auction_bids_auction_message')
    .on(t.auctionId, t.messageId)
    .where(sql`${t.messageId} IS NOT NULL`),
}));

export const dailyTournaments = table('daily_tournaments', {
  id: text('id').primaryKey(),
  dayKey: text('day_key').notNull(),
  game: text('game').notNull(),
  chatId: integer('chat_id').notNull(),
  userId: integer('user_id').notNull(),
  score: integer('score').notNull().default(0),
  bestWin: integer('best_win').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  payload: json('payload'),
}, (t) => ({
  dayGameChatUserUnique: uniqueIndex('uq_daily_tournament_day_game_chat_user').on(t.dayKey, t.game, t.chatId, t.userId),
  rankIdx: index('idx_daily_tournament_rank').on(t.dayKey, t.game, t.chatId, t.score, t.bestWin),
}));

export const sellOrders = table('sell_orders', {
  id: text('id').primaryKey(),
  orderId: text('order_id').notNull().unique(),
  giftLink: text('gift_link').unique(),
  sellerId: integer('seller_id').notNull(),
  status: text('status').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  payload: json('payload'),
}, (t) => ({
  sellerTimeIdx: index('idx_sell_orders_seller_time').on(t.sellerId, t.createdAt),
  statusTimeIdx: index('idx_sell_orders_status_time').on(t.status, t.createdAt),
}));

export const sellPrices = table('sell_prices', {
  id: text('id').primaryKey(),
  botKey: text('bot_key').notNull(),
  rarityKey: text('rarity_key').notNull(),
  price: integer('price').notNull().default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  payload: json('payload'),
}, (t) => ({
  botRarityUnique: uniqueIndex('uq_sell_prices_bot_rarity').on(t.botKey, t.rarityKey),
}));

export const promoRtps = table('promo_rtps', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull(),
  rtp: real('rtp').notNull(),
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  ended: boolean('ended').notNull().default(false),
  endedAt: integer('ended_at', { mode: 'timestamp' }),
  payload: json('payload'),
}, (t) => ({
  activeGroupIdx: index('idx_promo_rtps_group_active').on(t.groupId, t.ended),
  expiresIdx: index('idx_promo_rtps_expires').on(t.expiresAt),
}));

export const webGameHistory = table('web_game_history', {
  id: text('id').primaryKey(),
  userId: integer('user_id').notNull(),
  game: text('game').notNull(),
  bet: integer('bet').notNull().default(0),
  payout: integer('payout').notNull().default(0),
  multiplier: real('multiplier').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  result: json('result'),
  payload: json('payload'),
}, (t) => ({
  userGameTimeIdx: index('idx_web_game_history_user_game_time').on(t.userId, t.game, t.createdAt),
  retentionIdx: index('idx_web_game_history_created').on(t.createdAt),
}));

export const settlementOperations = table('settlement_operations', {
  id: text('id').primaryKey(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  userId: integer('user_id').notNull(),
  operation: text('operation').notNull(),
  amount: integer('amount').notNull(),
  status: text('status').notNull(),
  result: json('result'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  userTimeIdx: index('idx_settlement_operations_user_time').on(t.userId, t.createdAt),
  statusTimeIdx: index('idx_settlement_operations_status_time').on(t.status, t.createdAt),
}));
