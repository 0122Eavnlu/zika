import { initAppearance } from './appearance.js?v=20261030d';
import { initSettings } from './settings.js?v=20261030d';
import { initCards } from './cards.js?v=20261030d';
import { initChat } from './chat.js?v=20261030d';
import { initCall, hideCall } from './call.js?v=20261030d';
import { initStatus } from './status.js?v=20261030d';
import { initMoments } from './moments.js?v=20261030d';
import { initMusic, hideQrModal } from './music.js?v=20261030d';
import { bindBackButtons, open, close, currentScreen } from './router.js?v=20261030d';
import { openSheet, closeSheet, sheetTitle } from './ui.js?v=20261030d';
import { $, $$, setAvatar, toast, pickFile, compressImage } from './util.js?v=20261030d';
import { get, subscribe, commit } from './state.js?v=20261030d';
import { openMeSheet } from './chat.js?v=20261030d';

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

  const a = s.anniversary || {};
  const card = $('#annivCard');
  if (!card) return;
  const show = Boolean(a.enabled);
  card.hidden = !show;
  if (!show) return;

  setAvatar($('#annivMe'), s.me.name, s.me.avatar);
  setAvatar($('#annivThem'), s.persona.name, s.persona.avatar);
  $('#annivMeName').textContent = s.me.name || '我';
  $('#annivThemName').textContent = s.persona.name || '';
  if (!a.date) {
    $('#annivDays').textContent = '—';
    $('#annivDate').textContent = '点这里设置纪念日';
    return;
  }
  const start = new Date(`${a.date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((today.getTime() - start.getTime()) / 86400000));
  $('#annivDays').textContent = String(days);
  $('#annivDate').textContent = `${a.date.replace(/-/g, '.')} 起 · ${a.text || '我们在一起'}`;
}

function openAnnivSheet() {
  const a = get().anniversary || {};
  openSheet(`
    ${sheetTitle('纪念日')}
    <div class="field"><input class="input" type="date" id="annivDateInput" value="${a.date || ''}"></div>
    <div class="field"><input class="input" id="annivTextInput" maxlength="20" placeholder="我们在一起" value="${(a.text || '').replace(/"/g, '&quot;')}"></div>
    <div class="sheet-actions">
      <button class="btn-ghost" id="annivCancel">取消</button>
      <button class="btn-ink" id="annivSave">保存</button>
    </div>
  `);
  $('#annivCancel').onclick = closeSheet;
  $('#annivSave').onclick = () => {
    const date = $('#annivDateInput').value;
    const text = $('#annivTextInput').value.trim();
    if (!date) {
      toast('请选择开始日期');
      return;
    }
    commitAnniv(date, text);
    closeSheet();
    toast('已保存');
  };
}

function commitAnniv(date, text) {
  commit(s => {
    s.anniversary.date = date;
    s.anniversary.text = text || '我们在一起';
  });
  renderHome();
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
  $('#annivCard')?.addEventListener('click', openAnnivSheet);
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
  navigator.serviceWorker.register('sw.js?v=20261030d', { updateViaCache: 'none' })
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
  subscribe(renderHome);
  splash();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
