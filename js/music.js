import { get, commit, subscribe } from './state.js?v=20261031z';
import { $, $$, escapeHtml, uid, pickFile, toast, setAvatar, compressImage } from './util.js?v=20261031z';
import { openSheet, closeSheet, sheetTitle } from './ui.js?v=20261031z';
import * as router from './router.js?v=20261031z';

const session = [];
const lyricsMap = new Map();
const lyricsTried = new Set();
let audio = null;
let index = 0;

const MODES = [
  { key: 'sequence', label: '顺序' },
  { key: 'repeat', label: '单曲' },
  { key: 'shuffle', label: '随机' },
];
const MODE_KEYS = MODES.map(m => m.key);

const PLAY_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.2 5.6v12.8l10.2-6.4z"/></svg>`;
const PAUSE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.2 5.5v13M14.8 5.5v13"/></svg>`;

function music() {
  return get().music;
}

function allTracks() {
  return [...(music().tracks || []), ...session];
}

function fmt(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00';
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function currentTrack() {
  const list = allTracks();
  if (!list.length) return null;
  index = Math.min(Math.max(0, index), list.length - 1);
  return list[index];
}

function ensureAudio() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'metadata';
  audio.addEventListener('timeupdate', syncProgress);
  audio.addEventListener('loadedmetadata', syncProgress);
  audio.addEventListener('durationchange', syncProgress);
  audio.addEventListener('ended', onEnded);
  audio.addEventListener('play', syncPlayButton);
  audio.addEventListener('pause', syncPlayButton);
  audio.addEventListener('error', onAudioError);
  return audio;
}

const recoveredIds = new Set();

async function onAudioError() {
  const track = currentTrack();
  if (!track) return;
  if (recoveredIds.has(track.id)) {
    toast('这首歌暂时放不了');
    return;
  }
  recoverAudio(track);
}

async function searchSongUrl(track) {
  if (!track || !track.name) return '';
  const keyword = encodeURIComponent(`${track.name} ${track.artist || ''}`.trim());
  try {
    const res = await fetch(`${API}&type=search&id=${keyword}&_=${Date.now()}`);
    if (!res.ok) return '';
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return '';
    const hit = data.find(item => item && item.url) || data[0];
    return hit && hit.url ? toInjahow(httpsUrl(hit.url)) : '';
  } catch {
    return '';
  }
}

async function recoverAudio(track) {
  if (!track || !track.url) {
    toast('这首歌暂时放不了');
    return;
  }
  recoveredIds.add(track.id);
  try {
    const res = await fetch(resolveUrl(track), { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const a = ensureAudio();
    a.src = URL.createObjectURL(blob);
    await a.play();
    toast('已切换备用播放');
    return;
  } catch {}
  // 直链过期（如登录导入的网易云直链）→ 用歌名搜一个可播版本
  const searched = await searchSongUrl(track);
  if (searched) {
    try {
      const res = await fetch(searched, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const a = ensureAudio();
      a.src = URL.createObjectURL(blob);
      await a.play();
      toast('已切换备用播放');
      return;
    } catch {}
  }
  toast('这首歌暂时放不了，换一首试试');
}

function updateMediaSession(track) {
  if (!('mediaSession' in navigator) || !track) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.name,
      artist: track.artist || '一起听歌',
      album: '字卡',
    });
    navigator.mediaSession.setActionHandler('play', () => playPause());
    navigator.mediaSession.setActionHandler('pause', () => playPause());
    navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
    navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
  } catch {}
}

function loadTrack(i, autoplay) {
  const list = allTracks();
  if (!list.length) {
    if (audio) audio.pause();
    render();
    return;
  }
  index = ((i % list.length) + list.length) % list.length;
  const track = list[index];
  const a = ensureAudio();
  a.src = resolveUrl(track);
  updateMediaSession(track);
  render();
  if (autoplay) a.play().catch(() => {});
  if (page === 1 && Math.random() < .3) setTimeout(() => themSay(), 2200);
}

function playPause() {
  const list = allTracks();
  if (!list.length) {
    openAdd();
    return;
  }
  const a = ensureAudio();
  if (!a.src) {
    loadTrack(index, true);
    return;
  }
  if (a.paused) a.play().catch(() => {});
  else a.pause();
}

function step(dir) {
  const list = allTracks();
  if (!list.length) return;
  const mode = music().mode;
  if (mode === 'repeat') {
    const a = ensureAudio();
    a.currentTime = 0;
    a.play().catch(() => {});
    return;
  }
  if (mode === 'shuffle' && list.length > 1) {
    let next = index;
    while (next === index) next = Math.floor(Math.random() * list.length);
    loadTrack(next, true);
    return;
  }
  loadTrack(index + dir, true);
}

function onEnded() {
  if (music().mode === 'repeat') {
    const a = ensureAudio();
    a.currentTime = 0;
    a.play().catch(() => {});
    return;
  }
  step(1);
}

/* ---------- 渲染 ---------- */

function syncProgress() {
  const a = audio;
  if (!a) return;
  const cur = $('#musicCur');
  const dur = $('#musicDur');
  const seek = $('#musicSeek');
  if (!cur || !dur || !seek) return;
  cur.textContent = fmt(a.currentTime);
  dur.textContent = fmt(a.duration);
  if (document.activeElement !== seek) {
    const ratio = a.duration ? a.currentTime / a.duration : 0;
    seek.value = String(Math.round(ratio * 1000));
  }
  syncLyric();
}

function syncPlayButton() {
  const btn = $('#musicPlay');
  if (!btn) return;
  const playing = audio && !audio.paused && !!audio.src;
  btn.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
  btn.classList.toggle('is-paused-icon', Boolean(playing));
  const wBtn = $('#wPlay');
  if (wBtn) wBtn.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
  $('#screen-music')?.classList.toggle('playing-audio', Boolean(playing));
}

const COVER_GRADIENT = 'linear-gradient(150deg, #a99a7c, #7d6f55 55%, #5d5343)';

