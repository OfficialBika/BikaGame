import { api } from 'sdk';
import { ensureUser } from '../lib/users.js';
import { crashCashout, minesOpen, minesCashout, blackjackAction, shanDeal } from '../lib/game.js';

export default async function (query) {
  const user = query?.from;
  const message = query?.message;
  if (!user?.id) return;
  const data = String(query?.data || '');
  try {
    await ensureUser(user);
    const [game, action, arg] = data.split(':');
    let text = 'Done.';
    let markup;
    if (game === 'crash' && action === 'cashout') {
      const r = await crashCashout(user.id);
      text = `💰 Cash Out x${r.multiplier} — +${r.payout} $`;
    } else if (game === 'mines' && action === 'open') {
      const r = await minesOpen(user.id, Number(arg));
      text = r.exploded ? '💥 Mine! Round lost.' : `💎 Safe tile — x${r.multiplier}`;
      if (r.active) markup = { inline_keyboard: [[0,1,2,3,4].map(i=>({text:String(i+1),callback_data:`mines:open:${i}`}))],[5,6,7,8,9].map(i=>({text:String(i+1),callback_data:`mines:open:${i}`})),[{text:'💰 CASH OUT',callback_data:'mines:cashout'}]] };
    } else if (game === 'mines' && action === 'cashout') {
      const r = await minesCashout(user.id);
      text = `💰 Mines Cash Out x${r.multiplier} — +${r.payout} $`;
    } else if (game === 'bj' && (action === 'hit' || action === 'stand')) {
      const r = await blackjackAction(user.id, arg, action);
      text = `🂡 Blackjack — ${r.player?.cards?.map(c=>c.r+c.s).join(' ')||''}`;
      if (r.active) markup={inline_keyboard:[[{text:'HIT',callback_data:`bj:hit:${arg}`},{text:'STAND',callback_data:`bj:stand:${arg}`}]]};
    } else if (game === 'shan' && (action === 'draw' || action === 'stay')) {
      const r = await shanDeal(user.id, arg, action);
      text = `🎴 Shan — ${r.player?.cards?.map(c=>c.r+c.s).join(' ')||''}`;
      if (r.active) markup={inline_keyboard:[[{text:'DRAW',callback_data:`shan:draw:${arg}`},{text:'STAY',callback_data:`shan:stay:${arg}`}]]};
    } else {
      text = 'Unsupported preview action.';
    }
    await api.answerCallbackQuery({ callback_query_id: query.id, text: text.slice(0, 200) });
    if (message?.chat?.id && message?.message_id) await api.editMessageText({ chat_id:message.chat.id, message_id:message.message_id, text, reply_markup:markup });
  } catch (error) {
    console.error('BIKA_SERVERLESS_CALLBACK_FAILED', error);
    await api.answerCallbackQuery({ callback_query_id: query.id, text:'Preview action failed safely.', show_alert:true });
  }
}
