'use strict';

const { col } = require('../config/database');

const KEY = 'miniapp_background_music';

async function getBackgroundMusic() {
  const doc = await col('config').findOne({ key: KEY });
  if (!doc?.fileId) return null;
  return {
    fileId: doc.fileId,
    title: doc.title || 'Bika Premium Arena',
    mimeType: doc.mimeType || 'audio/mpeg',
    updatedAt: doc.updatedAt || null,
  };
}

async function setBackgroundMusic({ fileId, title, mimeType, ownerId }) {
  if (!fileId) throw new Error('BG_MUSIC_FILE_MISSING');
  const now = new Date();
  await col('config').updateOne(
    { key: KEY },
    {
      $set: {
        key: KEY,
        fileId: String(fileId),
        title: String(title || 'Bika Premium Arena'),
        mimeType: String(mimeType || 'audio/mpeg'),
        updatedAt: now,
        updatedBy: ownerId || null,
      },
    },
    { upsert: true }
  );
  return getBackgroundMusic();
}

async function clearBackgroundMusic() {
  await col('config').deleteOne({ key: KEY });
}

module.exports = { getBackgroundMusic, setBackgroundMusic, clearBackgroundMusic, KEY };