function hiRes(url) {
  return url.replace(/([?&]param=)\d+y\d+/i, (m, key) => `${key}1024y1024`);
}

function applyCover(el, track) {
  const url = hiRes(httpsUrl(track && track.cover));
  const quiet = () => {
    el.classList.remove('has-art');
    el.style.backgroundImage = COVER_GRADIENT;
  };
  if (!url) {
    el.dataset.coverKey = '';
    quiet();
    return;
  }
  if (el.dataset.coverKey === url) return;
  el.dataset.coverKey = url;
  quiet();
  const img = new Image();
  img.onload = () => {
    if (el.dataset.coverKey !== url) return;
    el.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
    el.classList.add('has-art');
  };
  img.onerror = () => {
    if (el.dataset.coverKey !== url) return;
    quiet();
  };
  img.src = url;
}

function render() {
  const list = allTracks();
  const track = currentTrack();
  const s = get();

  const cover = $('#musicCover');
  if (cover) applyCover(cover, track);
  const wCover = $('#wCover');
  if (wCover) applyCover(wCover, track);
  if ($('#musicNow')) $('#musicNow').textContent = track ? track.name : '还没有歌曲';
  if ($('#musicArtist')) $('#musicArtist').textContent = track ? (track.artist || '一起听歌') : '点右上角歌单按钮添加音乐';
  if ($('#wNow')) $('#wNow').textContent = track ? track.name : '还没有歌曲';
  if ($('#wArtist')) $('#wArtist').textContent = track ? (track.artist || '一起听歌') : '一起听歌';
  if ($('#musicModeLabel')) $('#musicModeLabel').textContent = (MODES.find(m => m.key === music().mode) || MODES[0]).label;

  const lyrEl = $('#musicLyrics');
  if (lyrEl) {
    renderLyrics(track);
    startLyricRoll();
  }
  updateListenCaption();

  if ($('#musicCount')) $('#musicCount').textContent = String(list.length);
  if ($('#musicTogetherCount')) $('#musicTogetherCount').textContent = String(music().togetherCount || 0);

  const bgEl = $('#musicBg');
  if (bgEl) {
    if (s.ui.musicBg) {
      bgEl.style.backgroundImage = `url("${s.ui.musicBg}")`;
      bgEl.classList.remove('empty');
    } else {
      bgEl.style.backgroundImage = '';
      bgEl.classList.add('empty');
    }
  }

  [['#musicMeAvatar', s.me], ['#musicThemAvatar', s.persona], ['#musicMeAvatar2', s.me], ['#musicThemAvatar2', s.persona], ['#wMeAvatar', s.me], ['#wThemAvatar', s.persona]]
    .forEach(([sel, who]) => setAvatar($(sel), who?.name, who?.avatar));

  if ($('#wSub')) $('#wSub').textContent = `一起听 ${music().togetherCount || 0} 次`;

  syncPlayButton();
  syncProgress();
  updateMusicDots();
}

/* ---------- 添加音乐 ---------- */

const API = 'https://api.injahow.cn/meting/?server=netease';
const HOT_ID = '3778678';
const HEADPHONES = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.2 14.5v-2.2a7.8 7.8 0 0 1 15.6 0v2.2"/><path d="M4.2 14.2h1.6a1.4 1.4 0 0 1 1.4 1.4v4a1.4 1.4 0 0 1-1.4 1.4H5a1.2 1.2 0 0 1-1.2-1.2v-4.2a1.4 1.4 0 0 1 .4-1.4z"/><path d="M19.8 14.2h-1.6a1.4 1.4 0 0 0-1.4 1.4v4a1.4 1.4 0 0 0 1.4 1.4H19a1.2 1.2 0 0 0 1.2-1.2v-4.2a1.4 1.4 0 0 0-.4-1.4z"/></svg>`;

function openAdd() {
  openSheet(`
    ${sheetTitle('把喜欢的歌带过来')}
    <div class="music-src-tabs">
      <button class="music-src active" data-src="netease">网易云歌单</button>
      <button class="music-src" data-src="local">本地音乐</button>
    </div>
    <div class="music-src-panel" data-panel="netease">
      <button class="src-card wide account-card" id="musicAccount">
        <b id="musicAccountName">连接网易云账号</b>
        <span id="musicAccountState">填写 MUSIC_U 或扫码，读取并导入你的歌单</span>
      </button>
      <div class="src-field">
        <input class="input" id="musicPlaylistInput" placeholder="粘贴歌单 / 单曲 / 专辑链接或 ID">
        <button class="ghost-btn" id="musicImportPlaylist">导入</button>
      </div>
      <div class="src-cards">
        <button class="src-card" id="musicDaily"><b>每日推荐</b><span>热歌榜前 50 首</span></button>
        <button class="src-card" id="musicRoam"><b>漫游</b><span>随机热歌</span></button>
      </div>
      <p class="music-src-text">支持网易云公开歌单链接或数字 ID。曲目由公开接口提供，部分歌曲可能因版权无法播放。</p>
      <button class="ghost-btn wide danger" id="musicClear">清空已导入音乐</button>
    </div>
    <div class="music-src-panel" data-panel="local" hidden>
      <div class="src-head">${HEADPHONES}</div>
      <div class="src-title">一次选好，一起听。</div>
      <p class="music-src-text">点击下面的按钮，在「文件」中多选音频。支持 MP3、M4A、WAV 等浏览器可播放的格式。</p>
      <button class="ghost-btn wide" id="musicPickFiles">添加音乐 · 文件 / URL</button>
      <div class="music-link-row">
        <input class="input" id="musicUrl" placeholder="或粘贴音频直链 https://…">
        <button class="ghost-btn" id="musicUrlAdd">添加</button>
      </div>
      <p class="src-note">本地音频只在本次打开期间可用，链接与歌单会保存下来。</p>
      <button class="ghost-btn wide" id="musicDemo">体验无音频模拟</button>
      <button class="ghost-btn wide danger" id="musicClear2">清空已导入音乐</button>
    </div>
  `);

  $$('.music-src').forEach(btn => {
    btn.onclick = () => {
      $$('.music-src').forEach(b => b.classList.toggle('active', b === btn));
      $$('.music-src-panel').forEach(p => { p.hidden = p.dataset.panel !== btn.dataset.src; });
    };
  });

  $('#musicImportPlaylist').onclick = () => importPlaylist($('#musicPlaylistInput').value);
  $('#musicPlaylistInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') importPlaylist(e.target.value);
  });
  $('#musicDaily').onclick = () => importPlaylist(HOT_ID);
  $('#musicRoam').onclick = () => importPlaylist(HOT_ID);
  $('#musicAccount').onclick = openConnect;
  syncAccount();

  $('#musicPickFiles').onclick = async () => {
    const files = await pickFile('audio/*', true);
    if (!files || !files.length) return;
    const before = allTracks().length;
    files.forEach(file => {
      session.push({
        id: uid(),
        name: file.name.replace(/\.\w+$/, ''),
        artist: '',
        url: URL.createObjectURL(file),
        local: true,
      });
    });
    closeSheet();
    render();
    if (!before) loadTrack(0, true);
    toast(`已添加 ${files.length} 首`);
  };

  $('#musicUrlAdd').onclick = () => {
    const url = $('#musicUrl').value.trim();
    if (!/^https?:\/\//i.test(url)) {
      toast('请输入 http(s) 开头的链接');
      return;
    }
    pushTracks([{ name: url.split('/').pop().replace(/\.\w+($|\?)/, '') || '未命名', artist: '', url }]);
    closeSheet();
    toast('已添加');
  };

  $('#musicDemo').onclick = () => importPlaylist(HOT_ID);

  $$('#musicClear, #musicClear2').forEach(btn => { btn.onclick = clearAll; });
}

