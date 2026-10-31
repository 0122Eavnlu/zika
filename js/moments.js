import { get, commit, subscribe } from './state.js?v=20261031r';
import { $, escapeHtml, timeText, setAvatar, toast, uid, randInt, pick, pickFile, compressImage } from './util.js?v=20261031r';
import { openSheet, closeSheet, sheetTitle, promptSheet } from './ui.js?v=20261031r';
import * as router from './router.js?v=20261031r';

let origin = 'home';
let draft = { text: '', stickerUrl: '', imageUrl: '', fromCards: false };

const HEART = `<svg viewBox="0 0 24 24"><path d="M12 20.2c-.3 0-.6-.1-.8-.3C6.9 16 3.6 13.2 2.1 10.7 1 8.8 1 6.3 2.4 4.7c1.6-1.8 4.4-1.9 6.2-.3.5.4 1 1 1.4 1.6.4-.6.9-1.2 1.4-1.6 1.8-1.6 4.6-1.5 6.2.3 1.4 1.6 1.4 4.1.3 6-1.5 2.5-4.8 5.3-9.1 9.2-.2.2-.5.3-.8.3z"/></svg>`;
const BUBBLE = `<svg viewBox="0 0 24 24"><path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H10l-4.6 3.1a.6.6 0 0 1-.9-.5V16.5H4A1.5 1.5 0 0 1 2.5 15V7A1.5 1.5 0 0 1 4 5.5z"/></svg>`;
const STAR = `<svg viewBox="0 0 24 24"><path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/></svg>`;

function saveMoment(id) {
  const post = get().moments.posts.find(p => p.id === id);
  if (!post) return;
  const mine = post.by === 'me';
  commit(s => {
    s.favorites = s.favorites || { his: [], mine: [] };
    const list = s.favorites[mine ? 'his' : 'mine'];
    if (!list.some(x => x.id === id)) {
      list.unshift({
        id,
        kind: 'moment',
        text: post.text || '',
        url: post.imageUrl || post.stickerUrl || '',
        at: Date.now(),
      });
    }
  });
  toast('已收藏');
}

const POST_CHANCE = 85;   // 对方发朋友圈
const SHOT_CHANCE = 55;   // 拼字卡 / 聊天截图发朋友圈
const REPLY_CHANCE = 96;  // 回复我的朋友圈、回复我的评论

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
  if (shot.length >= 4 && randInt(0, 99) < SHOT_CHANCE) {
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
  } else if (canCard && (!canSticker || roll < .7)) {
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
  const minGap = Math.min(1440, Math.max(5, Number(b.momentPostGapMin) || 20));
  const maxGap = Math.max(minGap, Math.min(1440, Number(b.momentPostGapMax) || minGap));
  const gapMs = randInt(minGap, maxGap) * 60 * 1000;
  if (last && Date.now() - last.ts < gapMs) return;
  if (randInt(0, 99) >= POST_CHANCE) return;
  const post = makeThemPost();
  if (!post) return;
  commit(s => { s.moments.posts.unshift(post); });
  render();
}

function reactToMyPost(postId) {
  const b = get().behavior;
  const dMin = Math.min(300, Math.max(30, Number(b.momentReplyDelayMin) || 30));
  const dMax = Math.max(dMin, Math.min(300, Number(b.momentReplyDelayMax) || dMin));
  setTimeout(() => {
    const post = get().moments.posts.find(p => p.id === postId);
    if (!post) return;
    const reply = randInt(0, 99) < REPLY_CHANCE;
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
  }, randInt(dMin, dMax) * 1000);
}

/* ---------- 渲染 ---------- */

