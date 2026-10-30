import { initAppearance } from './appearance.js?v=20261030i';
import { initSettings } from './settings.js?v=20261030i';
import { initCards } from './cards.js?v=20261030i';
import { initChat } from './chat.js?v=20261030i';
import { initCall, hideCall } from './call.js?v=20261030i';
import { initStatus } from './status.js?v=20261030i';
import { initMoments } from './moments.js?v=20261030i';
import { initMusic, hideQrModal, openMusic } from './music.js?v=20261030i';
import { bindBackButtons, open, close, currentScreen } from './router.js?v=20261030i';
import { closeSheet } from './ui.js?v=20261030i';
import { $, $$, setAvatar, toast, pickFile, compressImage } from './util.js?v=20261030i';
import { get, subscribe, commit } from './state.js?v=20261030i';
import { openMeSheet } from './chat.js?v=20261030i';

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

  const cover = $('#homeCover');
  if (cover) {
    const img = s.ui.homeCover || s.ui.homeBg || '';
    if (img) {
      cover.style.backgroundImage = `url("${img}")`;
      cover.classList.add('has-img');
    } else {
      cover.style.backgroundImage = '';
      cover.classList.remove('has-img');
    }
  }

  setAvatar($('#homeAvatarView'), s.me.name, s.me.avatar);
  const name = $('#homeName');
  if (name) name.textContent = s.me.name || '我';
  const status = $('#homeStatus');
  if (status) status.textContent = s.me.status || '添加状态';

  const pin = $('#homePin');
  if (pin) {
    if (s.ui.homePin) {
      pin.style.backgroundImage = `url("${s.ui.homePin}")`;
      pin.classList.add('has-img');
    } else {
      pin.style.backgroundImage = '';
      pin.classList.remove('has-img');
    }
  }

  updateClock();
}

const WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  if ($('#clock')) $('#clock').textContent = `${hh}:${mm}`;
  if ($('#date')) $('#date').textContent = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
  if ($('#homeWeek')) $('#homeWeek').textContent = WEEK[now.getDay()];
  $$('#homeWeekRow span').forEach((el, i) => el.classList.toggle('today', i === now.getDay()));
}

async function pickHomeImage() {
  const file = await pickFile('image/*', false);
  if (!file) return '';
  try {
    return await compressImage(file, 1280, .82);
  } catch {
    return '';
  }
}

function bindHome() {
  $('#homeCover')?.addEventListener('click', async () => {
    const url = await pickHomeImage();
    if (!url) return;
    commit(s => {
      s.ui.homeCover = url;
      s.ui.homeBg = url;
    });
    renderHome();
    toast('已更换封面');
  });
  $('#homePin')?.addEventListener('click', async () => {
    const url = await pickHomeImage();
    if (!url) return;
    commit(s => { s.ui.homePin = url; });
    renderHome();
    toast('已更换图片');
  });
  $('#homeAvatar')?.addEventListener('click', () => openMeSheet());
  $('#homeStatusBtn')?.addEventListener('click', () => openMeSheet());
  $$('.app[data-app]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (navigator.vibrate) navigator.vibrate(4);
      if (btn.dataset.app === 'music') openMusic();
      else open(btn.dataset.app);
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
    const qrModal = $('#qrModal');
    if (qrModal && !qrModal.hidden) {
      hideQrModal();
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
  navigator.serviceWorker.register('sw.js?v=20261030i', { updateViaCache: 'none' })
    .then(reg => reg.update().catch(() => {}))
    .catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    if (sessionStorage.getItem('zika.sw-reloaded')) return;
    sessionStorage.setItem('zika.sw-reloaded', '1');
    location.reload();
  });
}

function fitViewport() {
  const app = document.getElementById('app');
  const vv = window.visualViewport;
  if (!app || !vv || window.innerWidth >= 700) {
    if (app) { app.style.top = ''; app.style.bottom = ''; app.style.height = ''; }
    return;
  }
  const gap = window.innerHeight - vv.height;
  if (gap > 100) {
    app.style.top = `${vv.offsetTop}px`;
    app.style.bottom = 'auto';
    app.style.height = `${vv.height}px`;
    const scroll = document.getElementById('msgScroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  } else {
    app.style.top = '';
    app.style.bottom = '';
    app.style.height = '';
  }
}

function boot() {
  fitViewport();
  window.visualViewport?.addEventListener('resize', fitViewport);
  window.visualViewport?.addEventListener('scroll', fitViewport);
  window.addEventListener('resize', fitViewport);
  initAppearance();
  initSettings();
  initCards();
  initChat();
  initCall();
  initMoments();
  initMusic();
  initStatus();
  bindHome();
  bindBackButtons();
  handleHistory();
  registerServiceWorker();
  renderHome();
  setInterval(updateClock, 30000);
  subscribe(renderHome);
  splash();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
