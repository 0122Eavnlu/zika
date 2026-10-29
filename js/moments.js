import { get, commit, subscribe } from './state.js';
import { $, escapeHtml, timeText, setAvatar, toast, uid, randInt, pick, pickFile, compressImage } from './util.js';
import { openSheet, closeSheet, sheetTitle, promptSheet } from './ui.js';
import * as router from './router.js';

let origin = 'home';
let draft = { text: '', stickerUrl: '', imageUrl: '', fromCards: false };

const HEART = `<svg viewBox="0 0 24 24"><path d="M12 20.2c-.3 0-.6-.1-.8-.3C6.9 16 3.6 13.2 2.1 10.7 1 8.8 1 6.3 2.4 4.7c1.6-1.8 4.4-1.9 6.2-.3.5.4 1 1 1.4 1.6.4-.6.9-1.2 1.4-1.6 1.8-1.6 4.6-1.5 6.2.3 1.4 1.6 1.4 4.1.3 6-1.5 2.5-4.8 5.3-9.1 9.2-.2.2-.5.3-.8.3z"/></svg>`;
const BUBBLE = `<svg viewBox="0 0 24 24"><path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H10l-4.6 3.1a.6.6 0 0 1-.9-.5V16.5H4A1.5 1.5 0 0 1 2.5 15V7A1.5 1.5 0 0 1 4 5.5z"/></svg>`;

function persona() { return get().persona; }
function me() { return get().me; }

function cardsPool() {
  const s = get();
  const groups = new Map(s.cards.groups.map(g => [g.id, g]));
  return s.cards.items.filter(c => {
    if (c.blocked) return false;
    const g = groups.get(c.groupId);
    if (g && (g.blocked || g.name === '状态')) return false;
    return Boolean(c.text);
  });
}

function shotMessages() {
  const items = get().messages
    .filter(m => (!m.type || m.type === 'text' || m.type === 'sticker' || m.type === 'emoji') && (m.text || m.stickerUrl))
    .slice(-6);
  return items.map(m => ({
    role: m.role,
    type: m.type || 'text',
    text: m.text || '',
    stickerUrl: m.stickerUrl || '',
  }));
}

function makeThemPost() {
  const b = get().behavior;
  const stickers = get().stickers;
  const cards = cardsPool();
  const shot = shotMessages();
  const post = {
    id: uid(),
    by: 'them',
    ts: Date.now(),
    text: '',
    stickerUrl: '',
    imageUrl: '',
    shot,
  };
  if (shot.length >= 4 && randInt(0, 99) < (Number(b.momentShotChance) || 50)) {
    post.shot = shot;
    return post;
  }
  post.shot = [];
  const canSticker = stickers.length > 0;
  const canCard = cards.length > 0;
  if (!canSticker && !canCard) return null;
  const roll = Math.random();
  if (canSticker && (!canCard || roll < .4)) {
    post.stickerUrl = pick(stickers).url;
  } else if (canCard && (!canSticker || roll < .75)) {
    post.text = pick(cards).text;
    post.fromCards = true;
  } else {
    post.text = pick(cards).text;
    post.stickerUrl = pick(stickers).url;
    post.fromCards = true;
  }
  return post;
}

function maybePost() {
  const b = get().behavior;
  const posts = get().moments.posts;
  const last = posts.filter(p => p.by === 'them').sort((a, c) => c.ts - a.ts)[0];
  if (last && Date.now() - last.ts < 20 * 60 * 1000) return;
  if (randInt(0, 99) >= (Number(b.momentChance) || 70)) return;
  const post = makeThemPost();
  if (!post) return;
  commit(s => { s.moments.posts.unshift(post); });
  render();
}

function reactToMyPost(postId) {
  const b = get().behavior;
  setTimeout(() => {
    const post = get().moments.posts.find(p => p.id === postId);
    if (!post) return;
    const reply = randInt(0, 99) < (Number(b.momentReplyChance) || 70);
    const cards = cardsPool();
    const text = reply && cards.length ? pick(cards).text : '';
    commit(s => {
      const p = s.moments.posts.find(x => x.id === postId);
      if (!p) return;
      p.likedByThem = true;
      if (text) {
        p.comments = p.comments || [];
        p.comments.push({ id: uid(), by: 'them', text, ts: Date.now() });
      }
    });
    render();
  }, randInt(1500, 4000));
}

/* ---------- 渲染 ---------- */

function shotHtml(shot) {
  const name = me().name || '我';
  const rows = shot.map(m => {
    const mine = m.role === 'me';
    const body = m.type === 'sticker' && m.stickerUrl
      ? `<img src="${escapeHtml(m.stickerUrl)}" alt="">`
      : escapeHtml(m.text || '');
    return `<div class="shot-row ${mine ? 'me' : 'them'}"><span class="shot-bubble ${m.type === 'sticker' ? 'pic' : ''}">${body}</span></div>`;
  }).join('');
  return `<div class="moment-shot"><div class="shot-head">${escapeHtml(name)}</div><div class="shot-body">${rows}</div></div>`;
}

