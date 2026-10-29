import { initAppearance } from './appearance.js';
import { initSettings } from './settings.js';
import { initCards } from './cards.js';
import { initChat } from './chat.js';
import { initCall, hideCall } from './call.js';
import { initStatus } from './status.js';
import { bindBackButtons, open, close, currentScreen } from './router.js';
import { closeSheet } from './ui.js';
import { $, $$, setAvatar } from './util.js';
import { get, subscribe } from './state.js';

const WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function tickClock() {
  const now = new Date();
  const clock = $('#clock');
  const date = $('#date');
  if (clock) clock.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (date) date.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日　${WEEK[now.getDay()]}`;
}

function renderHome() {
  const s = get();
  const home = $('#home');
  const bgEl = $('#homeBg');
  if (bgEl) {
    if (s.ui.homeBg) {
      bgEl.style.backgroundImage = `url("${s.ui.homeBg}")`;
      bgEl.classList.remove('empty');
    } else {
      bgEl.style.backgroundImage = '';
      bgEl.classList.add('empty');
    }
  }
  home?.classList.toggle('has-bg', Boolean(s.ui.homeBg));

  const a = s.anniversary || {};
  const card = $('#annivCard');
  if (!card) return;
  const show = Boolean(a.enabled && a.date);
  card.hidden = !show;
  if (!show) return;

  setAvatar($('#annivMe'), s.me.name, s.me.avatar);
  setAvatar($('#annivThem'), s.persona.name, s.persona.avatar);
  $('#annivMeName').textContent = s.me.name || '我';
  $('#annivThemName').textContent = s.persona.name || '';
  const start = new Date(`${a.date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - start.getTime()) / 86400000));
  $('#annivDays').textContent = String(days);
  $('#annivDate').textContent = `${a.date.replace(/-/g, '.')} 起 · ${a.text || '我们在一起'}`;
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
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then(reg => reg.update().catch(() => {}))
    .catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    if (sessionStorage.getItem('zika.sw-reloaded')) return;
    sessionStorage.setItem('zika.sw-reloaded', '1');
    location.reload();
  });
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
  renderHome();
  subscribe(renderHome);
  setInterval(tickClock, 15000);
  splash();

  window.addEventListener('load', tickClock);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