function importId(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const direct = text.match(/playlist[\/?#&=]*(?:id=)?(\d{4,})/i);
  const bare = text.match(/^\d{4,}$/);
  const anyId = text.match(/(\d{6,})/);
  return (direct && direct[1]) || (bare && bare[0]) || (anyId && anyId[1]) || '';
}

function httpsUrl(url) {
  const text = String(url || '').trim();
  if (!text) return '';
  if (text.startsWith('//')) return `https:${text}`;
  return text.replace(/^http:\/\//i, 'https://');
}

function freshUrl(url) {
  const text = httpsUrl(url);
  if (!text) return '';
  if (/type=url|type=song|type=playlist|type=album/.test(text) && /meting|injiahow|i-meto|w4t/.test(text)) {
    return `${text}${text.includes('?') ? '&' : '?'}_=${Date.now()}`;
  }
  return text;
}

function toInjahow(url) {
  return String(url || '')
    .replace('api.i-meto.com/meting/api', 'api.injahow.cn/meting')
    .replace('api.i-meto.com/meting/', 'api.injahow.cn/meting/');
}

function resolveUrl(track) {
  if (!track) return '';
  let url = freshUrl(track.url);
  url = toInjahow(url);
  if (/meting|injahow|i-meto/.test(url)) return url;
  const idMatch = String(track.lrcUrl || '').match(/[?&]id=(\d+)/);
  if (idMatch) return `${API}&type=url&id=${idMatch[1]}&_=${Date.now()}`;
  return url;
}

function pushTracks(items) {
  const before = allTracks().length;
  commit(s => {
    items.forEach(item => {
      s.music.tracks.push({
        id: uid(),
        name: item.name || '未命名',
        artist: item.artist || '',
        url: toInjahow(httpsUrl(item.url)),
        cover: httpsUrl(item.cover),
        lyrics: '',
        lrcUrl: item.lrcUrl || '',
      });
    });
  });
  render();
  if (!before) loadTrack(0, false);
}

function neteaseTarget(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const id = importId(text);
  if (!id) return null;
  let type = 'playlist';
  if (/\/song\b|song\?id=|#\/song/i.test(text)) type = 'song';
  else if (/\/album\b|album\?id=/.test(text)) type = 'album';
  return { id, type };
}

const METING_HOSTS = [
  { base: 'https://api.injahow.cn/meting/?server=netease' },
];

async function fetchMetingList(target) {
  for (const host of METING_HOSTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const bust = attempt ? `&_=${Date.now()}` : '';
        const res = await fetch(`${host.base}&type=${target.type}&id=${target.id}${bust}`);
        if (!res.ok) continue;
        const data = await res.json();
        if (!Array.isArray(data) || !data.length) continue;
        const items = data
          .filter(item => item && (item.name || item.title) && item.url)
          .slice(0, 300)
          .map(item => ({
            name: String(item.name || item.title).trim(),
            artist: String(item.artist || item.author || '').trim(),
            url: toInjahow(httpsUrl(item.url)),
            cover: hiRes(httpsUrl(item.pic)),
            lrcUrl: httpsUrl(item.lrc || ''),
          }));
        if (items.length) return items;
      } catch {}
    }
  }
  return [];
}

async function importPlaylist(raw) {
  const target = neteaseTarget(raw);
  if (!target) {
    toast('请粘贴歌单 / 单曲 / 专辑链接，或数字 ID');
    return;
  }
  toast('正在导入…');
  const items = await fetchMetingList(target);
  if (!items.length) {
    toast('这个歌单暂时取不到可播放的歌，换个歌单链接再试');
    return;
  }
  pushTracks(items);
  closeSheet();
  toast(`已导入 ${items.length} 首`);
}

function apiBase() {
  return String(music().apiBase || '').replace(/\/+$/, '');
}

function cookieParam(cookie) {
  return `cookie=${encodeURIComponent(`MUSIC_U=${cookie}`)}`;
}

async function apiGet(path) {
  const base = apiBase();
  if (!base) throw new Error('noapi');
  const res = await fetch(base + path);
  if (!res.ok) throw new Error('http');
  return res.json();
}

function syncAccount() {
  const holder = $('#musicAccountName');
  if (!holder) return;
  const st = music();
  const connected = Boolean(st.cookie && st.uid);
  holder.textContent = connected ? `${st.nickname || '我的网易云'} · 我的歌单` : '连接网易云账号';
  $('#musicAccountState').textContent = connected
    ? '已连接，点这里查看并导入我的歌单'
    : (st.apiBase ? '点这里扫码登录，导入我的歌单' : '需要先填写网易云 API 地址');
}

/* ---------- 网易云扫码登录 ---------- */

let qrTimer = null;

function isNetworkError(err) {
  const msg = String((err && err.message) || '');
  return (err && err.name === 'TypeError') || /fetch|network|load failed/i.test(msg);
}

export function hideQrModal() {
  clearInterval(qrTimer);
  qrTimer = null;
  const modal = $('#qrModal');
  if (modal) modal.hidden = true;
}

async function startQr() {
  clearInterval(qrTimer);
  qrTimer = null;
  const box = $('#qrImg');
  const status = $('#qrStatus');
  if (!box || !status) return;
  box.innerHTML = '';
  status.textContent = '正在获取二维码…';
  try {
    const keyData = await apiGet(`/login/qr/key?timestamp=${Date.now()}`);
    const key = keyData?.data?.unikey;
    if (!key) throw new Error('qr');
    const create = await apiGet(`/login/qr/create?key=${key}&qrimg=true&timestamp=${Date.now()}`);
    const qrimg = create?.data?.qrimg;
    if (!qrimg) throw new Error('qr');
    const img = new Image();
    img.alt = '登录二维码';
    img.src = qrimg;
    box.appendChild(img);
    status.textContent = '等待扫码登录…';
    pollQr(key);
  } catch (err) {
    status.textContent = isNetworkError(err) ? '连不上 API 服务，请检查地址' : '二维码获取失败，请重试';
  }
}

function pollQr(key) {
  qrTimer = setInterval(async () => {
    const status = $('#qrStatus');
    if (!status || !status.isConnected || $('#qrModal')?.hidden) {
      clearInterval(qrTimer);
      qrTimer = null;
      return;
    }
    try {
      const check = await apiGet(`/login/qr/check?key=${key}&timestamp=${Date.now()}`);
      const code = check?.code;
      if (code === 803) {
        clearInterval(qrTimer);
        qrTimer = null;
        const cookieText = (String(check.cookie || '').match(/MUSIC_U=([^;]+)/) || [])[1] || '';
        if (!cookieText) {
          status.textContent = '登录失败，请重试';
          return;
        }
        status.textContent = '登录成功';
        commit(s => { s.music.cookie = cookieText; });
        const me = await apiGet(`/login/status?${cookieParam(cookieText)}&timestamp=${Date.now()}`);
        const profile = me?.data?.profile || me?.profile || null;
        commit(s => {
          s.music.uid = String(profile?.userId || '');
          s.music.nickname = profile?.nickname || '';
        });
        hideQrModal();
        toast('已连接网易云');
        openAdd();
        return;
      }
      if (code === 802) status.textContent = '已扫码，请在手机上确认';
      else if (code === 800) {
        clearInterval(qrTimer);
        qrTimer = null;
        status.textContent = '二维码已过期，点「重新获取」';
      }
    } catch (err) {
      if (isNetworkError(err)) {
        clearInterval(qrTimer);
        qrTimer = null;
        status.textContent = '连不上 API 服务，请检查地址';
      }
    }
  }, 2500);
}

function showQrModal() {
  const modal = $('#qrModal');
  if (!modal) return;
  modal.hidden = false;
  modal.onclick = e => { if (e.target === modal) hideQrModal(); };
  $('#qrRefresh').onclick = () => startQr();
  $('#qrCancel').onclick = hideQrModal;
  $('#qrUseCookie').onclick = () => {
    hideQrModal();
    openCookieSheet();
  };
  startQr();
}

function openCookieSheet() {
  const st = music();
  openSheet(`
    ${sheetTitle('连接网易云')}
    <p class="music-src-text">填写你部署的网易云 API 地址，再粘贴 MUSIC_U。登录信息只保存在本机。</p>
    <input class="input" id="musicApiBase" placeholder="https://你的服务地址" value="${escapeHtml(st.apiBase || '')}">
    <input class="input" id="musicCookie" placeholder="MUSIC_U 的值" value="">
    <button class="ghost-btn wide" id="musicVerify">验证并连接</button>
    <p class="src-note">MUSIC_U 可在 music.163.com 登录后，从浏览器 Cookie 里复制。</p>
  `);

  $('#musicVerify').onclick = async () => {
    const base = $('#musicApiBase').value.trim().replace(/\/+$/, '');
    const cookie = $('#musicCookie').value.trim().replace(/^MUSIC_U=/, '');
    if (!/^https?:\/\//i.test(base)) { toast('请填写 API 地址'); return; }
    if (!cookie) { toast('请填写 MUSIC_U'); return; }
    commit(s => { s.music.apiBase = base; });
    toast('正在验证…');
    try {
      const data = await apiGet(`/login/status?${cookieParam(cookie)}&timestamp=${Date.now()}`);
      const profile = data?.data?.profile || data?.profile || data?.account || null;
      const uid = String(profile?.userId || profile?.account?.id || '');
      if (!uid) throw new Error('anon');
      commit(s => {
        s.music.cookie = cookie;
        s.music.uid = uid;
        s.music.nickname = profile?.nickname || '';
      });
      openAdd();
      toast('已连接');
    } catch (err) {
      toast(isNetworkError(err) ? '连不上 API 服务，请检查地址' : '验证失败，检查地址或 MUSIC_U');
    }
  };
}

function askApiBase() {
  openSheet(`
    ${sheetTitle('先填 API 地址')}
    <p class="music-src-text">扫码登录需要你部署的 NeteaseCloudMusicApi 服务地址，例如 https://xxx.vercel.app</p>
    <div class="src-field">
      <input class="input" id="musicApiBaseInput" placeholder="https://你的服务地址" value="${escapeHtml(music().apiBase || '')}">
    </div>
    <button class="ghost-btn wide" id="musicApiBaseSave">保存并扫码登录</button>
    <button class="ghost-btn wide" id="musicApiCookie">改用 MUSIC_U 登录</button>
  `);
  $('#musicApiBaseSave').onclick = () => {
    const base = $('#musicApiBaseInput').value.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) { toast('请填写以 http(s) 开头的地址'); return; }
    commit(s => { s.music.apiBase = base; });
    closeSheet();
    showQrModal();
  };
  $('#musicApiCookie').onclick = () => { closeSheet(); openCookieSheet(); };
}

function openConnect() {
  const st = music();
  if (st.cookie && st.uid) {
    openSheet(`
      ${sheetTitle(st.nickname || '我的网易云')}
      <p class="music-src-text">已连接，登录信息只保存在本机。</p>
      <button class="ghost-btn wide" id="musicMyPlaylists">查看我的歌单</button>
      <button class="ghost-btn wide danger" id="musicLogout">退出登录</button>
    `);
    $('#musicMyPlaylists').onclick = openMyPlaylists;
    $('#musicLogout').onclick = () => {
      commit(s => { s.music.cookie = ''; s.music.uid = ''; s.music.nickname = ''; });
      closeSheet();
      syncAccount();
      toast('已退出');
    };
    return;
  }
  if (!apiBase()) {
    askApiBase();
    return;
  }
  showQrModal();
}


async function openMyPlaylists() {
  toast('正在读取歌单…');
  try {
    const data = await apiGet(`/user/playlist?uid=${music().uid}&limit=100&${cookieParam(music().cookie)}&timestamp=${Date.now()}`);
    const list = (data?.playlist || []).filter(p => p && p.id);
    if (!list.length) throw new Error('empty');
    openSheet(`
      ${sheetTitle('我的歌单')}
      <div class="playlist-sheet">
        ${list.map(p => `
          <button class="playlist-row" data-pl="${p.id}">
            <span class="pl-info"><span class="pl-name">${escapeHtml(p.name || '未命名歌单')}</span><span class="pl-artist">${p.trackCount || 0} 首</span></span>
          </button>
        `).join('')}
      </div>
    `);
    $$('.playlist-row').forEach(btn => { btn.onclick = () => importPrivatePlaylist(btn.dataset.pl); });
  } catch {
    toast('读取歌单失败');
  }
}

async function importPrivatePlaylist(playlistId) {
  toast('正在导入…');
  try {
    const detail = await apiGet(`/playlist/detail?id=${playlistId}&${cookieParam(music().cookie)}&timestamp=${Date.now()}`);
    const tracks = detail?.playlist?.tracks || [];
    if (!tracks.length) throw new Error('empty');
    const ids = tracks.map(t => t.id).filter(Boolean);
    const urls = {};
    for (let i = 0; i < ids.length; i += 18) {
      const chunk = ids.slice(i, i + 18);
      const data = await apiGet(`/song/url?id=${chunk.join(',')}&${cookieParam(music().cookie)}&timestamp=${Date.now()}`);
      (data?.data || []).forEach(item => { if (item?.url) urls[item.id] = item.url; });
    }
    const items = tracks
      .filter(t => urls[t.id])
      .map(t => ({
        name: t.name,
        artist: (t.ar || []).map(a => a.name).join(' / '),
        url: httpsUrl(urls[t.id]),
        cover: hiRes(httpsUrl(t.al?.picUrl)),
        lrcUrl: `${API}&type=lrc&id=${t.id}`,
      }));
    if (!items.length) throw new Error('empty');
    pushTracks(items);
    closeSheet();
    toast(`已导入 ${items.length} 首`);
  } catch {
    toast('导入失败，会员/版权歌曲可能不可用');
  }
}

function clearAll() {
  session.length = 0;
  commit(s => { s.music.tracks = []; s.music.current = 0; });
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
  }
  index = 0;
  closeSheet();
  render();
  toast('已清空');
}

async function ensureLyrics() {
  const track = currentTrack();
  if (!track) return;
  const cached = track.lyrics || lyricsMap.get(track.id) || '';
  if (!track.lrcUrl) return;
  if (/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(cached)) return;
  if (lyricsTried.has(track.id) && cached) return;
  lyricsTried.add(track.id);
  try {
    const res = await fetch(track.lrcUrl);
    if (!res.ok) return;
    const cleaned = cleanLyrics(await res.text());
    if (!cleaned) return;
    if (track.local) lyricsMap.set(track.id, cleaned);
    else commit(s => {
      const t = s.music.tracks.find(x => x.id === track.id);
      if (t) t.lyrics = cleaned;
    });
    if (currentTrack()?.id === track.id) render();
  } catch {}
}

function cleanLyrics(text) {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !/^\[(ar|ti|al|by|offset|re|ve|kana|length|#)[:\]]/i.test(line))
    .join('\n');
}

async function importLyrics() {
  const track = currentTrack();
  if (!track) {
    toast('先添加一首歌');
    return;
  }
  const file = await pickFile('.lrc,.txt,text/*');
  if (!file) return;
  let text = '';
  try { text = await file.text(); } catch { toast('读取失败'); return; }
  const cleaned = cleanLyrics(text);
  if (track.local) lyricsMap.set(track.id, cleaned);
  else commit(s => {
    const t = s.music.tracks.find(x => x.id === track.id);
    if (t) t.lyrics = cleaned;
  });
  render();
  toast('已导入歌词');
}

/* ---------- 交互 ---------- */

let page = 0;

export function openWidgets() {
  router.open('music');
}

export function openMusic() {
  router.open('music');
}
let lyricTrack = '';
let lyricIdx = 0;
let lyricTimer = null;
let lyricTimes = [];

function parseLrc(text) {
  const out = [];
  text.split('\n').forEach(raw => {
    const line = raw.trim();
    if (!line) return;
    const tags = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const body = line.replace(/\[[^\]]*\]/g, '').trim();
    if (!tags.length) {
      if (/^\[[a-zA-Z#]+:/i.test(line)) return;
      out.push({ t: null, text: line });
      return;
    }
    if (!body) return;
    tags.forEach(tag => {
      const frac = tag[3] ? Number(`0.${tag[3]}`) : 0;
      out.push({ t: Number(tag[1]) * 60 + Number(tag[2]) + frac, text: body });
    });
  });
  return out;
}

function renderLyrics(track) {
  const box = $('#musicLyrics');
  if (!box) return;
  const txt = track ? (track.lyrics || lyricsMap.get(track.id) || '') : '';
  const parsed = parseLrc(txt);
  const timed = parsed.filter(p => p.t != null);
  const use = timed.length ? timed : parsed.map(p => ({ t: null, text: p.text }));
  const key = `${track ? track.id : ''}|${use.map(p => p.text).join('\n')}`;
  if (lyricTrack !== key || !box.children.length) {
    lyricTrack = key;
    lyricIdx = 0;
    box.innerHTML = (use.length ? use : [{ text: '暂未导入歌词' }])
      .map(p => `<span class="lyric-line">${escapeHtml(p.text)}</span>`)
      .join('');
    box.scrollTop = 0;
    lyricTimes = timed.length ? use.map(p => p.t) : [];
  }
  if (lyricTimes.length) syncLyric();
  else markLyric();
}

function markLyric() {
  const box = $('#musicLyrics');
  if (!box) return;
  const items = [...box.children];
  if (!items.length) return;
  const active = Math.min(lyricIdx, items.length - 1);
  items.forEach((el, i) => el.classList.toggle('active', i === active));
  const el = items[active];
  if (el) box.scrollTop = Math.max(0, el.offsetTop - box.clientHeight / 2 + el.offsetHeight / 2);
}

function syncLyric() {
  if (!lyricTimes.length || !audio) return;
  const t = (audio.currentTime || 0) + .25;
  let i = 0;
  while (i < lyricTimes.length && lyricTimes[i] <= t) i++;
  const next = Math.max(0, i - 1);
  if (next !== lyricIdx) {
    lyricIdx = next;
    markLyric();
  }
}

function updateListenCaption() {
  const el = $('#listenSince');
  if (!el) return;
  const st = music();
  const start = Number(st.sessionStart) || 0;
  const mins = st.together && start ? Math.floor((Date.now() - start) / 60000) : 0;
  el.textContent = `TA就在你的身边 一起听了 ${mins} 分钟`;
}

function startLyricRoll() {
  if (lyricTimer) return;
  lyricTimer = setInterval(() => {
    if (page !== 1) return;
    updateListenCaption();
    if (lyricTimes.length) return;
    if (!audio || audio.paused || !audio.src) return;
    const box = $('#musicLyrics');
    if (!box || box.children.length < 2) return;
    lyricIdx = (lyricIdx + 1) % box.children.length;
    markLyric();
  }, 5000);
}

const OPEN_LINES = ['耳机分你一半', '这首刚好想听', '在听吗', '一起听一会儿'];
const REPLY_LINES = ['嗯，我在听', '这首好听', '声音小一点', '你也在听吗', '刚好放到这一句', '有点想你了', '别切，听完这首'];

const randPick = list => list[Math.floor(Math.random() * list.length)];

function updateMusicDots() {
  $$('#musicDots .dot').forEach(d => d.classList.toggle('active', Number(d.dataset.mpage) === page));
}

function goPage(next) {
  page = Math.max(0, Math.min(1, next));
  const pager = $('#musicPager');
  if (pager) {
    pager.style.transition = 'none';
    pager.style.transform = `translate3d(${-page * 50}%, 0, 0)`;
  }
  $('#screen-music')?.classList.toggle('is-listen', page === 1);
  updateMusicDots();
  updateListenCaption();
  if (page === 1) {
    render();
    ensureLyrics();
  }
}

function backMusic() {
  router.close();
}

function pushMusicMsg(who, text) {
  const box = $('#musicMsgs');
  if (!box || !text) return;
  const el = document.createElement('div');
  el.className = `music-msg ${who === 'me' ? 'me' : 'them'}`;
  el.textContent = text;
  box.appendChild(el);
  while (box.children.length > 3) box.removeChild(box.firstChild);
  const stay = Math.max(1, Number(music().msgStay) || 5);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 520);
  }, stay * 1000);
}

function cardLine() {
  const items = (get().cards?.items || []).filter(c => !c.blocked && c.text);
  return items.length ? randPick(items).text : randPick(REPLY_LINES);
}

function themSay(text) {
  if (page !== 1) return;
  pushMusicMsg('them', text || cardLine());
}

function openReply() {
  if (!$('#musicChatInput')) {
    const sheet = openSheet(`
      <div class="chat-sheet-head">
        <h2>发消息</h2>
        <button class="chat-sheet-x" id="musicChatClose" aria-label="关闭">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>
        </button>
      </div>
      <div class="chat-sheet-row">
        <input class="chat-input" id="musicChatInput" placeholder="发消息..." autocomplete="off" maxlength="60">
        <button class="chat-send" id="musicChatSend" aria-label="发送">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4.5a6.5 6.5 0 1 1-4.6 11.1M15.5 15.5l4 4"/></svg>
        </button>
      </div>
    `);
    sheet.classList.add('sheet-dark', 'sheet-center');
    $('#musicChatClose').onclick = closeSheet;
    $('#musicChatSend').onclick = sendMsg;
    $('#musicChatInput').addEventListener('keydown', event => {
      if (event.key === 'Enter') sendMsg();
    });
  }
  setTimeout(() => $('#musicChatInput')?.focus(), 120);
}

let chatTimer = null;

function startChatLoop() {
  if (chatTimer) return;
  chatTimer = setInterval(() => {
    if (page === 1 && Math.random() < .5) themSay();
  }, 60000);
}

function startTogether() {
  const first = !music().together;
  commit(s => {
    s.music.together = true;
    s.music.togetherCount = (s.music.togetherCount || 0) + 1;
    if (!s.music.sessionStart) s.music.sessionStart = Date.now();
  });
  startChatLoop();
  goPage(1);
  if (!allTracks().length) {
    toast('先加一首歌吧');
    setTimeout(openAdd, 120);
  } else if (audio && !audio.src) {
    loadTrack(index, true);
  }
  if (first) setTimeout(() => themSay(cardLine()), 3200);
}

function endSession() {
  const st = music();
  if (!st.together) return;
  const start = Number(st.sessionStart) || 0;
  const minutes = start ? Math.max(1, Math.floor((Date.now() - start) / 60000)) : 0;
  commit(s => {
    s.music.together = false;
    s.music.sessionStart = 0;
    if (minutes) {
      s.music.history = [...(s.music.history || []), { at: Date.now(), minutes }].slice(-60);
    }
  });
}

function openMusicLog() {
  const el = $('#musicLog');
  if (!el) return;
  renderMusicLog();
  el.hidden = false;
}

function renderMusicLog() {
  const box = $('#musicLogList');
  if (!box) return;
  const list = (music().history || []).slice().reverse();
  if (!list.length) {
    box.innerHTML = '<p class="ml-log-empty">暂无一起听记录</p>';
    return;
  }
  box.innerHTML = list.map(h => `
    <div class="ml-log-item">
      <span class="ml-log-dot"></span>
      <div class="ml-log-text">
        <b>一起听了 ${h.minutes} 分钟</b>
        <span>${new Date(h.at).toLocaleString('zh-CN', { hour12: false })}</span>
      </div>
    </div>
  `).join('');
}

function openMusicMore() {
  const st = music();
  const stay = Math.max(3, Number(st.msgStay) || 5);
  const sheet = openSheet(`
    ${sheetTitle('一起听')}
    <button class="more-row" id="musicLogOpen">
      <span>一起听记录</span>
      <span class="more-count">${(st.history || []).length} 次</span>
    </button>
    <div class="more-card">
      <h3>导入网易云歌单</h3>
      <p>粘贴网易云歌单链接或歌单 ID，自动导入歌单内全部歌曲</p>
      <div class="more-input-row">
        <input class="input" id="morePlaylist" placeholder="如 https://music.163.com/playlist?id=…">
        <button class="more-btn" id="moreImport">导入</button>
      </div>
      <button class="more-link" id="moreQr">扫码登录网易云，导入我的歌单</button>
    </div>
    <div class="more-card">
      <h3>一起听消息停留时长</h3>
      <p>消息气泡显示多少秒后自动消失（默认 5 秒）</p>
      <div class="more-stepper">
        <input class="input" type="number" min="3" max="600" id="moreStay" value="${stay}">
        <span>秒</span>
      </div>
    </div>
    <div class="more-card">
      <h3>网易云背景图</h3>
      <p>更换一起听页面的背景图片</p>
      <div class="more-btns">
        <button class="more-btn ghost" id="moreBg">点击选择图片</button>
        <button class="more-btn ghost" id="moreBgClear">清除</button>
      </div>
    </div>
    <button class="more-exit" id="moreExit">退出一起听</button>
  `);

  $('#musicLogOpen').onclick = () => {
    closeSheet();
    setTimeout(openMusicLog, 60);
  };
  $('#moreImport').onclick = () => {
    const value = $('#morePlaylist').value.trim();
    if (!value) { toast('请粘贴歌单链接'); return; }
    importPlaylist(value);
  };
  $('#moreQr').onclick = () => {
    closeSheet();
    setTimeout(openConnect, 60);
  };
  $('#moreStay').addEventListener('change', event => {
    const n = Math.max(3, Math.min(600, Number(event.target.value) || 5));
    event.target.value = String(n);
    commit(s => { s.music.msgStay = n; });
  });
  $('#moreBg').onclick = changeMusicBg;
  $('#moreBgClear').onclick = () => {
    commit(s => { s.ui.musicBg = ''; });
    render();
    toast('已清除背景');
  };
  $('#moreExit').onclick = () => {
    closeSheet();
    endSession();
    router.close();
  };
}

function sendMsg() {
  const input = $('#musicChatInput');
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  pushMusicMsg('me', text);
  closeSheet();
  if (Math.random() < .75) setTimeout(() => themSay(), 1400 + Math.random() * 1800);
}

async function changeMusicBg() {
  const file = await pickFile('image/*', false);
  if (!file) return;
  try {
    const url = await compressImage(file, 1280, .82);
    commit(s => { s.ui.musicBg = url; });
    render();
    toast('已更换背景');
  } catch {
    toast('图片读取失败');
  }
}

function bind() {
  $('#musicPlay').onclick = playPause;
  $('#musicPrev').onclick = () => step(-1);
  $('#musicNext').onclick = () => step(1);
  const wPlay = $('#wPlay');
  if (wPlay) wPlay.onclick = playPause;
  const wPrev = $('#wPrev');
  if (wPrev) wPrev.onclick = () => step(-1);
  const wNext = $('#wNext');
  if (wNext) wNext.onclick = () => step(1);
  $('#musicListBtn').onclick = openPlaylist;
  $('#musicMode').onclick = () => {
    const next = MODE_KEYS[(MODE_KEYS.indexOf(music().mode) + 1) % MODE_KEYS.length];
    commit(s => { s.music.mode = next; });
    toast(`播放模式：${MODES.find(m => m.key === next).label}`);
  };
  $('#musicStart').onclick = startTogether;
  $('#musicBgBtn').onclick = changeMusicBg;
  $('#musicMore').onclick = openMusicMore;
  $('#musicLogBack').onclick = () => { $('#musicLog').hidden = true; };
  $('#musicChatBtn').onclick = openReply;
  $('#musicMeAvatar2')?.addEventListener('click', openReply);
  $('#musicThemAvatar2')?.addEventListener('click', openReply);
  $('#musicThemAvatar')?.addEventListener('click', openReply);
  $('#musicSeek').addEventListener('input', event => {
    const a = ensureAudio();
    if (!a.duration) return;
    const ratio = Number(event.target.value) / 1000;
    a.currentTime = ratio * a.duration;
    $('#musicCur').textContent = fmt(a.currentTime);
  });
  $$('[data-music-back]').forEach(btn => { btn.onclick = backMusic; });
}

function openPlaylist() {
  const list = allTracks();
  if (!list.length) {
    openAdd();
    return;
  }
  const sheet = openSheet(`
    <div class="pl-head">
      <h2>播放列表</h2>
      <div class="pl-head-actions">
        <button class="pl-clear" id="plClear">删除歌单</button>
        <button class="pl-x" id="plClose" aria-label="关闭">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>
        </button>
      </div>
    </div>
    <div class="pl-list">
      ${list.map((t, i) => `
        <div class="pl-row ${i === index ? 'current' : ''}" data-track="${i}">
          <span class="pl-cover" style="background-image:url('${(httpsUrl(t.cover) || '').replace(/"/g, '%22')}')"></span>
          <span class="pl-info">
            <span class="pl-name">${escapeHtml(t.name)}</span>
            <span class="pl-artist">${escapeHtml(t.artist || (t.local ? '本次导入' : '链接'))}</span>
          </span>
          ${i === index ? `<span class="pl-now">${audio && !audio.paused ? '播放中' : '当前'}</span>` : ''}
          <button class="pl-del" data-del="${i}" aria-label="移除">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>
          </button>
        </div>
      `).join('')}
    </div>
  `);
  sheet.classList.add('sheet-dark');
  $('#plClose').onclick = closeSheet;
  $('#plClear').onclick = clearAll;
  $$('.pl-row').forEach(row => {
    row.onclick = event => {
      if (event.target.closest('[data-del]')) return;
      closeSheet();
      loadTrack(Number(row.dataset.track), true);
    };
  });
  $$('[data-del]').forEach(btn => {
    btn.onclick = event => {
      event.stopPropagation();
      removeTrack(Number(btn.dataset.del));
    };
  });
}

