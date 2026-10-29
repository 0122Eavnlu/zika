import { initAppearance } from './appearance.js';
import { initSettings } from './settings.js';
import { initCards } from './cards.js';
import { initChat } from './chat.js';
import { initCall, hideCall } from './call.js';
import { initStatus } from './status.js';
import { bindBackButtons, open, close, currentScreen } from './router.js';
import { closeSheet } from './ui.js';
import { $, $$ } from './util.js';

const WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function tickClock() {
  const now = new Date();
  const clock = $('#clock');
  const date = $('#date');
  if (clock) clock.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (date) date.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日　${WEEK[now.getDay()]}`;
}

function bindHome() {
  $$('.app[data-app]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (navigator.vibrate) navigator.vibrate(4);
      open(btn.dataset.app);
    });
  });
}

function splash() {
  const el = $('#splash');
  if (!el) return;
  const home = $('#home');
  const reveal = () => {
    home?.classList.add('ready');
  };
  let done = false;
  const hide = () => {
    if (done) return;
    done = true;
    reveal();
    el.classList.add('gone');
    setTimeout(() => el.remove(), 1100);
  };
  setTimeout(hide, 2800);
  el.addEventListener('click', hide);
}

function handleHistory() {
  history.pushState({ zika: true }, '');
  window.addEventListener('popstate', () => {
    const callLayer = $('#callLayer');
    if (callLayer && !callLayer.hidden) {
      hideCall();
      history.pushState({ zika: true }, '');
      return;
    }
    const sheet = $('#sheetLayer');
    if (sheet && !sheet.hidden) {
      closeSheet();
      history.pushState({ zika: true }, '');
      return;
    }
    if (currentScreen()) {
      close();
      history.pushState({ zika: true }, '');
    }
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!/^(https?|wss?):$/.test(location.protocol)) return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

function boot() {
  initAppearance();
  initSettings();
  initCards();
  initChat();
  initCall();
  initStatus();
  bindHome();
  bindBackButtons();
  handleHistory();
  registerServiceWorker();
  tickClock();
  setInterval(tickClock, 15000);
  splash();

  window.addEventListener('load', tickClock);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