function postHtml(post) {
  const mine = post.by === 'me';
  const who = mine ? me() : persona();
  const liked = mine ? Boolean(post.likedByThem) : Boolean(post.likedByMe);
  const likedLabel = mine ? (liked ? '对方已赞' : '') : (liked ? '已赞' : '赞');
  const comments = post.comments || [];
  const commentCount = comments.length;

  let body = '';
  if (post.text) body += `<div class="moment-text">${escapeHtml(post.text)}</div>`;
  if (post.stickerUrl) body += `<div class="moment-pic"><img src="${escapeHtml(post.stickerUrl)}" alt=""></div>`;
  if (post.imageUrl) body += `<div class="moment-photo"><img src="${escapeHtml(post.imageUrl)}" alt=""></div>`;
  if (post.shot && post.shot.length) body += shotHtml(post.shot);
  if (post.fromCards && post.text) body += `<div class="moment-tag">来自字卡</div>`;

  const commentHtml = comments.length
    ? `<div class="moment-comments">${comments.map(c => `
        <div class="comment-line"><b>${escapeHtml(c.by === 'me' ? (me().name || '我') : (persona().name || '对方'))}</b>：${escapeHtml(c.text)}</div>
      `).join('')}</div>`
    : '';

  return `<article class="moment" data-post="${post.id}">
    <div class="moment-head">
      <span class="avatar moment-avatar" data-avatar="${post.id}"></span>
      <div class="moment-name">${escapeHtml(who.name || '')}</div>
    </div>
    ${body}
    <div class="moment-foot">
      <span class="moment-time">${timeText(post.ts)}</span>
      <div class="moment-acts">
        <button class="moment-act ${liked && !mine ? 'liked' : ''}" data-like="${post.id}" ${mine ? 'disabled' : ''}>
          <span class="heart ${liked ? 'on' : ''}">${HEART}</span>${escapeHtml(likedLabel)}
        </button>
        <button class="moment-act" data-comment="${post.id}"><span class="bubble-ic">${BUBBLE}</span>${commentCount || ''}</button>
      </div>
    </div>
    ${commentHtml}
  </article>`;
}

function render() {
  const s = get();
  const meAvatar = $('#momentsMeAvatar');
  setAvatar(meAvatar, me().name, me().avatar);
  const meName = $('#momentsMeName');
  meName.textContent = me.avatar ? (me().name || '我') : '';
  meName.style.display = me.avatar ? '' : 'none';

  const cover = $('#momentsCover');
  if (s.moments.bg) {
    cover.style.backgroundImage = `url("${s.moments.bg}")`;
    cover.classList.add('has-bg');
  } else {
    cover.style.backgroundImage = '';
    cover.classList.remove('has-bg');
  }

  const list = $('#momentsList');
  const posts = [...s.moments.posts].sort((a, b) => b.ts - a.ts);
  list.innerHTML = posts.map(postHtml).join('');
  $('#momentsEmpty').hidden = posts.length > 0;

  posts.forEach(p => {
    const el = $(`.moment[data-post="${p.id}"] .moment-avatar`);
    const who = p.by === 'me' ? me() : persona();
    setAvatar(el, who.name, who.avatar);
  });
}

/* ---------- 发布 ---------- */

function draftHtml() {
  const bits = [];
  if (draft.stickerUrl) bits.push(`<div class="draft-chip pic"><img src="${escapeHtml(draft.stickerUrl)}" alt=""><button data-clear="sticker">×</button></div>`);
  if (draft.imageUrl) bits.push(`<div class="draft-chip pic"><img src="${escapeHtml(draft.imageUrl)}" alt=""><button data-clear="image">×</button></div>`);
  if (!bits.length) return '';
  return `<div class="moment-draft">${bits.join('')}</div>`;
}

function refreshDraft() {
  const wrap = $('#momentDraft');
  if (wrap) wrap.innerHTML = draftHtml();
  const text = $('#momentText');
  if (text && document.activeElement !== text) text.value = draft.text;
  $$clearBind();
}

function $$clearBind() {
  document.querySelectorAll('.draft-chip [data-clear]').forEach(btn => {
    btn.onclick = () => {
      if (btn.dataset.clear === 'sticker') draft.stickerUrl = '';
      else draft.imageUrl = '';
      refreshDraft();
    };
  });
}

function openCardPick() {
  const cards = cardsPool();
  if (!cards.length) { toast('字卡库里还没有可用的字卡'); return; }
  const panel = $('#momentPanel');
  panel.hidden = false;
  panel.innerHTML = `<div class="pick-list">${cards.slice(0, 60).map(c => `<button class="pick-line" data-card="${c.id}">${escapeHtml(c.text)}</button>`).join('')}</div>`;
  panel.querySelectorAll('[data-card]').forEach(btn => {
    btn.onclick = () => {
      const card = get().cards.items.find(c => c.id === btn.dataset.card);
      if (!card) return;
      draft.text = card.text;
      draft.fromCards = true;
      panel.hidden = true;
      refreshDraft();
    };
  });
}

