import { initAppearance } from './appearance.js?v=20261101BF';
import { initSettings } from './settings.js?v=20261101BF';
import { initCards } from './cards.js?v=20261101BF';
import { initChat } from './chat.js?v=20261101BF';
import { initCall, hideCall } from './call.js?v=20261101BF';
import { initStatus, openStatusSheet } from './status.js?v=20261101BF';
import { initMoments } from './moments.js?v=20261101BF';
import { initMusic, hideQrModal, openMusic } from './music.js?v=20261101BF';
import { initLetters } from './letters.js?v=20261101BF';
import { bindBackButtons, open, close, currentScreen } from './router.js?v=20261101BF';
import { openSheet, closeSheet, sheetTitle, promptSheet, actionSheet } from './ui.js?v=20261101BF';
import { $, $$, setAvatar, toast, pickFile, compressImage, escapeHtml, uid } from './util.js?v=20261101BF';
import { get, subscribe, commit } from './state.js?v=20261101BF';
import { openMeSheet } from './chat.js?v=20261101BF';

/* 首页重绘缓存：避免每次都把同一张超大的 base64 重新赋给 style，
   反复赋值会让移动端整块重排、非常卡。 */
let lastHomeBg = null;
let lastCover = null;
let lastHp2Cover = null;

function renderHome() {
  const s = get();
  const home = $('#home');
  const bgEl = $('#homeBg');
  if (bgEl) {
    const bg = s.ui.homeBg || '';
    if (bg !== lastHomeBg) {
      lastHomeBg = bg;
      bgEl.style.backgroundImage = bg ? `url("${bg}")` : '';
      bgEl.classList.toggle('empty', !bg);
    }
  }
  home?.classList.toggle('has-bg', Boolean(s.ui.homeBg));

  const cover = $('#homeCover');
  if (cover) {
    const img = (s.ui.homeCover || '').replace(/([?&]param=)\d+y\d+/i, (m, key) => `${key}1024y1024`);
    if (img !== lastCover) {
      lastCover = img;
      cover.style.backgroundImage = img ? `url("${img}")` : '';
      cover.classList.toggle('has-img', Boolean(img));
    }
  }

  const hp2 = $('#hp2Cover');
  if (hp2) {
    const img2 = s.ui.homeCover2 || '';
    if (img2 !== lastHp2Cover) {
      lastHp2Cover = img2;
      hp2.style.backgroundImage = img2 ? `url("${img2}")` : '';
      hp2.classList.toggle('has-img', Boolean(img2));
    }
  }

  setAvatar($('#homeAvatarView'), s.me.name, s.me.avatar);
  const name = $('#homeName');
  if (name) name.textContent = s.me.name || '我';
  const status = $('#homeStatus');
  if (status) status.textContent = s.persona.status || '添加个性签名';
  const loc = $('#homeLoc');
  if (loc) loc.textContent = s.ui.homeLoc || '添加定位';

  renderPins(s);

  renderNotes(s);

  renderHomeMsgs(s);

  renderWeather();

  renderWidgets(s);
  updateHomeDots();
  updateClock();
}

/* 数据变动时不要立刻整页重绘首页：如果正开着别的页面（聊天 / 字卡等），
   只记一个标记，等回到首页再画一次，避免聊天里每发一条消息都重建首页而卡顿。 */
let homeDirty = false;
let homeRaf = 0;

function scheduleHomeRender() {
  if (homeRaf) {
    homeDirty = true;
    return;
  }
  homeRaf = requestAnimationFrame(() => {
    homeRaf = 0;
    if (currentScreen()) {
      homeDirty = true;
      return;
    }
    homeDirty = false;
    renderHome();
  });
}

const PINS_MAX = 2;
const PIN_CLIP = `<span class="pin-clip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16.6 8.6l-6.2 6.2a2.3 2.3 0 0 0 3.3 3.3l6.3-6.3a4.3 4.3 0 0 0-6.1-6.1l-7.3 7.3a6.3 6.3 0 0 0 8.9 8.9l5.8-5.8"/></svg></span>`;

let lastPinsKey = null;

