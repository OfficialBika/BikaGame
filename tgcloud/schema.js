import { table, integer, text, boolean, json, index } from 'sdk/db';

// Serverless preview schema only. It is separate from the existing MongoDB database.
// Do not apply a production migration until the migration plan has been reviewed.
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
