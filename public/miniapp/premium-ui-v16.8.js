/* BIKA GAME — Premium Mini App UI v16.8
 * Interaction polish only. Existing game logic, IDs and API contracts stay intact.
 */
(() => {
  'use strict';

  const HAPTIC = window.Telegram?.WebApp?.HapticFeedback;
  const tap = (style = 'light') => {
    try { HAPTIC?.impactOccurred?.(style); } catch (_) {}
  };

  function markSelected(group, value) {
    group.forEach((button) => {
      const active = String(button.dataset.value ?? '') === String(value ?? '');
      button.classList.toggle('v168-selected', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function bindBetShortcuts(selector, inputSelector, attr) {
    const buttons = [...document.querySelectorAll(selector)];
    if (!buttons.length) return;
    const input = document.querySelector(inputSelector);
    const sync = () => markSelected(buttons, input?.value);
    buttons.forEach((button) => {
      const value = button.dataset[attr];
      button.dataset.value = value ?? '';
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => {
        requestAnimationFrame(sync);
        tap('light');
      }, { passive: true });
    });
    input?.addEventListener('input', sync, { passive: true });
    sync();
  }

  function enhanceButtons() {
    document.querySelectorAll('button').forEach((button) => {
      if (button.dataset.v168Bound) return;
      button.dataset.v168Bound = '1';
      button.addEventListener('pointerdown', () => {
        if (!button.disabled) tap('light');
      }, { passive: true });
    });
  }

  function observeResults() {
    const observer = new MutationObserver((records) => {
      records.forEach((record) => {
        const target = record.target?.closest?.('.result');
        if (!target || !record.addedNodes.length) return;
        target.classList.remove('v168-result-pulse');
        requestAnimationFrame(() => target.classList.add('v168-result-pulse'));
      });
    });
    observer.observe(document.body, { subtree: true, childList: true });
  }

  function observeBalance() {
    const balance = document.getElementById('balanceText');
    if (!balance) return;
    const observer = new MutationObserver(() => {
      balance.classList.remove('v168-balance-flash');
      requestAnimationFrame(() => balance.classList.add('v168-balance-flash'));
    });
    observer.observe(balance, { childList: true, characterData: true, subtree: true });
  }

  function init() {
    enhanceButtons();
    bindBetShortcuts('[data-crash-bet]', '#crashBet', 'crashBet');
    bindBetShortcuts('[data-slot-bet]', '#slotBet', 'slotBet');
    bindBetShortcuts('[data-bj-bet]', '#bjBet', 'bjBet');
    bindBetShortcuts('[data-shan-bet]', '#shanBet', 'shanBet');
    bindBetShortcuts('[data-plinko-bet]', '#plinkoBet', 'plinkoBet');
    bindBetShortcuts('[data-wheel-bet]', '#wheelBet', 'wheelBet');
    bindBetShortcuts('[data-mines-bet]', '#minesBet', 'minesBet');
    observeResults();
    observeBalance();

    const bodyObserver = new MutationObserver(() => enhanceButtons());
    bodyObserver.observe(document.body, { subtree: true, childList: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