function removeTrack(i) {
  const track = allTracks()[i];
  if (!track) return;
  if (track.local) {
    const si = session.indexOf(track);
    if (si >= 0) session.splice(si, 1);
  } else {
    commit(s => { s.music.tracks = (s.music.tracks || []).filter(t => t.id !== track.id); });
  }
  if (i === index) {
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
    }
    index = 0;
  } else if (i < index) {
    index -= 1;
  }
  closeSheet();
  render();
  setTimeout(openPlaylist, 260);
}

/* ---------- 手势 ---------- */

function updateDots() {
  const dots = $('#pageDots');
  if (!dots) return;
  const musicOpen = $('#screen-music').classList.contains('active');
  const anyOpen = $('#app').classList.contains('app-open') || $$('.screen.active').length > 0;
  dots.hidden = !(musicOpen || !anyOpen);
  $$('.dot', dots).forEach(d => {
    d.classList.toggle('active', (d.dataset.dot === 'music') === musicOpen);
  });
}

export function isListening() {
  return Boolean(audio && audio.src && !audio.paused);
}

/* ---------- 取一句歌词 ---------- */

const LYRIC_LEADS = ['我想给你的', '想把这首送给你', '听到这句就想起了你'];
let lastLyric = '';

async function lyricsOf(track) {
  if (!track) return '';
  const cached = track.lyrics || lyricsMap.get(track.id) || '';
  if (cached) return cached;
  if (!track.lrcUrl) return '';
  try {
    const res = await fetch(track.lrcUrl);
    if (!res.ok) return '';
    const cleaned = cleanLyrics(await res.text());
    if (!cleaned) return '';
    lyricsMap.set(track.id, cleaned);
    if (!track.local) {
      commit(s => {
        const t = s.music.tracks.find(x => x.id === track.id);
        if (t) t.lyrics = cleaned;
      });
    }
    return cleaned;
  } catch {
    return '';
  }
}

