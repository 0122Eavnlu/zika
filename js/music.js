import { get, commit, subscribe } from './state.js';
import { $, $$, escapeHtml, uid, pickFile, toast } from './util.js';
import { openSheet, closeSheet, sheetTitle } from './ui.js';
import * as router from './router.js';

const session = [];
const lyricsMap = new Map();
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
  audio.addEventListener('error', () => toast('这首歌无法播放'));
  return audio;
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
  a.src = track.url;
  updateMediaSession(track);
  render();
  if (autoplay) a.play().catch(() => {});
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
}

function syncPlayButton() {
  const btn = $('#musicPlay');
  if (!btn) return;
  const playing = audio && !audio.paused && !!audio.src;
  btn.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
}

function render() {
  const list = allTracks();
  const track = currentTrack();
  const a = audio;

  const cover = $('#musicCover');
  if (cover) {
    if (track && track.cover) {
      cover.style.backgroundImage = `url("${escapeHtml(track.cover)}")`;
      cover.classList.add('has-art');
    } else {
      cover.style.backgroundImage = '';
      cover.classList.remove('has-art');
    }
  }
  $('#musicNow').textContent = track ? track.name : '还没有歌曲';
  $('#musicArtist').textContent = track ? (track.artist || '一起听歌') : '点右上角 ＋ 添加音乐';
  $('#musicMode').textContent = (MODES.find(m => m.key === music().mode) || MODES[0]).label;

  const lyr = track ? (track.lyrics || lyricsMap.get(track.id) || '') : '';
  $('#musicLyrics').textContent = lyr || '暂未导入歌词';
  $('#musicCount').textContent = String(list.length);
  $('#musicTogetherCount').textContent = String(music().togetherCount || 0);
  $('#musicTogether').classList.toggle('on', Boolean(music().together));

  syncPlayButton();
  syncProgress();
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
        <input class="input" id="musicPlaylistInput" placeholder="粘贴歌单链接或歌单 ID">
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

function pushTracks(items) {
  const before = allTracks().length;
  commit(s => {
    items.forEach(item => {
      s.music.tracks.push({
        id: uid(),
        name: item.name || '未命名',
        artist: item.artist || '',
        url: item.url,
        cover: httpsUrl(item.cover),
        lyrics: '',
        lrcUrl: item.lrcUrl || '',
      });
    });
  });
  render();
  if (!before) loadTrack(0, false);
}

async function importPlaylist(raw) {
  const id = importId(raw);
  if (!id) {
    toast('请粘贴歌单链接或数字 ID');
    return;
  }
  toast('正在导入…');
  try {
    const res = await fetch(`${API}&type=playlist&id=${id}`);
    if (!res.ok) throw new Error('http');
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) throw new Error('empty');
    const items = data
      .filter(item => item && item.name && item.url)
      .map(item => ({
        name: String(item.name).trim(),
        artist: String(item.artist || '').trim(),
        url: item.url,
        cover: httpsUrl(item.pic),
        lrcUrl: httpsUrl(item.lrc),
      }));
    if (!items.length) throw new Error('empty');
    pushTracks(items);
    closeSheet();
    toast(`已导入 ${items.length} 首`);
  } catch {
    toast('导入失败，换一个歌单试试');
  }
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
    : (st.apiBase ? '填写 MUSIC_U 或扫码，读取并导入你的歌单' : '需要先填写网易云 API 地址');
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

  openSheet(`
    ${sheetTitle('连接网易云')}
    <p class="music-src-text">填写你部署的网易云 API 地址（NeteaseCloudMusicApi），登录信息只保存在本机。</p>
    <input class="input" id="musicApiBase" placeholder="https://你的服务地址" value="${escapeHtml(st.apiBase || '')}">
    <input class="input" id="musicCookie" placeholder="MUSIC_U 的值" value="">
    <button class="ghost-btn wide" id="musicVerify">验证并连接</button>
    <div class="src-head qr-wrap" id="musicQrBox" hidden></div>
    <button class="ghost-btn wide" id="musicQr">生成登录二维码</button>
    <p class="src-note">MUSIC_U 可在 music.163.com 登录后，从浏览器 Cookie 里复制；二维码需 API 服务支持扫码接口。</p>
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
      toast(err.message === 'noapi' ? '请先填写 API 地址' : '验证失败，检查地址或 MUSIC_U');
    }
  };

  $('#musicQr').onclick = async () => {
    const base = $('#musicApiBase').value.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(base)) { toast('请填写 API 地址'); return; }
    commit(s => { s.music.apiBase = base; });
    try {
      const keyData = await apiGet(`/login/qr/key?timestamp=${Date.now()}`);
      const key = keyData?.data?.unikey;
      if (!key) throw new Error('qr');
      const create = await apiGet(`/login/qr/create?key=${key}&qrimg=true&timestamp=${Date.now()}`);
      const qrimg = create?.data?.qrimg;
      if (!qrimg) throw new Error('qr');
      const box = $('#musicQrBox');
      box.hidden = false;
      box.innerHTML = `<img src="${qrimg}" alt="登录二维码">`;
      const timer = setInterval(async () => {
        if (!$('#musicQrBox')) { clearInterval(timer); return; }
        try {
          const check = await apiGet(`/login/qr/check?key=${key}&timestamp=${Date.now()}`);
          if (check?.code === 803 && check.cookie) {
            clearInterval(timer);
            const cookie = check.cookie.replace(/^MUSIC_U=/, '').split(';')[0];
            const cookieText = check.cookie.match(/MUSIC_U=([^;]+)/)?.[1] || cookie;
            commit(s => { s.music.cookie = cookieText; });
            const me = await apiGet(`/login/status?${cookieParam(cookieText)}&timestamp=${Date.now()}`);
            const profile = me?.data?.profile || me?.profile || null;
            commit(s => {
              s.music.uid = String(profile?.userId || '');
              s.music.nickname = profile?.nickname || '';
            });
            clearInterval(timer);
            openAdd();
            toast('已连接');
          } else if (check?.code === 800) {
            clearInterval(timer);
            toast('二维码已过期');
          }
        } catch {}
      }, 2500);
    } catch {
      toast('生成二维码失败，请检查 API 地址');
    }
  };
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
        url: urls[t.id],
        cover: httpsUrl(t.al?.picUrl),
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
  if (track.lyrics || lyricsMap.get(track.id) || !track.lrcUrl) return;
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
    .map(line => line.replace(/\[[^\]]*\]/g, '').trim())
    .filter(Boolean)
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
  const cleaned = text
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.replace(/\[[^\]]*\]/g, '').trim())
    .filter(Boolean)
    .join('\n');
  if (track.local) lyricsMap.set(track.id, cleaned);
  else commit(s => {
    const t = s.music.tracks.find(x => x.id === track.id);
    if (t) t.lyrics = cleaned;
  });
  render();
  toast('已导入歌词');
}

/* ---------- 交互 ---------- */

function setTab(name) {
  $$('.music-tab').forEach(b => b.classList.toggle('active', b.dataset.musicTab === name));
  $('#musicPanelPlay').hidden = name !== 'play';
  $('#musicPanelLyrics').hidden = name !== 'lyrics';
  $('#musicPanelHome').hidden = name !== 'home';
  if (name === 'lyrics') ensureLyrics();
}

function bind() {
  $('#homeMusic').onclick = () => router.open('music');
  $('#musicAdd').onclick = openAdd;
  $('#musicPlay').onclick = playPause;
  $('#musicPrev').onclick = () => step(-1);
  $('#musicNext').onclick = () => step(1);
  $('#musicListBtn').onclick = openPlaylist;
  $('#musicMode').onclick = () => {
    const next = MODE_KEYS[(MODE_KEYS.indexOf(music().mode) + 1) % MODE_KEYS.length];
    commit(s => { s.music.mode = next; });
    toast(`播放模式：${MODES.find(m => m.key === next).label}`);
  };
  $('#musicTogether').onclick = () => {
    const on = !music().together;
    commit(s => {
      s.music.together = on;
      if (on) s.music.togetherCount = (s.music.togetherCount || 0) + 1;
    });
  };
  $('#musicLyricsImport').onclick = importLyrics;
  $('#musicTabs').addEventListener('click', event => {
    const btn = event.target.closest('[data-music-tab]');
    if (btn) setTab(btn.dataset.musicTab);
  });
  $('#musicSeek').addEventListener('input', event => {
    const a = ensureAudio();
    if (!a.duration) return;
    const ratio = Number(event.target.value) / 1000;
    a.currentTime = ratio * a.duration;
    $('#musicCur').textContent = fmt(a.currentTime);
  });
  $('[data-music-back]').onclick = () => {
    if (allTracks().length && router.isOpen('music')) router.close();
    else router.close();
  };
}

function openPlaylist() {
  const list = allTracks();
  if (!list.length) {
    openAdd();
    return;
  }
  openSheet(`
    ${sheetTitle('歌单')}
    <div class="music-playlist">
      ${list.map((t, i) => `
        <button class="playlist-row ${i === index ? 'current' : ''}" data-track="${i}">
          <span class="pl-index">${String(i + 1).padStart(2, '0')}</span>
          <span class="pl-info">
            <span class="pl-name">${escapeHtml(t.name)}</span>
            <span class="pl-artist">${escapeHtml(t.artist || (t.local ? '本次导入' : '链接'))}</span>
          </span>
          ${i === index && !(audio && audio.paused) ? '<span class="pl-playing">播放中</span>' : ''}
        </button>
      `).join('')}
    </div>
  `);
  $$('[data-track]').forEach(row => {
    row.onclick = () => {
      closeSheet();
      loadTrack(Number(row.dataset.track), true);
    };
  });
}

/* ---------- 手势 ---------- */

function bindSwipe() {
  const home = $('#home');
  let sx = 0;
  let sy = 0;
  home.addEventListener('touchstart', event => {
    if (event.touches.length !== 1) return;
    sx = event.touches[0].clientX;
    sy = event.touches[0].clientY;
  }, { passive: true });
  home.addEventListener('touchend', event => {
    const t = event.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (dx > 70 && Math.abs(dy) < Math.abs(dx) * .6) router.open('music');
  }, { passive: true });

  const screen = $('#screen-music');
  let mx = 0;
  let my = 0;
  screen.addEventListener('touchstart', event => {
    if (event.touches.length !== 1) return;
    mx = event.touches[0].clientX;
    my = event.touches[0].clientY;
  }, { passive: true });
  screen.addEventListener('touchend', event => {
    const t = event.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - mx;
    const dy = t.clientY - my;
    if (dx < -70 && Math.abs(dy) < Math.abs(dx) * .6) router.close();
  }, { passive: true });
}

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

export function initMusic() {
  bind();
  bindSwipe();

  updateDots();
  const obs = new MutationObserver(updateDots);
  obs.observe($('#app'), { attributes: true, attributeFilter: ['class'] });
  $$('.screen').forEach(el => obs.observe(el, { attributes: true, attributeFilter: ['class'] }));

  router.register('music', { onOpen: () => {
    render();
    if (audio && audio.src && !audio.paused) return;
  } });

  subscribe(() => {
    if (router.isOpen('music')) render();
  });

  render();
}