function renderPins(s) {
  const box = $('#homePins');
  if (!box) return;
  const pins = s.ui.pins || [];
  const key = pins.map(p => `${p.id}|${p.img ? p.img.length : 0}|${p.caption || ''}|${Number(p.rot) || 0}`).join('~');
  if (key === lastPinsKey && box.childElementCount) return;
  lastPinsKey = key;
  if (!pins.length) {
    box.style.height = 'var(--pins-h, 116px)';
    box.innerHTML = `
      <div class="polaroid" data-pin="add" style="--rot:-6deg;z-index:1">
        <button class="pin-card" aria-label="添加照片"><span class="pin-empty">＋</span></button>
        <span class="pin-caption">添加签名</span>
      </div>`;
    return;
  }
  box.style.height = 'var(--pins-h, 116px)';
  box.innerHTML = pins.map((p, i) => `
    <div class="polaroid" data-pin="${p.id}" style="--rot:${Number(p.rot) || 0}deg;z-index:${i + 1}">
      ${i === pins.length - 1 ? PIN_CLIP : ''}
      <button class="pin-card ${p.img ? 'has-img' : ''}" style="${p.img ? `background-image:url(&quot;${p.img.replace(/"/g, '%22')}&quot;)` : ''}"><span class="pin-empty">＋</span></button>
      <span class="pin-caption">${escapeHtml(p.caption || '添加签名')}</span>
    </div>`).join('');
}

function renderNotes(s) {
  const lines = $('#homeNoteLines');
  if (!lines) return;
  const notes = s.ui.homeNotes || [];
  lines.innerHTML = notes.length
    ? notes.map(t => `<div class="note-line">${escapeHtml(t)}</div>`).join('')
    : '<div class="note-line empty">写点什么，放在这里</div>';
}

function openNotesEditor() {
  let draft = [...(get().ui.homeNotes || [])];
  const collect = () => {
    $$('#sheet [data-note-input]').forEach(inp => { draft[Number(inp.dataset.noteInput)] = inp.value; });
  };
  const draw = () => {
    openSheet(`
      ${sheetTitle('小字条')}
      <div class="note-editor">
        ${draft.length ? draft.map((t, i) => `
          <div class="note-row">
            <input class="input" data-note-input="${i}" value="${escapeHtml(t)}" placeholder="写一句话" maxlength="80">
            <button class="note-del" data-note-del="${i}" aria-label="删除">×</button>
          </div>`).join('') : '<div class="card-empty">还没有内容</div>'}
      </div>
      <div class="sheet-actions">
        <button class="btn-ghost" id="noteAdd">添加一条</button>
        <button class="btn-ink" id="noteSave">保存</button>
      </div>
    `);
    $$('#sheet [data-note-del]').forEach(btn => {
      btn.onclick = () => {
        collect();
        draft.splice(Number(btn.dataset.noteDel), 1);
        draw();
      };
    });
    $('#noteAdd').onclick = () => {
      collect();
      draft.push('');
      draw();
    };
    $('#noteSave').onclick = () => {
      collect();
      const clean = draft.map(t => t.trim()).filter(Boolean);
      commit(s => { s.ui.homeNotes = clean; });
      renderHome();
      closeSheet();
    };
  };
  draw();
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
  const anniv = $('#hp2Anniv');
  const days = $('#hp2Days');
  const foot = $('#hp2Date');
  if (!days || !foot) return;
  if (anniv) {
    anniv.style.backgroundImage = a.bg ? `url("${a.bg}")` : '';
    anniv.classList.toggle('has-img', Boolean(a.bg));
  }
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

/* ---------- P3 天气（随机天气 + 随机地点，背景随天气切换） ---------- */
const WX_LOCATIONS = ['英国伦敦', '万甄集团', '安庆', '上海'];
const WX_CLOUD = `<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>`;
const WX_ICONS = {
  clear: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.8v2.2M12 19v2.2M2.8 12h2.2M19 12h2.2M5.5 5.5l1.6 1.6M16.9 16.9l1.6 1.6M18.5 5.5l-1.6 1.6M7.1 16.9l-1.6 1.6"/></svg>`,
  cloudy: `<svg viewBox="0 0 24 24">${WX_CLOUD}</svg>`,
  rain: `<svg viewBox="0 0 24 24">${WX_CLOUD}<path d="M8 21v-1M12 21v-1.4M16 21v-1"/></svg>`,
  storm: `<svg viewBox="0 0 24 24">${WX_CLOUD}<path d="M13 19.2l1.6-3.4h-3l1.5-3"/></svg>`,
  snow: `<svg viewBox="0 0 24 24">${WX_CLOUD}<path d="M8 21h.01M12 21h.01M16 21h.01"/></svg>`,
  fog: `<svg viewBox="0 0 24 24">${WX_CLOUD}<path d="M5.5 21h6M13 21h5.5"/></svg>`,
  night: `<svg viewBox="0 0 24 24"><path d="M20 13.6A8.1 8.1 0 1 1 10.4 4a6.4 6.4 0 0 0 9.6 9.6Z"/><path d="M5.4 5.2h.01M7.8 2.9h.01"/></svg>`,
};
const WX_TYPES = [
  { key: 'clear', label: '晴', min: 18, max: 30 },
  { key: 'cloudy', label: '多云', min: 12, max: 24 },
  { key: 'rain', label: '小雨', min: 10, max: 20 },
  { key: 'storm', label: '雷阵雨', min: 12, max: 22 },
  { key: 'snow', label: '小雪', min: -5, max: 4 },
  { key: 'fog', label: '雾', min: 7, max: 16 },
  { key: 'night', label: '晴间多云', min: 6, max: 15 },
];

let wxState = null;

function renderWeather() {
  const card = $('#wxCard');
  if (!card) return;
  if (!wxState) {
    const type = WX_TYPES[Math.floor(Math.random() * WX_TYPES.length)];
    const loc = WX_LOCATIONS[Math.floor(Math.random() * WX_LOCATIONS.length)];
    const temp = type.min + Math.floor(Math.random() * (type.max - type.min + 1));
    wxState = { type, loc, temp };
  }
  const { type, loc, temp } = wxState;
  card.className = `wx-card wx-${type.key}`;
  $('#wxIcon').innerHTML = WX_ICONS[type.key];
  $('#wxTemp').textContent = `${temp}°`;
  $('#wxDesc').textContent = type.label;
  $('#wxLoc').textContent = loc;
}

function homePageCount() {
  return $$('#homePager .home-page').length || 2;
}

function setHomePage(next, animate = true) {
  homePage = Math.max(0, Math.min(homePageCount() - 1, next));
  const pager = $('#homePager');
  if (!pager) return;
  const w = pager.offsetWidth / homePageCount() || window.innerWidth;
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
    base = -homePage * (pager.offsetWidth / homePageCount() || window.innerWidth);
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
    const w = pager.offsetWidth / homePageCount() || window.innerWidth;
    let move = dx;
    if ((homePage === 0 && dx > 0) || (homePage === homePageCount() - 1 && dx < 0)) move = dx * .32;
    const minX = -w * (homePageCount() - 1);
    const x = Math.min(0, Math.max(minX, base + move));
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

function commitAnniv(date, text, bg) {
  commit(s => {
    s.anniversary.date = date;
    s.anniversary.text = text || '我们在一起';
    if (bg !== undefined) s.anniversary.bg = bg;
  });
  renderHome();
}

function openAnnivSheet() {
  const a = get().anniversary || {};
  openSheet(`
    ${sheetTitle('纪念日')}
    <div class="field"><input class="input" type="date" id="annivDateInput" value="${a.date || ''}"></div>
    <div class="field"><input class="input" id="annivTextInput" maxlength="20" placeholder="我们在一起" value="${(a.text || '').replace(/"/g, '&quot;')}"></div>
    <div class="anniv-bg-row">
      <span class="anniv-bg-label">背景图</span>
      <button class="btn-ghost" id="annivBgBtn">${a.bg ? '更换背景' : '添加背景'}</button>
      ${a.bg ? `<button class="btn-ghost danger" id="annivBgClear">清除</button>` : ''}
    </div>
    <div class="sheet-actions">
      <button class="btn-ghost" id="annivCancel">取消</button>
      <button class="btn-ink" id="annivSave">保存</button>
    </div>
  `);
  let pendingBg = a.bg || '';
  $('#annivBgBtn').onclick = async () => {
    const url = await pickHomeImage();
    if (!url) return;
    pendingBg = url;
    toast('已选择背景');
  };
  const clearBtn = $('#annivBgClear');
  if (clearBtn) clearBtn.onclick = () => { pendingBg = ''; toast('已清除背景'); };
  $('#annivCancel').onclick = closeSheet;
  $('#annivSave').onclick = () => {
    const date = $('#annivDateInput').value;
    const text = $('#annivTextInput').value.trim();
    if (!date) {
      toast('请选择开始日期');
      return;
    }
    commitAnniv(date, text, pendingBg);
    closeSheet();
    toast('已保存');
  };
}

const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function updateClock() {
  const now = new Date();
  const h24 = now.getHours();
  const h12 = h24 % 12 || 12;
  const hh = String(h12).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const ap = h24 < 12 ? 'AM' : 'PM';
  if ($('#clock')) $('#clock').textContent = `${hh}:${mm}:${ss} ${ap}`;
  if ($('#date')) $('#date').textContent = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;
  if ($('#homeWeek')) $('#homeWeek').textContent = WEEK[now.getDay()];
  $$('#homeWeekRow span').forEach((el, i) => el.classList.toggle('today', i === now.getDay()));
}

async function pickHomeImage() {
  const file = await pickFile('image/*', false);
  if (!file) return '';
  try {
    return await compressImage(file, 760, .72);
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
  $('#homeStatus')?.addEventListener('click', () => openStatusSheet());
  $('#homeNoteEdit')?.addEventListener('click', openNotesEditor);
  $('.hp-loc')?.addEventListener('click', () => {
    promptSheet({ title: '定位', value: get().ui.homeLoc || '', placeholder: '写一句你的定位' }).then(text => {
      if (text === null) return;
      commit(s => { s.ui.homeLoc = text.trim(); });
      renderHome();
    });
  });
  $('#homeFav')?.addEventListener('click', openFavSheet);
  $$('.app[data-app]').forEach(btn => {
    btn.addEventListener('click', () => {
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

function initPwa() {
  // 记录安装事件，供设置里的「安装到桌面」使用
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    window.__zikaInstallPrompt__ = event;
  });
  window.addEventListener('appinstalled', () => {
    window.__zikaInstallPrompt__ = null;
    toast('已添加到桌面');
  });

  // 浏览器要求通知权限必须在用户操作里申请，首次点屏幕时询问一次
  if ('Notification' in window && Notification.permission === 'default') {
    const ask = () => {
      document.removeEventListener('pointerdown', ask, true);
      Notification.requestPermission().then(result => {
        if (result === 'granted') {
          commit(s => { s.behavior.notify = true; });
          toast('已开启消息通知');
        }
      }).catch(() => {});
    };
    document.addEventListener('pointerdown', ask, true);
  }

  // 点系统通知后回到聊天
  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data && event.data.type === 'zika-open-chat') open('chat');
  });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!/^(https?|wss?):$/.test(location.protocol)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.register('sw.js?v=20261101BF', { updateViaCache: 'none' })
    .then(reg => reg.update().catch(() => {}))
    .catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    const sw = navigator.serviceWorker.controller;
    // 按 SW 版本号记录，只有换了新版本才自动刷新一次；
    // 之前用固定标记，导致页面开着时后续更新永远不再刷新，一直停留在旧版本
    const ver = sw ? (sw.scriptURL.split('?v=')[1] || sw.scriptURL) : 'none';
    if (sessionStorage.getItem('zika.sw-reloaded') === ver) return;
    sessionStorage.setItem('zika.sw-reloaded', ver);
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
  // 先挂上开场的自动收起，这样后面任何一步初始化出错都不会卡在开场页
  splash();
  try {
    initAll();
  } catch (error) {
    console.error('[zika] 启动失败', error);
  }
  // 从桌面通知点进来时，直接进聊天
  if (/[?&]chat=1/.test(location.search)) {
    history.replaceState(null, '', location.pathname);
    open('chat');
  }
}

function initAll() {
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
  initLetters();
  bindHome();
  bindBackButtons();
  handleHistory();
  initPwa();
  registerServiceWorker();
  renderHome();
  setInterval(updateClock, 1000);
  subscribe(scheduleHomeRender);
  window.addEventListener('zika:screen', event => {
    if (event.detail && event.detail.name) return;
    if (homeDirty) {
      homeDirty = false;
      renderHome();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