export async function pickLyric() {
  const list = allTracks();
  if (!list.length) return null;
  const start = Math.min(Math.max(0, index), list.length - 1);
  const rest = list.filter((_, i) => i !== start).sort(() => Math.random() - .5);
  const order = [list[start], ...rest].slice(0, 8);
  for (const track of order) {
    const text = await lyricsOf(track);
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length >= 4 && l.length <= 24);
    if (!lines.length) continue;
    let line = randPick(lines);
    if (lines.length > 1 && line === lastLyric) line = lines[(lines.indexOf(line) + 1) % lines.length];
    lastLyric = line;
    return { song: track.name, lyric: line, lead: randPick(LYRIC_LEADS) };
  }
  return null;
}

function migrateCovers() {
  const tracks = music().tracks || [];
  if (!tracks.some(t => t.cover && t.cover !== httpsUrl(t.cover))) return;
  commit(s => {
    s.music.tracks.forEach(t => {
      if (t.cover) t.cover = httpsUrl(t.cover);
    });
  });
}

export function initMusic() {
  migrateCovers();
  bind();

  updateDots();
  const obs = new MutationObserver(updateDots);
  obs.observe($('#app'), { attributes: true, attributeFilter: ['class'] });
  $$('.screen').forEach(el => obs.observe(el, { attributes: true, attributeFilter: ['class'] }));

  setInterval(updateListenCaption, 10000);

  router.register('music', { onOpen: () => {
    const log = $('#musicLog');
    if (log) log.hidden = true;
    if (music().together && !music().sessionStart) {
      commit(s => { s.music.sessionStart = Date.now(); });
    }
    render();
    const dots = $('#musicDots');
    if (dots) dots.style.display = '';
    if (music().together && allTracks().length) {
      startChatLoop();
      goPage(1);
    } else {
      goPage(0);
    }
  } });

  subscribe(() => {
    if (router.isOpen('music')) render();
  });

  render();
}
