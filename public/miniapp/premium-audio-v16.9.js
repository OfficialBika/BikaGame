/* BikaGame Premium Audio v16.9
 * Coordinates the existing AudioFX engine without replacing game logic.
 * Defaults app music + SFX controls to 100% on first use, keeps mute preference,
 * unlocks audio on the first user gesture, and exposes a small persistent volume UX.
 */
(function premiumAudioV169(){
  'use strict';
  const MUSIC_KEY = 'bika_audio_music_v13';
  const SFX_KEY = 'bika_audio_sfx_v13';
  const FIRST_USE_KEY = 'bika_audio_volume_initialized_v169';

  function setSlider(id, value){
    const el = document.getElementById(id);
    if (!el) return false;
    el.value = String(value);
    el.setAttribute('aria-valuenow', String(value));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function ensureVolume(){
    const initialized = localStorage.getItem(FIRST_USE_KEY) === '1';
    if (!initialized) {
      localStorage.setItem(MUSIC_KEY, '100');
      localStorage.setItem(SFX_KEY, '100');
      localStorage.setItem(FIRST_USE_KEY, '1');
    }
    setSlider('musicVolume', Number(localStorage.getItem(MUSIC_KEY) || 100));
    setSlider('sfxVolume', Number(localStorage.getItem(SFX_KEY) || 100));
  }

  function decorate(){
    const music = document.getElementById('musicVolume');
    const sfx = document.getElementById('sfxVolume');
    [music, sfx].forEach((el) => {
      if (!el) return;
      el.min = '0';
      el.max = '100';
      el.step = '1';
      el.setAttribute('aria-label', el.id === 'musicVolume' ? 'Music volume, 0 to 100 percent' : 'Sound effects volume, 0 to 100 percent');
      el.addEventListener('change', () => {
        el.setAttribute('aria-valuenow', String(el.value));
      });
    });
    const dock = document.getElementById('soundDock');
    if (dock) dock.dataset.audioVersion = 'v16.9';
  }

  function unlock(){
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx && window.__bikaAudioContext && window.__bikaAudioContext.state === 'suspended') {
        window.__bikaAudioContext.resume().catch(() => null);
      }
    } catch (_) {}
    document.removeEventListener('pointerdown', unlock, true);
    document.removeEventListener('touchstart', unlock, true);
  }

  function boot(){
    decorate();
    ensureVolume();
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('touchstart', unlock, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
