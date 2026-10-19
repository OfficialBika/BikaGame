import { api, db, EndpointError } from 'sdk';
import { and, asc, eq, isNull, lt, or } from 'sdk/db';
import {
  users, groups, broadcastJobs, broadcastTargets, broadcastLocks,
} from '../schema.js';
import { SERVERLESS_OWNER_TELEGRAM_ID } from './config.js';
import {
  broadcastRetryDelayMs, escapeHtml, isPermanentRecipientError,
} from './broadcastPolicy.js';

const BATCH_SIZE = 100;
const SEND_CONCURRENCY = 8;
const SENDS_PER_SECOND = 25;
const LOCK_STALE_MS = 15 * 60 * 1000;
const RETRIES = 4;
const LOCK_KEY = 'active';
const now = () => new Date();
const uid = () => 'bc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

function ownerId() {
  const value = Number(SERVERLESS_OWNER_TELEGRAM_ID);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export function assertBroadcastOwner(actorId) {
  const owner = ownerId();
  if (!owner) {
    throw new EndpointError('SERVERLESS_OWNER_TELEGRAM_ID is not configured; broadcast is disabled.', {
      code: 'OWNER_NOT_CONFIGURED',
    });
  }
  if (Number(actorId) !== owner) {
    throw new EndpointError('Owner only.', { code: 'OWNER_ONLY' });
  }
}

function rowsAffected(result) {
  return Number(result?.rowsAffected || 0);
}

async function ensureLockRow() {
  await db.insert(broadcastLocks).values({
    key: LOCK_KEY,
    jobId: null,
    ownerChatId: null,
    heartbeatAt: null,
    updatedAt: now(),
  }).onConflictDoNothing().run();
}

async function acquireLock(jobId, ownerChatId) {
  const timestamp = now();
  await ensureLockRow();

  const existing = await db.select().from(broadcastLocks)
    .where(eq(broadcastLocks.key, LOCK_KEY)).get();

  if (!existing?.jobId) {
    const claimed = await db.update(broadcastLocks).set({
      jobId,
      ownerChatId: Number(ownerChatId),
      heartbeatAt: timestamp,
      updatedAt: timestamp,
    }).where(and(eq(broadcastLocks.key, LOCK_KEY), isNull(broadcastLocks.jobId))).run();
    if (rowsAffected(claimed) > 0) return { ok: true, recoveredJobId: null };
  } else {
    const staleBefore = new Date(timestamp.getTime() - LOCK_STALE_MS);
    const heartbeat = existing.heartbeatAt ? new Date(existing.heartbeatAt) : new Date(0);
    if (heartbeat.getTime() < staleBefore.getTime()) {
      const claimed = await db.update(broadcastLocks).set({
        jobId,
        ownerChatId: Number(ownerChatId),
        heartbeatAt: timestamp,
        updatedAt: timestamp,
      }).where(and(
        eq(broadcastLocks.key, LOCK_KEY),
        eq(broadcastLocks.jobId, existing.jobId),
        or(isNull(broadcastLocks.heartbeatAt), lt(broadcastLocks.heartbeatAt, staleBefore)),
      )).run();
      if (rowsAffected(claimed) > 0) {
        return { ok: true, recoveredJobId: String(existing.jobId) };
      }
    }
  }
  return { ok: false, activeJobId: existing?.jobId || null };
}

async function releaseLock(jobId) {
  await db.update(broadcastLocks).set({
    jobId: null,
    ownerChatId: null,
    heartbeatAt: null,
    updatedAt: now(),
  }).where(and(
    eq(broadcastLocks.key, LOCK_KEY),
    eq(broadcastLocks.jobId, jobId),
  )).run();
}

async function refreshLock(jobId) {
  await db.update(broadcastLocks).set({
    heartbeatAt: now(),
    updatedAt: now(),
  }).where(and(
    eq(broadcastLocks.key, LOCK_KEY),
    eq(broadcastLocks.jobId, jobId),
  )).run();
}

async function recoverStaleJob(jobId) {
  if (!jobId) return;
  const previous = await db.select().from(broadcastJobs)
    .where(eq(broadcastJobs.id, jobId)).get();
  if (!previous || !['running', 'cancel_requested'].includes(previous.status)) return;
  await db.update(broadcastJobs).set({
    status: previous.status === 'cancel_requested' ? 'cancelled' : 'paused',
    updatedAt: now(),
  }).where(and(
    eq(broadcastJobs.id, jobId),
    eq(broadcastJobs.status, previous.status),
  )).run();
  await db.update(broadcastTargets).set({ status: 'pending', updatedAt: now() })
    .where(and(
      eq(broadcastTargets.jobId, jobId),
      eq(broadcastTargets.status, 'sending'),
    )).run();
}

async function collectTargets() {
  const [userRows, groupRows] = await Promise.all([
    db.select({ id: users.tgId }).from(users).all(),
    db.select({ id: groups.groupId }).from(groups)
      .where(eq(groups.approvalStatus, 'approved')).all(),
  ]);
  const unique = new Map();
  for (const row of userRows) {
    const chatId = Number(row.id);
    if (Number.isSafeInteger(chatId) && chatId > 0) {
      unique.set(String(chatId), { chatId, kind: 'user' });
    }
  }
  for (const row of groupRows) {
    const chatId = Number(row.id);
    if (Number.isSafeInteger(chatId) && chatId < 0) {
      unique.set(String(chatId), { chatId, kind: 'group' });
    }
  }
  return [...unique.values()];
}

async function insertTargetSnapshot(jobId, targets) {
  const timestamp = now();
  for (let offset = 0; offset < targets.length; offset += 100) {
    const rows = targets.slice(offset, offset + 100).map((target) => ({
      id: jobId + ':' + String(target.chatId),
      jobId,
      targetChatId: target.chatId,
      kind: target.kind,
      status: 'pending',
      attempts: 0,
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    if (rows.length) await db.insert(broadcastTargets).values(rows).onConflictDoNothing().run();
    await refreshLock(jobId);
  }
}

function progressText(job, counters, state, pending) {
  const mode = job.payload?.mode === 'copy' ? 'COPY' : 'TEXT';
  const label = state === 'completed' ? '✅ Broadcast completed'
    : state === 'paused' ? '⏸ Broadcast paused — resume to continue'
    : state === 'cancelled' ? '🛑 Broadcast cancelled'
    : state === 'running' ? '📣 Broadcast progress'
    : '⚠️ Broadcast status';
  return label + '\n' +
    'Mode: ' + mode + '\n' +
    'Processed: ' + counters.processed + '/' + counters.total + '\n' +
    'Sent: ' + counters.sent + ' (users ' + counters.usersSent + ', groups ' + counters.groupsSent + ')\n' +
    'Skipped: ' + counters.skipped + '\n' +
    'Failed: ' + counters.failed + '\n' +
    'Pending: ' + pending +
    (state === 'paused' && pending > 0 ? '\nSend /broadcast resume to continue this saved job.' : '');
}

async function countTargets(jobId, status) {
  return db.$count(broadcastTargets, and(
    eq(broadcastTargets.jobId, jobId),
    eq(broadcastTargets.status, status),
  ));
}

async function countersFor(jobId) {
  const rows = await db.select({
    kind: broadcastTargets.kind,
    status: broadcastTargets.status,
  }).from(broadcastTargets).where(eq(broadcastTargets.jobId, jobId)).all();
  const counters = { total: rows.length, processed: 0, sent: 0, usersSent: 0, groupsSent: 0, skipped: 0, failed: 0, pending: 0, sending: 0 };
  for (const row of rows) {
    if (row.status !== 'pending' && row.status !== 'sending') counters.processed += 1;
    if (row.status === 'sent') {
      counters.sent += 1;
      if (row.kind === 'user') counters.usersSent += 1;
      if (row.kind === 'group') counters.groupsSent += 1;
    } else if (row.status === 'skipped') counters.skipped += 1;
    else if (row.status === 'failed') counters.failed += 1;
    else if (row.status === 'pending') counters.pending += 1;
    else if (row.status === 'sending') counters.sending += 1;
  }
  return counters;
}

async function editProgress(job, state) {
  const payload = job.payload || {};
  if (!payload.ownerChatId || !payload.progressMessageId) return;
  const counters = await countersFor(job.id);
  const pending = counters.pending + counters.sending;
  try {
    await api.editMessageText({
      chat_id: Number(payload.ownerChatId),
      message_id: Number(payload.progressMessageId),
      text: progressText(job, counters, state, pending),
      reply_markup: state === 'paused'
        ? { inline_keyboard: [[{ text: '▶️ Resume Broadcast', callback_data: 'broadcast:resume:' + job.id }]] }
        : undefined,
    });
  } catch (error) {
    console.warn('Broadcast progress edit failed:', String(error?.description || error?.message || error));
  }
}

function pacer() {
  const interval = Math.ceil(1000 / SENDS_PER_SECOND);
  let nextAt = 0;
  let chain = Promise.resolve();
  return function pace() {
    const current = chain.then(async () => {
      const wait = Math.max(0, nextAt - Date.now());
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      nextAt = Math.max(Date.now(), nextAt) + interval;
    });
    chain = current.catch(() => {});
    return current;
  };
}

function permanentError(error) {
  return isPermanentRecipientError(error);
}

async function sendTarget(target, payload) {
  if (payload.mode === 'copy') {
    const params = {
      chat_id: Number(target.targetChatId),
      from_chat_id: Number(payload.sourceChatId),
      message_id: Number(payload.sourceMessageId),
    };
    if (payload.replyMarkup) params.reply_markup = payload.replyMarkup;
    return api.copyMessage(params);
  }
  return api.sendMessage({
    chat_id: Number(target.targetChatId),
    text: '📣 <b>BIKA Broadcast</b>\n━━━━━━━━━━━━━━\n' + escapeHtml(payload.text || ''),
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
}

async function attemptTarget(target, payload, pace, jobId) {
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    const job = await db.select().from(broadcastJobs).where(eq(broadcastJobs.id, jobId)).get();
    if (!job || !['running', 'cancel_requested'].includes(job.status) || job.status === 'cancel_requested') {
      return { status: 'pending', attempts: attempt - 1, lastError: 'CANCELLED' };
    }
    await pace();
    try {
      await sendTarget(target, payload);
      return { status: 'sent', attempts: attempt, lastError: null };
    } catch (error) {
      const message = String(error?.description || error?.message || error);
      if (permanentError(error)) return { status: 'skipped', attempts: attempt, lastError: message.slice(0, 300) };
      const delay = broadcastRetryDelayMs(error, attempt);
      if (attempt >= RETRIES || delay === 0) {
        return { status: 'failed', attempts: attempt, lastError: message.slice(0, 300) };
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return { status: 'failed', attempts: RETRIES, lastError: 'RETRY_LIMIT' };
}

async function processTarget(target, job, pace, progressState) {
  const claimed = await db.update(broadcastTargets).set({
    status: 'sending',
    attempts: Number(target.attempts || 0) + 1,
    updatedAt: now(),
  }).where(and(
    eq(broadcastTargets.id, target.id),
    eq(broadcastTargets.status, 'pending'),
  )).run();
  if (!rowsAffected(claimed)) return;

  const outcome = await attemptTarget(target, job.payload || {}, pace, job.id);
  if (outcome.status === 'pending') {
    await db.update(broadcastTargets).set({
      status: 'pending',
      lastError: outcome.lastError,
      updatedAt: now(),
    }).where(and(
      eq(broadcastTargets.id, target.id),
      eq(broadcastTargets.status, 'sending'),
    )).run();
    return;
  }
  await db.update(broadcastTargets).set({
    status: outcome.status,
    attempts: Math.max(Number(target.attempts || 0) + 1, Number(outcome.attempts || 0)),
    lastError: outcome.lastError,
    updatedAt: now(),
  }).where(and(
    eq(broadcastTargets.id, target.id),
    eq(broadcastTargets.status, 'sending'),
  )).run();
  progressState.attempted += 1;
}

async function refreshJobCounts(jobId) {
  const [sent, failed, skipped] = await Promise.all([
    countTargets(jobId, 'sent'),
    countTargets(jobId, 'failed'),
    countTargets(jobId, 'skipped'),
  ]);
  await db.update(broadcastJobs).set({
    sentCount: Number(sent || 0),
    failedCount: Number(failed || 0) + Number(skipped || 0),
    updatedAt: now(),
  }).where(eq(broadcastJobs.id, jobId)).run();
}

export async function startBroadcast({ actorId, ownerChatId, text, mode, sourceMessage, progressMessageId }) {
  assertBroadcastOwner(actorId);
  const jobId = uid();
  const lock = await acquireLock(jobId, ownerChatId);
  if (!lock.ok) {
    throw new EndpointError('Another broadcast is already running. Wait for it to pause or complete.', {
      code: 'BROADCAST_RUNNING',
      jobId: lock.activeJobId,
    });
  }
  try {
    if (lock.recoveredJobId && lock.recoveredJobId !== jobId) await recoverStaleJob(lock.recoveredJobId);
    const broadcastText = String(text || '');
    if (mode === 'text' && escapeHtml(broadcastText).length + 40 > 4096) {
      throw new EndpointError('Broadcast text is too long after safe formatting; shorten it and retry.', { code: 'BROADCAST_TEXT_TOO_LONG' });
    }
    const payload = {
      mode,
      text: mode === 'text' ? broadcastText : '',
      sourceChatId: mode === 'copy' ? Number(ownerChatId) : null,
      sourceMessageId: mode === 'copy' ? Number(sourceMessage?.message_id) : null,
      replyMarkup: mode === 'copy' && sourceMessage?.reply_markup ? sourceMessage.reply_markup : null,
      ownerChatId: Number(ownerChatId),
      progressMessageId: Number(progressMessageId) || null,
      createdBy: Number(actorId),
    };
    if (mode === 'copy' && (!payload.sourceChatId || !payload.sourceMessageId)) {
      throw new EndpointError('Reply to a message to use copy broadcast.', { code: 'BROADCAST_SOURCE_INVALID' });
    }
    const timestamp = now();
    await db.insert(broadcastJobs).values({
      id: jobId,
      status: 'running',
      targetType: 'users_and_approved_groups',
      payload,
      cursor: 0,
      sentCount: 0,
      failedCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }).run();

    const targets = await collectTargets();
    await insertTargetSnapshot(jobId, targets);
    await refreshJobCounts(jobId);
    return await processBroadcastBatch(jobId, actorId, { lockAlreadyHeld: true });
  } catch (error) {
    await db.update(broadcastJobs).set({ status: 'failed', updatedAt: now() })
      .where(eq(broadcastJobs.id, jobId)).run().catch(() => {});
    await releaseLock(jobId).catch(() => {});
    throw error;
  }
}

export async function resumeBroadcast({ actorId, ownerChatId, jobId = null, progressMessageId = null }) {
  assertBroadcastOwner(actorId);
  let job = jobId
    ? await db.select().from(broadcastJobs).where(eq(broadcastJobs.id, jobId)).get()
    : await db.select().from(broadcastJobs)
      .where(or(eq(broadcastJobs.status, 'paused'), eq(broadcastJobs.status, 'running')))
      .orderBy(asc(broadcastJobs.createdAt))
      .all().then((rows) => rows[rows.length - 1] || null);
  if (!job || !['paused', 'running'].includes(job.status)) {
    throw new EndpointError('No resumable broadcast job was found.', { code: 'BROADCAST_NOT_RESUMABLE' });
  }
  if (Number(job.payload?.createdBy) !== Number(actorId)) {
    throw new EndpointError('Only the original owner may resume this broadcast.', { code: 'OWNER_ONLY' });
  }
  const lock = await acquireLock(job.id, ownerChatId);
  if (!lock.ok) throw new EndpointError('Another broadcast is already running.', { code: 'BROADCAST_RUNNING' });
  if (lock.recoveredJobId) await recoverStaleJob(lock.recoveredJobId);
  job = await db.select().from(broadcastJobs).where(eq(broadcastJobs.id, job.id)).get();
  await db.update(broadcastJobs).set({
    status: 'running',
    payload: { ...(job.payload || {}), ownerChatId: Number(ownerChatId), progressMessageId: Number(progressMessageId) || job.payload?.progressMessageId || null },
    updatedAt: now(),
  }).where(eq(broadcastJobs.id, job.id)).run();
  return processBroadcastBatch(job.id, actorId, { lockAlreadyHeld: true });
}

async function processBroadcastBatch(jobId, actorId, { lockAlreadyHeld = false } = {}) {
  let lockOwned = lockAlreadyHeld;
  if (!lockOwned) {
    const freshJob = await db.select().from(broadcastJobs).where(eq(broadcastJobs.id, jobId)).get();
    if (!freshJob) throw new EndpointError('Broadcast job not found.', { code: 'BROADCAST_NOT_FOUND' });
    const lock = await acquireLock(jobId, freshJob.payload?.ownerChatId || actorId);
    if (!lock.ok) throw new EndpointError('Another broadcast is already running.', { code: 'BROADCAST_RUNNING' });
    lockOwned = true;
  }
  try {
    let job = await db.select().from(broadcastJobs).where(eq(broadcastJobs.id, jobId)).get();
    if (!job) throw new EndpointError('Broadcast job not found.', { code: 'BROADCAST_NOT_FOUND' });
    if (Number(job.payload?.createdBy) !== Number(actorId)) {
      throw new EndpointError('Only the original owner may continue this broadcast.', { code: 'OWNER_ONLY' });
    }
    if (job.status === 'cancel_requested') {
      await db.update(broadcastJobs).set({ status: 'cancelled', updatedAt: now() }).where(eq(broadcastJobs.id, jobId)).run();
      job = await db.select().from(broadcastJobs).where(eq(broadcastJobs.id, jobId)).get();
      await editProgress(job, 'cancelled');
      return { jobId, status: 'cancelled' };
    }
    if (job.status !== 'running') {
      await db.update(broadcastJobs).set({ status: 'running', updatedAt: now() }).where(eq(broadcastJobs.id, jobId)).run();
      job = await db.select().from(broadcastJobs).where(eq(broadcastJobs.id, jobId)).get();
    }

    const pending = await db.select().from(broadcastTargets)
      .where(and(eq(broadcastTargets.jobId, jobId), eq(broadcastTargets.status, 'pending')))
      .orderBy(asc(broadcastTargets.createdAt), asc(broadcastTargets.id))
      .limit(BATCH_SIZE)
      .all();

    const progressState = { attempted: 0 };
    const pace = pacer();
    let cursor = 0;
    async function worker() {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= pending.length) return;
        const currentJob = await db.select().from(broadcastJobs).where(eq(broadcastJobs.id, jobId)).get();
        if (!currentJob || currentJob.status !== 'running') return;
        await processTarget(pending[index], currentJob, pace, progressState);
        if (progressState.attempted > 0 && progressState.attempted % 25 === 0) {
          await refreshLock(jobId);
          await refreshJobCounts(jobId);
          const fresh = await db.select().from(broadcastJobs).where(eq(broadcastJobs.id, jobId)).get();
          if (fresh) await editProgress(fresh, 'running');
        }
      }
    }
    const workerResults = await Promise.allSettled(Array.from({ length: Math.min(SEND_CONCURRENCY, Math.max(1, pending.length)) }, () => worker()));
    const workerError = workerResults.find((result) => result.status === 'rejected');
    if (workerError) throw workerError.reason;

    const freshStatus = await db.select().from(broadcastJobs).where(eq(broadcastJobs.id, jobId)).get();
    if (freshStatus?.status === 'cancel_requested') {
      await db.update(broadcastJobs).set({ status: 'cancelled', updatedAt: now() }).where(eq(broadcastJobs.id, jobId)).run();
    }
    await refreshJobCounts(jobId);
    const counters = await countersFor(jobId);
    const finalStatus = !counters.pending && !counters.sending
      ? (freshStatus?.status === 'cancel_requested' ? 'cancelled' : 'completed')
      : freshStatus?.status === 'cancel_requested' ? 'cancelled' : 'paused';
    await db.update(broadcastJobs).set({
      status: finalStatus,
      cursor: counters.processed,
      sentCount: counters.sent,
      failedCount: counters.failed + counters.skipped,
      updatedAt: now(),
    }).where(eq(broadcastJobs.id, jobId)).run();
    job = await db.select().from(broadcastJobs).where(eq(broadcastJobs.id, jobId)).get();
    await editProgress(job, finalStatus);
    return { jobId, status: finalStatus, ...counters };
  } catch (error) {
    console.error('Broadcast batch paused after worker error:', String(error?.message || error));
    await db.update(broadcastTargets).set({ status: 'pending', updatedAt: now() })
      .where(and(eq(broadcastTargets.jobId, jobId), eq(broadcastTargets.status, 'sending'))).run().catch(() => {});
    await db.update(broadcastJobs).set({ status: 'paused', updatedAt: now() })
      .where(and(eq(broadcastJobs.id, jobId), eq(broadcastJobs.status, 'running'))).run().catch(() => {});
    const currentJob = await db.select().from(broadcastJobs).where(eq(broadcastJobs.id, jobId)).get().catch(() => null);
    if (currentJob) await editProgress(currentJob, 'paused').catch(() => {});
    return { jobId, status: 'paused', error: 'BROADCAST_BATCH_FAILED' };
  } finally {
    if (lockOwned) await releaseLock(jobId).catch((error) => {
      console.warn('Broadcast lock release failed:', String(error?.message || error));
    });
  }
}

export async function cancelBroadcast({ actorId }) {
  assertBroadcastOwner(actorId);
  const active = await db.select().from(broadcastJobs)
    .where(eq(broadcastJobs.status, 'running')).orderBy(asc(broadcastJobs.createdAt)).all();
  const job = active[active.length - 1];
  if (job) {
    await db.update(broadcastJobs).set({ status: 'cancel_requested', updatedAt: now() })
      .where(and(eq(broadcastJobs.id, job.id), eq(broadcastJobs.status, 'running'))).run();
    return { ok: true, status: 'cancel_requested', jobId: job.id };
  }
  const paused = await db.select().from(broadcastJobs)
    .where(eq(broadcastJobs.status, 'paused')).orderBy(asc(broadcastJobs.createdAt)).all();
  const pendingJob = paused[paused.length - 1];
  if (!pendingJob) return { ok: false, status: 'idle' };
  await db.update(broadcastJobs).set({ status: 'cancelled', updatedAt: now() })
    .where(and(eq(broadcastJobs.id, pendingJob.id), eq(broadcastJobs.status, 'paused'))).run();
  return { ok: true, status: 'cancelled', jobId: pendingJob.id };
}

export async function getBroadcastStatus(actorId) {
  assertBroadcastOwner(actorId);
  const rows = await db.select().from(broadcastJobs)
    .where(or(
      eq(broadcastJobs.status, 'running'),
      eq(broadcastJobs.status, 'paused'),
      eq(broadcastJobs.status, 'cancel_requested'),
    )).orderBy(asc(broadcastJobs.createdAt)).all();
  const job = rows[rows.length - 1];
  if (!job) return { status: 'idle' };
  return { status: job.status, jobId: job.id, counters: await countersFor(job.id) };
}
