import { initAppearance } from './appearance.js?v=20261030f';
import { initSettings } from './settings.js?v=20261030f';
import { initCards } from './cards.js?v=20261030f';
import { initChat } from './chat.js?v=20261030f';
import { initCall, hideCall } from './call.js?v=20261030f';
import { initStatus } from './status.js?v=20261030f';
import { initMoments } from './moments.js?v=20261030f';
import { initMusic, hideQrModal, openMusic } from './music.js?v=20261030f';
import { bindBackButtons, open, close, currentScreen } from './router.js?v=20261030f';
import { openSheet, closeSheet, sheetTitle } from './ui.js?v=20261030f';
import { $, $$, setAvatar, toast, pickFile, compressImage } from './util.js?v=20261030f';
import { get, subscribe, commit } from './state.js?v=20261030f';
import { openMeSheet } from './chat.js?v=20261030f';

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

  const hp2 = $('#hp2Cover');
  if (hp2) {
    if (s.ui.homeCover) {
      hp2.style.backgroundImage = `url("${s.ui.homeCover}")`;
      hp2.classList.add('has-img');
    } else {
      hp2.style.backgroundImage = '';
      hp2.classList.remove('has-img');
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

  renderWidgets(s);
  updateClock();
  updateHomeDots();
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

function renderWidgets(s) {
  const a = s.anniversary || {};
  setAvatar($('#hp2Me'), s.me.name, s.me.avatar);
  setAvatar($('#hp2Them'), s.persona.name, s.persona.avatar);
  const days = $('#hp2Days');
  const foot = $('#hp2Date');
  if (!days || !foot) return;
  if (!a.date) {
    days.textContent = '—';
    foot.textContent = '点这里设置';
    return;
  }
  const start = new Date(`${a.date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const n = Math.max(0, Math.floor((today.getTime() - start.getTime()) / 86400000));
  days.textContent = String(n);
  foot.textContent = `${a.date.replace(/-/g, '.')} 起 · ${a.text || '我们在一起'}`;
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

let homePage = 0;

function setHomePage(next, animate = true) {
  homePage = Math.max(0, Math.min(1, next));
  const pager = $('#homePager');
  if (!pager) return;
  const w = pager.offsetWidth / 2 || window.innerWidth;
  pager.style.transition = animate ? '' : 'none';
  pager.style.transform = `translate3d(${-homePage * w}px, 0, 0)`;
  if (!animate) {
    requestAnimationFrame(() => { pager.style.transition = ''; });
  }
  updateHomeDots();
}

function updateHomeDots() {
  $$('#homeDots .dot').forEach(d => {
    d.classList.toggle('active', Number(d.dataset.hpage) === homePage);
  });
}

function bindPager() {
  const pager = $('#homePager');
  if (!pager) return;
  setHomePage(0, false);
  let sx = 0;
  let sy = 0;
  let base = 0;
  let dragging = false;
  let suppressClick = false;

  pager.addEventListener('touchstart', event => {
    if (event.touches.length !== 1) return;
    sx = event.touches[0].clientX;
    sy = event.touches[0].clientY;
    base = -homePage * (pager.offsetWidth / 2 || window.innerWidth);
    dragging = false;
    pager.style.transition = 'none';
  }, { passive: true });

  pager.addEventListener('touchmove', event => {
    if (event.touches.length !== 1) return;
    const t = event.touches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (!dragging) {
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.1) return;
      dragging = true;
    }
    const w = pager.offsetWidth / 2 || window.innerWidth;
    let move = dx;
    if ((homePage === 0 && dx > 0) || (homePage === 1 && dx < 0)) move = dx * .32;
    const x = Math.min(0, Math.max(-w, base + move));
    pager.style.transform = `translate3d(${x}px, 0, 0)`;
  }, { passive: true });

  pager.addEventListener('touchend', event => {
    const t = event.changedTouches[0];
    pager.style.transition = '';
    if (!t || !dragging) {
      dragging = false;
      setHomePage(homePage, true);
      return;
    }
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    const wasDrag = dragging;
    dragging = false;
    if (wasDrag && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 350);
    }
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 55) {
      setHomePage(homePage + (dx < 0 ? 1 : -1), true);
    } else {
      setHomePage(homePage, true);
    }
  }, { passive: true });

  pager.addEventListener('click', event => {
    if (!suppressClick) return;
    suppressClick = false;
    event.stopPropagation();
    event.preventDefault();
  }, true);

  $$('#homeDots .dot').forEach(dot => {
    dot.addEventListener('click', () => setHomePage(Number(dot.dataset.hpage)));
  });
}

function bindHome() {
  bindPager();
  $('#hp2Anniv')?.addEventListener('click', openAnnivSheet);
  $('#hp2Cover')?.addEventListener('click', async () => {
    const url = await pickHomeImage();
    if (!url) return;
    commit(s => { s.ui.homeCover = url; });
    renderHome();
    toast('已更换封面');
  });
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
  navigator.serviceWorker.register('sw.js?v=20261030f', { updateViaCache: 'none' })
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
