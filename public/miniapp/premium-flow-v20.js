/* BIKA GAME — Premium Flow v20
 * Transaction/result feedback rail. UI-only; observes existing fetch calls without changing API payloads.
 */
(function premiumFlowV20(){
  'use strict';
  if (window.__bikaFlowV20) return;
  window.__bikaFlowV20 = true;

  const API_PREFIX = '/api/mini/';
  const state = { active: 0, timer: null };
  const fmt = n => Number(n || 0).toLocaleString('en-US');
  const balanceKeys = ['balance','wallet','credits','coins','newBalance','new_balance'];

  function tg(){ return window.Telegram?.WebApp; }
  function haptic(kind){
    try {
      const h = tg()?.HapticFeedback;
      if (!h) return;
      if (kind === 'error') h.notificationOccurred?.('error');
      else if (kind === 'success') h.notificationOccurred?.('success');
      else h.impactOccurred?.('light');
    } catch (_) {}
  }

  function ensure(){
    let el = document.getElementById('v20-feedback');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'v20-feedback';
    el.setAttribute('role','status');
    el.setAttribute('aria-live','polite');
    el.innerHTML = '<span class="v20-dot"></span><b class="v20-title">READY</b><span class="v20-detail"></span>';
    document.body.appendChild(el);
    return el;
  }

  function show(title, detail = '', type = 'busy', ttl = 1800){
    const el = ensure();
    el.className = `v20-feedback is-${type}`;
    el.querySelector('.v20-title').textContent = title;
    el.querySelector('.v20-detail').textContent = detail;
    clearTimeout(state.timer);
    if (ttl > 0) state.timer = setTimeout(() => el.classList.remove('is-visible'), ttl);
    requestAnimationFrame(() => el.classList.add('is-visible'));
  }

  function gameFromPath(path){
    const p = String(path || '').toLowerCase();
    if (p.includes('blackjack') || p.includes('/bj')) return 'BLACKJACK';
    if (p.includes('shan') || p.includes('skm')) return 'SHAN';
    if (p.includes('crash') || p.includes('rocket')) return 'ROCKET';
    if (p.includes('slot')) return 'SLOT';
    if (p.includes('plinko')) return 'PLINKO';
    if (p.includes('wheel')) return 'WHEEL';
    if (p.includes('mine')) return 'MINES';
    return 'GAME';
  }

  function findBalance(value, depth = 0){
    if (!value || depth > 2 || typeof value !== 'object') return null;
    for (const k of balanceKeys) {
      if (Object.prototype.hasOwnProperty.call(value,k) && Number.isFinite(Number(value[k]))) return Number(value[k]);
    }
    for (const k of ['user','player','wallet','data','result']) {
      if (value[k] && typeof value[k] === 'object') {
        const found = findBalance(value[k], depth + 1);
        if (found !== null) return found;
      }
    }
    return null;
  }

  function syncBalance(data){
    const value = findBalance(data);
    if (value === null) return;
    const existing = document.getElementById('balanceText')?.textContent || '';
    const match = existing.match(/\s([^\d\s][^\d]*)$/);
    const suffix = match ? ` ${match[1].trim()}` : '';
    const text = `${fmt(value)}${suffix}`;
    ['balanceText','stickyBalanceText','v164WalletValue','v163ProfileBalance'].forEach(id=>{
      const el=document.getElementById(id);
      if (el) el.textContent=text;
    });
  }

  async function inspectResponse(response, path, started){
    if (!response || !String(path).includes(API_PREFIX)) return response;
    const elapsed = Math.max(0, Math.round(performance.now() - started));
    let data = null;
    try { data = await response.clone().json(); } catch (_) {}
    const failed = !response.ok || data?.ok === false;
    const game = gameFromPath(path);
    if (failed) {
      const msg = data?.message || data?.error || 'Request failed';
      show('ACTION FAILED', `${game} • ${msg}`, 'error', 2600);
      haptic('error');
    } else {
      syncBalance(data);
      show('ACTION COMPLETE', `${game} • ${elapsed}ms`, 'success', 1300);
      haptic('success');
    }
    window.dispatchEvent(new CustomEvent('bika:api-result',{detail:{path,ok:!failed,data,elapsed}}));
    return response;
  }

  function wrapFetch(){
    if (window.__bikaFetchV20Wrapped) return;
    const original = window.fetch.bind(window);
    window.fetch = async function(input, init){
      const path = typeof input === 'string' ? input : input?.url || '';
      const isApi = String(path).includes(API_PREFIX);
      const started = performance.now();
      if (isApi) {
        state.active += 1;
        show('PROCESSING', `${gameFromPath(path)} • please wait`, 'busy', 0);
      }
      try {
        const response = await original(input, init);
        if (isApi) inspectResponse(response, path, started).catch(()=>null);
        return response;
      } catch (err) {
        if (isApi) {
          show('NETWORK ERROR', `${gameFromPath(path)} • connection failed`, 'error', 2600);
          haptic('error');
          window.dispatchEvent(new CustomEvent('bika:api-result',{detail:{path,ok:false,error:err}}));
        }
        throw err;
      } finally {
        if (isApi) state.active = Math.max(0, state.active - 1);
      }
    };
    window.__bikaFetchV20Wrapped = true;
  }

  function bind(){
    wrapFetch();
    document.addEventListener('click', e => {
      const btn = e.target.closest?.('button,[role="button"]');
      if (!btn || btn.closest('#soundDock') || btn.id === 'v20-feedback') return;
      if (btn.disabled) return;
      btn.classList.add('v20-pressed');
      setTimeout(() => btn.classList.remove('v20-pressed'), 180);
    }, {passive:true});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',bind,{once:true});
  else bind();
})();
