'use strict';

const { getBackgroundMusic } = require('../services/backgroundMusicService');
const { verifyTelegramMiniAppInitData, getInitDataFromRequest } = require('./telegramMiniAuth');

function auth(req) {
  const initData = getInitDataFromRequest(req);
  return verifyTelegramMiniAppInitData(initData);
}

module.exports = function registerBackgroundMusicRoutes(app, { bot }) {
  app.get('/api/mini/background-music', async (req, res) => {
    try {
      auth(req);
      const music = await getBackgroundMusic();
      if (!music) return res.json({ ok: true, enabled: false });

      const fileUrl = await bot.telegram.getFileLink(music.fileId);
      return res.json({
        ok: true,
        enabled: true,
        title: music.title,
        mimeType: music.mimeType,
        url: String(fileUrl),
      });
    } catch (err) {
      const code = String(err?.message || err || 'ERROR');
      const status = code.startsWith('MINIAPP_AUTH_') ? 401 : 500;
      return res.status(status).json({ ok: false, error: code });
    }
  });
};
