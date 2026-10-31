import { initAppearance } from './appearance.js?v=20261031p';
import { initSettings } from './settings.js?v=20261031p';
import { initCards } from './cards.js?v=20261031p';
import { initChat } from './chat.js?v=20261031p';
import { initCall, hideCall } from './call.js?v=20261031p';
import { initStatus } from './status.js?v=20261031p';
import { initMoments } from './moments.js?v=20261031p';
import { initMusic, hideQrModal, openMusic } from './music.js?v=20261031p';
import { bindBackButtons, open, close, currentScreen } from './router.js?v=20261031p';
import { openSheet, closeSheet, sheetTitle, promptSheet, actionSheet } from './ui.js?v=20261031p';
import { $, $$, setAvatar, toast, pickFile, compressImage, escapeHtml, uid } from './util.js?v=20261031p';
import { get, subscribe, commit } from './state.js?v=20261031p';
import { openMeSheet } from './chat.js?v=20261031p';

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
    const img = (s.ui.homeCover || '').replace(/([?&]param=)\d+y\d+/i, (m, key) => `${key}1024y1024`);
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
    const img2 = s.ui.homeCover2 || s.ui.homeCover || '';
    if (img2) {
      hp2.style.backgroundImage = `url("${img2}")`;
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
  if (status) status.textContent = s.me.status || '添加个性签名';

  renderPins(s);

  renderHomeMsgs(s);

  renderWidgets(s);
  updateHomeDots();
  updateClock();
}

const PINS_MAX = 2;
const PIN_CLIP = `<span class="pin-clip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16.6 8.6l-6.2 6.2a2.3 2.3 0 0 0 3.3 3.3l6.3-6.3a4.3 4.3 0 0 0-6.1-6.1l-7.3 7.3a6.3 6.3 0 0 0 8.9 8.9l5.8-5.8"/></svg></span>`;