function openStickerPick() {
  const stickers = get().stickers;
  if (!stickers.length) { toast('还没有上传表情包'); return; }
  const panel = $('#momentPanel');
  panel.hidden = false;
  panel.innerHTML = `<div class="pick-stickers">${stickers.map(s => `<button class="pick-sticker" data-sticker="${s.id}"><img src="${escapeHtml(s.url)}" alt=""></button>`).join('')}</div>`;
  panel.querySelectorAll('[data-sticker]').forEach(btn => {
    btn.onclick = () => {
      const st = get().stickers.find(x => x.id === btn.dataset.sticker);
      if (!st) return;
      draft.stickerUrl = st.url;
      panel.hidden = true;
      refreshDraft();
    };
  });
}

function openCompose() {
  draft = { text: '', stickerUrl: '', imageUrl: '', fromCards: false };
  openSheet(`
    ${sheetTitle('发布朋友圈')}
    <div class="sheet-form">
      <textarea class="input area" id="momentText" rows="4" placeholder="这一刻的想法…" maxlength="4000"></textarea>
    </div>
    <div class="moment-picks">
      <button class="pick-btn" id="pickCard">字卡</button>
      <button class="pick-btn" id="pickSticker">表情包</button>
      <button class="pick-btn" id="pickImage">图片</button>
    </div>
    <div class="moment-panel" id="momentPanel" hidden></div>
    <div id="momentDraft"></div>
    <div class="sheet-actions">
      <button class="btn-ghost" id="momentCancel">取消</button>
      <button class="btn-ink" id="momentPublish">发布</button>
    </div>
  `);

  $('#momentText').addEventListener('input', e => {
    draft.text = e.target.value;
    if (e.target.value) draft.fromCards = false;
  });
  $('#pickCard').onclick = openCardPick;
  $('#pickSticker').onclick = openStickerPick;
  $('#pickImage').onclick = async () => {
    const file = await pickFile('image/*');
    if (!file) return;
    try {
      draft.imageUrl = await compressImage(file, 1400, .84);
      refreshDraft();
    } catch { toast('图片处理失败'); }
  };
  $('#momentCancel').onclick = closeSheet;
  $('#momentPublish').onclick = () => publish();
}

function publish() {
  if (!draft.text && !draft.stickerUrl && !draft.imageUrl) {
    toast('先写点什么或选一张图');
    return;
  }
  const post = {
    id: uid(),
    by: 'me',
    ts: Date.now(),
    text: draft.text.trim(),
    stickerUrl: draft.stickerUrl,
    imageUrl: draft.imageUrl,
    shot: [],
    fromCards: draft.fromCards,
    likedByMe: false,
    likedByThem: false,
    comments: [],
  };
  commit(s => { s.moments.posts.unshift(post); });
  closeSheet();
  render();
  toast('已发布');
  reactToMyPost(post.id);
}

/* ---------- 互动 ---------- */

function toggleLike(id) {
  commit(s => {
    const p = s.moments.posts.find(x => x.id === id);
    if (p && p.by === 'them') p.likedByMe = !p.likedByMe;
  });
  render();
}

async function addComment(id) {
  const post = get().moments.posts.find(p => p.id === id);
  if (!post) return;
  const text = await promptSheet({ title: '评论', placeholder: '写点评论…', confirm: '发送' });
  if (!text || !text.trim()) return;
  commit(s => {
    const p = s.moments.posts.find(x => x.id === id);
    if (!p) return;
    p.comments = p.comments || [];
    p.comments.push({ id: uid(), by: 'me', text: text.trim(), ts: Date.now() });
  });
  render();
}

/* ---------- 背景 ---------- */

async function pickBg() {
  const file = await pickFile('image/*');
  if (!file) return;
  try {
    const data = await compressImage(file, 1600, .84);
    commit(s => { s.moments.bg = data; });
    render();
    toast('已更换背景');
  } catch { toast('图片处理失败'); }
}

/* ---------- 初始化 ---------- */

export function openMoments(from = 'home') {
  origin = from;
  router.open('moments');
}

export function initMoments() {
  $('#momentAdd').onclick = openCompose;
  $('#momentsBgPick').onclick = pickBg;
  $('[data-moments-back]').onclick = () => {
    if (origin === 'chat' && router.isOpen('moments')) router.open('chat');
    else router.close();
  };

  $('#momentsList').addEventListener('click', event => {
    const likeBtn = event.target.closest('[data-like]');
    if (likeBtn) { toggleLike(likeBtn.dataset.like); return; }
    const commentBtn = event.target.closest('[data-comment]');
    if (commentBtn) { addComment(commentBtn.dataset.comment); }
  });

  router.register('moments', { onOpen: () => { render(); maybePost(); } });
  subscribe(() => { if (router.isOpen('moments')) render(); });
}
