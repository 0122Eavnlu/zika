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

function openAdd() {
  openSheet(`
    ${sheetTitle('把喜欢的歌带过来')}
    <div class="music-src-tabs">
      <button class="music-src active" data-src="local">本地音乐</button>
      <button class="music-src" data-src="link">链接</button>
    </div>
    <p class="music-src-text">一次选好，一起听。支持 MP3、M4A、WAV 等浏览器可播放格式；本地音乐仅在本次打开期间可用，链接会保存下来。</p>
    <button class="ghost-btn wide" id="musicPickFiles">添加音乐 · 文件</button>
    <div class="music-link-row">
      <input class="input" id="musicUrl" placeholder="https://… 音频直链">
      <button class="ghost-btn" id="musicUrlAdd">添加</button>
    </div>
    <button class="ghost-btn wide danger" id="musicClear">清空已导入音乐</button>
  `);

  $$('.music-src').forEach(btn => {
    btn.onclick = () => {
      $$('.music-src').forEach(b => b.classList.toggle('active', b === btn));
      $('#musicUrl').closest('.music-link-row').style.display = btn.dataset.src === 'link' ? '' : 'none';
    };
  });
  $('#musicUrl').closest('.music-link-row').style.display = 'none';

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
    const input = $('#musicUrl');
    const url = input.value.trim();
    if (!/^https?:\/\//i.test(url)) {
      toast('请输入 http(s) 开头的链接');
      return;
    }
    const name = url.split('/').pop().replace(/\.\w+($|\?)/, '') || '未命名';
    commit(s => {
      s.music.tracks.push({ id: uid(), name, artist: '', url, cover: '', lyrics: '' });
    });
    closeSheet();
    render();
    toast('已添加');
  };

  $('#musicClear').onclick = () => {
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
  };
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

export function initMusic() {
  bind();
  bindSwipe();

  router.register('music', { onOpen: () => {
    render();
    if (audio && audio.src && !audio.paused) return;
  } });

  subscribe(() => {
    if (router.isOpen('music')) render();
  });

  render();
}
