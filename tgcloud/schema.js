import { table, integer, text, boolean, json, index } from 'sdk/db';

export const users = table('users', {
  tgId: integer('tg_id').primaryKey(),
  username: text('username'),
  firstName: text('first_name').notNull().default('Player'),
  lastName: text('last_name'),
  photoUrl: text('photo_url'),
  languageCode: text('language_code'),
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
}));

export const gameHistory = table('game_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  game: text('game').notNull(),
  bet: integer('bet').notNull().default(0),
  payout: integer('payout').notNull().default(0),
  multiplier: integer('multiplier').notNull().default(0),
  result: json('result'),
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
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  userTimeIdx: index('idx_orders_user_created').on(t.userId, t.createdAt),
  statusIdx: index('idx_orders_status').on(t.status, t.createdAt),
}));