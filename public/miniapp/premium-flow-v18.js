/* BIKA GAME — Premium Flow v18
 * Non-invasive UI state coordination for existing game handlers.
 * Does not change API contracts or game logic.
 */
(function premiumFlowV18(){
  'use strict';
  const ACTION_SELECTOR = 'button, [role="button"]';
  const BUSY_RE = /^(loading|joining|cash out|sp\.\.\.|spinning|dealing|drawing|staying|creating|joining|starting|placing|checking|opening|rolling|revealing|processing|collecting|betting)/i;
  const ERROR_RE = /(error|failed|invalid|insufficient|not enough|cannot|unable|expired|crashed|lose|lost|rejected)/i;
  const SUCCESS_RE = /(success|won|win|cash out|cashed out|paid|payout|jackpot|profit|collected)/i;

  function isActionButton(el){
    return el && el.matches && el.matches(ACTION_SELECTOR) && !el.closest('#soundDock');
  }

  function syncButton(el){
    if (!isActionButton(el)) return;
    const text = String(el.textContent || '').trim();
    const busy = !!el.disabled && BUSY_RE.test(text);
    el.classList.toggle('flow-busy', busy);
    el.classList.toggle('flow-ready', !el.disabled && !busy);
    el.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function syncResult(el){
    if (!el || !el.textContent) return;
    const text = String(el.textContent).trim();
    if (!text) return;
    const error = ERROR_RE.test(text);
    const success = !error && SUCCESS_RE.test(text);
    el.classList.toggle('flow-error', error);
    el.classList.toggle('flow-success', success);
    if (error || success) el.classList.add('flow-has-result');
  }

  function syncAll(root=document){
    root.querySelectorAll(ACTION_SELECTOR).forEach(syncButton);
    root.querySelectorAll('.result, [id$="Result"], [id$="Status"], .history-item').forEach(syncResult);
  }

  function bind(){
    syncAll();
    document.addEventListener('click', (event) => {
      const button = event.target.closest?.(ACTION_SELECTOR);
      if (!button || !isActionButton(button)) return;
      button.classList.add('flow-pressed');
      window.setTimeout(() => button.classList.remove('flow-pressed'), 180);
    }, { passive:true });

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.target instanceof Element) {
          if (mutation.attributeName === 'disabled' || mutation.attributeName === 'class' || mutation.attributeName === 'aria-busy') syncButton(mutation.target);
        }
        if (mutation.type === 'characterData' || mutation.type === 'childList') {
          const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
          if (target) {
            if (isActionButton(target)) syncButton(target);
            const result = target.closest?.('.result, [id$="Result"], [id$="Status"], .history-item');
            if (result) syncResult(result);
            target.querySelectorAll?.('.result, [id$="Result"], [id$="Status"], .history-item').forEach(syncResult);
          }
        }
      }
    });
    observer.observe(document.body, { subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['disabled','class','aria-busy'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once:true });
  else bind();
})();
