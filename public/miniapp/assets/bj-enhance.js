/* Bika Blackjack UX enhancer: continuous rounds + Leave Table control. */
(function () {
  'use strict';
  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || '';
  const key = 'bika_bj_leave_v1';
  const playedKey = 'bika_bj_played_v1';
  let roomId = '';
  let lastState = '';
  let autoJoinTimer = null;
  let busy = false;
  const q = (id) => document.getElementById(id);
  const html = (id, value) => { const el = q(id); if (el) el.innerHTML = value; };
  const left = () => sessionStorage.getItem(key) === '1';
  const played = () => sessionStorage.getItem(playedKey) === '1';
  const setLeft = (v) => v ? sessionStorage.setItem(key, '1') : sessionStorage.removeItem(key);
  async function api(path, body) {
    const res = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json','X-Telegram-Init-Data':initData}, body:JSON.stringify(body||{}) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.message || data.error || 'Request failed');
    return data;
  }
  function ensureControls() {
    const actions = document.querySelector('.bj-actions');
    if (!actions || actions.querySelector('#bjLeaveBtn')) return;
    const leave = document.createElement('button'); leave.id='bjLeaveBtn'; leave.type='button'; leave.className='stand-btn bj-leave-btn'; leave.textContent='🚪 LEAVE TABLE'; leave.hidden=true;
    leave.addEventListener('click', leaveTable); actions.appendChild(leave);
  }
  function updateLeaveButton(show) { const btn=q('bjLeaveBtn'); if (btn) { btn.hidden=!show; btn.disabled=busy; } }
  async function leaveTable() {
    if (!roomId || busy) return; busy=true; setLeft(true);
    try { await api('/api/mini/blackjack/status',{roomId:`leave_${roomId}`}); html('bjResult','🚪 <b>Table Leave</b> လုပ်ပြီးပါပြီ။ နောက် round ကို အလိုအလျောက်မဝင်တော့ပါ။'); tg?.HapticFeedback?.notificationOccurred?.('success'); }
    catch(err){setLeft(false);html('bjResult',`⚠️ ${String(err.message||err)}`);tg?.HapticFeedback?.notificationOccurred?.('error');}
    finally{busy=false;updateLeaveButton(false);}
  }
  function scheduleAutoJoin(seconds=1) {
    if (!played() || left() || autoJoinTimer || !roomId) return;
    autoJoinTimer=setTimeout(()=>{autoJoinTimer=null;autoJoin();},Math.max(700,(Number(seconds)||1)*1000+250));
  }
  async function autoJoin() {
    if (!played() || left() || busy || !roomId) return;
    const input=q('bjBet'); const bet=input?.value||sessionStorage.getItem('bika_bj_bet_v1')||'50'; if(input)input.value=bet;
    try { busy=true; await api('/api/mini/blackjack/join',{roomId,bet}); sessionStorage.setItem('bika_bj_bet_v1',String(bet)); html('bjResult','🔥 <b>Next Round</b> — နောက်တစ်ပွဲကို အလိုအလျောက် Join ဝင်ပြီးပါပြီ။'); tg?.HapticFeedback?.impactOccurred?.('light'); }
    catch(err){if(!/table player ပြည့်|BJ_TABLE_FULL|round စပြီး|BJ_ALREADY_STARTED|table မတွေ့/i.test(String(err.message||err)))html('bjResult',`⚠️ Next Round auto-join မအောင်မြင်ပါ — ${String(err.message||err)}`);}
    finally{busy=false;}
  }
  async function poll() {
    if(!initData || document.querySelector('.panel.active')?.id!=='blackjack')return;
    const u=new URLSearchParams(location.search); const start=tg?.initDataUnsafe?.start_param||u.get('tgWebAppStartParam')||u.get('startapp')||'';
    if(!roomId&&/^wbj_/i.test(String(start)))roomId=String(start).replace(/^wbj_/i,''); if(!roomId)return;
    try { const data=await api('/api/mini/blackjack/status',{roomId}); const room=data.room; if(!room)return; ensureControls(); updateLeaveButton(room.state==='playing'||room.state==='finished');
      if(room.state!==lastState){ if(room.state==='playing')setLeft(false); if(room.state==='finished'&&!left())scheduleAutoJoin(room.nextRoundSecondsLeft||5); lastState=room.state; }
      if(room.state==='lobby'&&!left()&&!room.me) scheduleAutoJoin(1);
    } catch(_){}
  }
  function init(){
    ensureControls();
    document.addEventListener('click',(e)=>{const btn=e.target.closest('#bjJoinBtn');if(btn&&q('bjBet')?.value){sessionStorage.setItem('bika_bj_bet_v1',q('bjBet').value);sessionStorage.setItem(playedKey,'1');setLeft(false);}});
    setInterval(()=>{ensureControls();poll();},1200); poll();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