function renderPins(s) {
  const box = $('#homePins');
  if (!box) return;
  const pins = s.ui.pins || [];
  if (!pins.length) {
    box.style.height = '148px';
    box.innerHTML = `
      <div class="polaroid" data-pin="add" style="--rot:-6deg;z-index:1">
        <button class="pin-card" aria-label="添加照片"><span class="pin-empty">＋</span></button>
        <span class="pin-caption">添加签名</span>
      </div>`;
    return;
  }
  box.style.height = pins.length > 1 ? '172px' : '148px';
  box.innerHTML = pins.map((p, i) => `
    <div class="polaroid" data-pin="${p.id}" style="--rot:${Number(p.rot) || 0}deg;z-index:${i + 1}">
      ${i === pins.length - 1 ? PIN_CLIP : ''}
      <button class="pin-card ${p.img ? 'has-img' : ''}" style="${p.img ? `background-image:url(&quot;${p.img.replace(/"/g, '%22')}&quot;)` : ''}"><span class="pin-empty">＋</span></button>
      <span class="pin-caption">${escapeHtml(p.caption || '添加签名')}</span>
    </div>`).join('');
}

function pinActions(id) {
  const actions = [
    { label: '更换图片', onClick: () => changePinImage(id) },
    { label: '修改签名', onClick: () => editPinCaption(id) },
    { label: '换个角度', onClick: () => rotatePin(id) },
  ];
  if ((get().ui.pins || []).length < PINS_MAX) {
    actions.push({ label: '再加一张拍立得', onClick: () => addPin() });
  }
  actions.push({ label: '删除这张', danger: true, onClick: () => removePin(id) });
  actionSheet('拍立得', actions);
}

async function addPin() {
  if ((get().ui.pins || []).length >= PINS_MAX) {
    toast('最多两张');
    return;
  }
  const url = await pickHomeImage();
  if (!url) return;
  const n = (get().ui.pins || []).length;
  commit(s => {
    s.ui.pins = [...(s.ui.pins || []), { id: uid(), img: url, caption: '', rot: n ? 5 : -6 }];
  });
  renderHome();
}

async function changePinImage(id) {
  const url = await pickHomeImage();
  if (!url) return;
  commit(s => {
    const p = (s.ui.pins || []).find(x => x.id === id);
    if (p) p.img = url;
  });
  renderHome();
  toast('已更换');
}

async function editPinCaption(id) {
  const p = (get().ui.pins || []).find(x => x.id === id);
  const value = await promptSheet({
    title: '拍立得签名',
    value: p?.caption || '',
    placeholder: '写一句给这张照片的话',
    maxlength: 30,
  });
  if (value == null) return;
  commit(s => {
    const t = (s.ui.pins || []).find(x => x.id === id);
    if (t) t.caption = value.trim();
  });
  renderHome();
}

function rotatePin(id) {
  commit(s => {
    const p = (s.ui.pins || []).find(x => x.id === id);
    if (!p) return;
    let r = (Number(p.rot) || 0) + 4;
    if (r > 8) r = -8;
    p.rot = r;
  });
  renderHome();
}

function removePin(id) {
  commit(s => { s.ui.pins = (s.ui.pins || []).filter(p => p.id !== id); });
  renderHome();
}

function tapPin(id) {
  if (id === 'add') {
    addPin();
    return;
  }
  const pins = get().ui.pins || [];
  const idx = pins.findIndex(p => p.id === id);
  if (idx < 0) return;
  if (idx < pins.length - 1) {
    commit(s => {
      const list = s.ui.pins.slice();
      const [item] = list.splice(idx, 1);
      list.push(item);
      s.ui.pins = list;
    });
    renderHome();
    return;
  }
  pinActions(id);
}

function renderHomeMsgs(s) {
  const left = $('#hp2MsgL');
  const right = $('#hp2MsgR');
  if (left) {
    const text = (s.ui.homeMsgLeft || '').trim();
    left.textContent = text || '点我输入';
    left.classList.toggle('empty', !text);
  }
  if (right) {
    const text = (s.ui.homeMsgRight || '').trim();
    right.textContent = text || '点我输入';
    right.classList.toggle('empty', !text);
  }
  setAvatar($('#hp2MsgAvL'), s.persona.name, s.persona.avatar);
  setAvatar($('#hp2MsgAvR'), s.me.name, s.me.avatar);
}

async function editHomeMsg(side) {
  const isLeft = side === 'left';
  const current = isLeft ? get().ui.homeMsgLeft : get().ui.homeMsgRight;
  const value = await promptSheet({
    title: isLeft ? '左边这句话' : '右边这句话',
    value: current || '',
    placeholder: '写一句话，留空则显示「点我输入」',
    maxlength: 40,
  });
  if (value == null) return;
  commit(s => {
    if (isLeft) s.ui.homeMsgLeft = value.trim();
    else s.ui.homeMsgRight = value.trim();
  });
  renderHome();
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
    pager.classList.add('dragging');
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
    pager.classList.remove('dragging');
    const t = event.changedTouches[0];
    pager.style.transition = '';
    if (!t || !dragging) {
      dragging = false;
      setHomePage(homePage, true);
      return;
    }
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    dragging = false;
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
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

function commitAnniv(date, text) {
  commit(s => {
    s.anniversary.date = date;
    s.anniversary.text = text || '我们在一起';
  });
  renderHome();
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

function openFavSheet() {
  const favs = () => get().favorites || { his: [], mine: [] };
  const rows = list => list.length
    ? list.map(item => `
        <div class="fav-row">
          <span class="fav-kind">${item.kind === 'sticker' ? '表情' : item.kind === 'moment' ? '朋友圈' : '消息'}</span>
          ${item.url
            ? `<img class="fav-img" src="${escapeHtml(item.url)}" alt="">`
            : `<span class="fav-text">${escapeHtml(item.text || '')}</span>`}
        </div>`).join('')
    : '<p class="fav-empty">还没有收藏</p>';
  openSheet(`
    ${sheetTitle('收藏')}
    <div class="fav-tabs">
      <button class="fav-tab active" data-favtab="his">他的收藏</button>
      <button class="fav-tab" data-favtab="mine">我的收藏</button>
    </div>
    <div class="fav-list" id="favList">${rows(favs().his)}</div>
  `);
  $$('.fav-tab').forEach(btn => {
    btn.onclick = () => {
      $$('.fav-tab').forEach(b => b.classList.toggle('active', b === btn));
      $('#favList').innerHTML = rows(favs()[btn.dataset.favtab]);
    };
  });
}

function bindHome() {
  bindPager();
  $('#hp2Anniv')?.addEventListener('click', openAnnivSheet);
  $('#hp2MsgL')?.addEventListener('click', () => editHomeMsg('left'));
  $('#hp2MsgR')?.addEventListener('click', () => editHomeMsg('right'));
  $('#hp2Cover')?.addEventListener('click', async () => {
    const url = await pickHomeImage();
    if (!url) return;
    commit(s => { s.ui.homeCover2 = url; });
    renderHome();
    toast('已更换第二页头像背景');
  });
  $('#homeCover')?.addEventListener('click', async () => {
    const url = await pickHomeImage();
    if (!url) return;
    commit(s => { s.ui.homeCover = url; });
    renderHome();
    toast('已更换封面');
  });
  $('#homePins')?.addEventListener('click', event => {
    const el = event.target.closest('.polaroid');
    if (!el) return;
    tapPin(el.dataset.pin);
  });
  $('#homeAvatar')?.addEventListener('click', () => openMeSheet());
  $('#homeName')?.addEventListener('click', () => openMeSheet());
  $('#homeBioEdit')?.addEventListener('click', () => openMeSheet());
  $('#homeStatus')?.addEventListener('click', () => openMeSheet());
  $('#homeFav')?.addEventListener('click', openFavSheet);
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
  navigator.serviceWorker.register('sw.js?v=20261031p', { updateViaCache: 'none' })
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

function initKeepAlive() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  let ctx = null;
  let started = false;
  const ensure = () => {
    try {
      if (!ctx) {
        ctx = new AC();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.0015;
        osc.frequency.value = 24;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        started = true;
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    } catch {}
  };
  const kick = () => ensure();
  ['pointerdown', 'touchstart', 'keydown'].forEach(name => {
    document.addEventListener(name, kick, { once: true, passive: true });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && started) ensure();
  });
}

function boot() {
  fitViewport();
  window.visualViewport?.addEventListener('resize', fitViewport);
  window.visualViewport?.addEventListener('scroll', fitViewport);
  window.addEventListener('resize', fitViewport);
  initKeepAlive();
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