function shotHtml(shot) {
  const rows = shot.map(m => {
    const self = m.role === 'them'; // 对方视角：对方自己发的在右侧
    const body = m.type === 'sticker' && m.stickerUrl
      ? `<img src="${escapeHtml(m.stickerUrl)}" alt="">`
      : escapeHtml(m.text || '');
    const avatar = `<span class="avatar shot-avatar" data-shot-role="${self ? 'them' : 'me'}"></span>`;
    return `<div class="shot-row ${self ? 'right' : 'left'}">${self ? '' : avatar}<span class="shot-bubble ${m.type === 'sticker' ? 'pic' : ''}">${body}</span>${self ? avatar : ''}</div>`;
  }).join('');
  return `<div class="moment-shot"><div class="shot-head"><span class="avatar shot-head-avatar" data-shot-role="me"></span><span class="shot-name">${escapeHtml(me().name || '我')}</span></div><div class="shot-body">${rows}</div></div>`;
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

  const whoName = c => (c.by === 'me' ? (me().name || '我') : (persona().name || '对方'));
  const commentHtml = comments.length
    ? `<div class="moment-comments">${comments.map(c => {
        const prefix = c.to ? `${whoName(c)} 回复 ${c.toName || ''}：` : `${whoName(c)}：`;
        return `<div class="comment-line ${c.to ? 'reply' : ''}" data-reply="${post.id}|${c.id}"><b>${escapeHtml(prefix)}</b>${escapeHtml(c.text)}</div>`;
      }).join('')}</div>`
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
        <button class="moment-act" data-save="${post.id}" aria-label="收藏"><span class="save-ic">${STAR}</span></button>
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
    document.querySelectorAll(`.moment[data-post="${p.id}"] .shot-avatar[data-shot-role], .moment[data-post="${p.id}"] .shot-head-avatar[data-shot-role]`).forEach(av => {
      const who2 = av.dataset.shotRole === 'me' ? me() : persona();
      setAvatar(av, who2.name, who2.avatar);
    });
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
  const sheet = openSheet(`
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
  sheet.classList.add('sheet-white');

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

async function addComment(id, targetCommentId = '') {
  const post = get().moments.posts.find(p => p.id === id);
  if (!post) return;
  const target = targetCommentId ? (post.comments || []).find(c => c.id === targetCommentId) : null;
  const who = target ? (target.by === 'me' ? (me().name || '我') : (persona().name || '对方')) : '';
  const title = target ? `回复 ${who}` : '评论';
  const text = await promptSheet({ title, placeholder: target ? '写下回复…' : '写点评论…', confirm: '发送' });
  if (!text || !text.trim()) return;
  const entryId = uid();
  commit(s => {
    const p = s.moments.posts.find(x => x.id === id);
    if (!p) return;
    p.comments = p.comments || [];
    const entry = { id: entryId, by: 'me', text: text.trim(), ts: Date.now() };
    if (target) {
      entry.to = target.id;
      entry.toName = who;
    }
    p.comments.push(entry);
  });
  render();
  if (post.by === 'them') reactToMyComment(id, entryId);
}

function reactToMyComment(postId, commentId) {
  const b = get().behavior;
  const dMin = Math.min(300, Math.max(30, Number(b.momentReplyDelayMin) || 30));
  const dMax = Math.max(dMin, Math.min(300, Number(b.momentReplyDelayMax) || dMin));
  setTimeout(() => {
    const post = get().moments.posts.find(p => p.id === postId);
    if (!post) return;
    if (randInt(0, 99) >= REPLY_CHANCE) return;
    const cards = cardsPool();
    if (!cards.length) return;
    const text = pick(cards).text;
    commit(s => {
      const p = s.moments.posts.find(x => x.id === postId);
      if (!p) return;
      const target = (p.comments || []).find(c => c.id === commentId);
      p.comments = p.comments || [];
      p.comments.push({ id: uid(), by: 'them', text, ts: Date.now(), to: commentId, toName: me().name || '我' });
      if (target && target.by === 'them') p.likedByThem = true;
    });
    render();
  }, randInt(dMin, dMax) * 1000);
}

/* ---------- 背景 ---------- */

async function pickBg() {
  const file = await pickFile('image/*');
  if (!file) return;
  try {
    const data = await compressImage(file, 1280, .8);
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
  $('.app[data-app="moments"]')?.addEventListener('click', () => { origin = 'home'; });
  $('#momentAdd').onclick = openCompose;
  $('#momentsBgPick').onclick = pickBg;
  $('#momentsScroll').addEventListener('scroll', () => {
    $('#screen-moments').classList.toggle('scrolled', $('#momentsScroll').scrollTop > 40);
  }, { passive: true });
  $('[data-moments-back]').onclick = () => {
    if (origin === 'chat' && router.isOpen('moments')) router.open('chat');
    else router.close();
  };

  $('#momentsList').addEventListener('click', event => {
    const likeBtn = event.target.closest('[data-like]');
    if (likeBtn) { toggleLike(likeBtn.dataset.like); return; }
    const line = event.target.closest('[data-reply]');
    if (line) {
      const [postId, commentId] = line.dataset.reply.split('|');
      addComment(postId, commentId);
      return;
    }
    const commentBtn = event.target.closest('[data-comment]');
    if (commentBtn) { addComment(commentBtn.dataset.comment); return; }
    const saveBtn = event.target.closest('[data-save]');
    if (saveBtn) saveMoment(saveBtn.dataset.save);
  });

  router.register('moments', { onOpen: () => { render(); maybePost(); } });
  subscribe(() => { if (router.isOpen('moments')) render(); });
}
