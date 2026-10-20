'use strict';

const { col } = require('../../config/database');
const { ensureTreasury, isOwner } = require('../../services/treasuryService');
const { getUser } = require('../../services/economyService');
const { replyHTML, editHTML } = require('../../utils/telegram');
const { getLanguage, t, languageKeyboard, mainMenuKeyboard, languagePickerText, normalizeLanguage } = require('../../services/i18nService');

function isOwnerHelpAllowed(ctx, treasury) {
  return Boolean(treasury && isOwner(ctx, treasury));
}
function mainText(language) {
  return t(language, 'start_title');
}

module.exports = (bot) => {
  bot.command('language', async (ctx) => {
    const user = await getUser(ctx.from?.id);
    const language = getLanguage(user);
    return replyHTML(ctx, t(language, 'choose_language'), { reply_markup: languageKeyboard() });
  });

  bot.action(/^LANG:SET:(my|en|cn|jp|kr|fr|ru|hi|ar)$/, async (ctx) => {
    const language = normalizeLanguage(ctx.match?.[1]);
    if (!language || !ctx.from?.id) {
      try { await ctx.answerCbQuery('Invalid language'); } catch (_) {}
      return;
    }
    const ids = [String(ctx.from.id), Number(ctx.from.id)];
    await col('users').updateOne(
      { userId: { $in: ids } },
      { $set: { language, updatedAt: new Date() } },
      { upsert: true, setDefaultsOnInsert: true }
    );
    try { await ctx.answerCbQuery(t(language, 'language_saved')); } catch (_) {}
    return editHTML(ctx, mainText(language), { reply_markup: mainMenuKeyboard(language) });
  });

  bot.action('MAIN:USER', async (ctx) => {
    const user = await getUser(ctx.from?.id);
    const language = getLanguage(user);
    try { await ctx.answerCbQuery(); } catch (_) {}
    return editHTML(ctx, t(language, 'user_help'), { reply_markup: mainMenuKeyboard(language) });
  });

  bot.action('MAIN:OWNER', async (ctx) => {
    const user = await getUser(ctx.from?.id);
    const language = getLanguage(user);
    const treasury = await ensureTreasury();
    try { await ctx.answerCbQuery(); } catch (_) {}
    if (!isOwnerHelpAllowed(ctx, treasury)) {
      return editHTML(ctx, t(language, 'owner_help') + '\n\n⛔ Owner only.', {
        reply_markup: mainMenuKeyboard(language),
      });
    }
    return editHTML(ctx, t(language, 'owner_help'), { reply_markup: mainMenuKeyboard(language) });
  });
};
