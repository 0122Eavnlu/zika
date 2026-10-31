import { get, commit, subscribe } from './state.js?v=20261031E';
import { $, $$, escapeHtml, timeText, setAvatar, toast, sleep, randInt, randFloat, pick, uid, pickFile, prepareSticker, compressImage } from './util.js?v=20261031E';
import { openSheet, closeSheet, sheetTitle, confirmSheet, actionSheet, promptSheet } from './ui.js?v=20261031E';
import * as router from './router.js?v=20261031E';
import { playSound } from './audio.js?v=20261031E';
import { startCall } from './call.js?v=20261031E';
import { openMoments } from './moments.js?v=20261031E';
import { pickLyric, isListening } from './music.js?v=20261031E';
import { speak, hasTTS, voiceRateChance } from './tts.js?v=20261031E';

let busy = false;
let replying = false;
let proTimer = null;
let proSignature = '';
let typingVisible = false;
const openMeta = new Set();
const fresh = new Set();

const SEPARATORS = ['，', '、', '；', '。'];
const CALL_ICON = `<svg viewBox="0 0 24 24"><rect x="2.5" y="7" width="12.5" height="10" rx="3"/><path d="M15 11.2l5.4-3.1a.6.6 0 0 1 .9.5v6.8a.6.6 0 0 1-.9.5l-5.4-3.1z"/></svg>`;

const readLabel = style => ({ text: '已读', check: '✓', double: '✓✓' }[style] || '已读');

function persona() {
  return get().persona;
}

function members() {
  const s = get();
  if (!s.group.enabled || !s.group.members.length) return [persona()];
  return s.group.members;
}

function memberById(id) {
  return get().group.members.find(m => m.id === id) || persona();
}

function senderOf(msg) {
  return msg.senderId ? memberById(msg.senderId) : persona();
}

function displayNameFor(msg) {
  return msg.role === 'me' ? '我' : senderOf(msg).name;
}

function availableCards() {
  const s = get();
  const groups = new Map(s.cards.groups.map(g => [g.id, g]));
  return s.cards.items.filter(c => {
    if (c.blocked) return false;
    const g = groups.get(c.groupId);
    if (!g) return true;
    if (g.blocked) return false;
    return g.name !== '状态';
  });
}

/* ---------- 渲染 ---------- */

function updateIdentity() {
  const p = persona();
  const avatarEl = $('#chatAvatar');
  const nameEl = $('#chatName');
  setAvatar(avatarEl, p.name, p.avatar);
  avatarEl.style.display = p.showAvatar ? '' : 'none';
  nameEl.textContent = p.name || '';
  nameEl.style.display = p.showName ? '' : 'none';
  $('#chatStatus').textContent = p.status || '';
  $('#chatStatus').style.display = 'none';
  $('#emptyName').textContent = p.name || '';
  $('#emptyName').style.display = p.showName ? '' : 'none';
  setAvatar($('#emptyAvatar'), p.name, p.avatar);
  $('#emptyAvatar').style.display = p.showAvatar ? '' : 'none';
  setAvatar($('#typingAvatar'), p.name, p.avatar);
  $('#typingAvatar').style.display = p.showAvatar ? '' : 'none';

  const bg = get().ui.chatBg;
  const chatBg = $('#chatBg');
  if (bg) {
    chatBg.style.backgroundImage = `url("${bg}")`;
    chatBg.classList.remove('empty');
  } else {
    chatBg.style.backgroundImage = '';
    chatBg.classList.add('empty');
  }
  $('#screen-chat').classList.toggle('has-bg', Boolean(bg));
}

function callSub(msg) {
  if (msg.callStatus === 'missed') return '对方暂时没有接听';
  if (msg.callStatus === 'declined') return '对方已挂断';
  const sec = Math.max(0, Number(msg.callDur) || 0);
  return `通话时长 ${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

const FA_COPY = `<svg viewBox="0 0 24 24"><rect x="8.5" y="3.5" width="11" height="12" rx="3"/><path d="M15.5 19.5H7A3 3 0 0 1 4.5 16.5V9"/></svg>`;
const FA_QUOTE = `<svg viewBox="0 0 24 24"><path d="M9 6.5L4.5 11l4.5 4.5M4.8 11h8.7a5.5 5.5 0 0 1 5.5 5.5v1.6"/></svg>`;
const FA_BUBBLE = `<svg viewBox="0 0 24 24"><path d="M20.5 11.6a8.5 8.5 0 0 1-12.4 7.5L3.5 20.5l1.4-4.6a8.5 8.5 0 1 1 15.6-4.3z"/><circle cx="8.6" cy="11.7" r="1"/><circle cx="12" cy="11.7" r="1"/><circle cx="15.4" cy="11.7" r="1"/></svg>`;
const FA_STAR = `<svg viewBox="0 0 24 24"><path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z"/></svg>`;
const FA_TRASH = `<svg viewBox="0 0 24 24"><path d="M4.5 7h15M9.2 7V5.2a1.4 1.4 0 0 1 1.4-1.4h2.8a1.4 1.4 0 0 1 1.4 1.4V7M6.5 7l.9 12a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-12"/></svg>`;
const FA_VOICE = `<svg viewBox="0 0 24 24"><path d="M4.6 10v4M8.6 7.4v9.2M12.6 4.8v14.4M16.6 8.4v7.2M20.4 10.6v2.8"/></svg>`;
const FA_TEXT = `<svg viewBox="0 0 24 24"><rect x="5" y="3.6" width="14" height="16.8" rx="3"/><path d="M8.6 8.6h6.8M8.6 12h6.8M8.6 15.4h3.8"/></svg>`;

function buildMessage(msg) {
  const p = persona();
  const isMe = msg.role === 'me';
  const type = msg.type || 'text';

  if (type === 'nudge') {
    return `<div class="msg nudge ${fresh.has(msg.id) ? 'fresh' : ''}" data-id="${msg.id}"><span>${escapeHtml(msg.text)}</span></div>`;
  }

  if (type === 'recall') {
    return `<div class="msg recall ${fresh.has(msg.id) ? 'fresh' : ''}" data-id="${msg.id}"><span>${escapeHtml(msg.text || '对方撤回了一条消息')}</span></div>`;
  }

  const sender = senderOf(msg);
  const showAvatar = !isMe && p.showAvatar;
  const showName = !isMe && p.showName && get().group.enabled;
  const meta = [];
  if (get().ui.timeOn) meta.push(`<span class="t">${timeText(msg.ts)}</span>`);
  if (isMe && msg.read && get().ui.readOn) {
    meta.push(`<span class="read ok">${escapeHtml(readLabel(get().ui.readStyle))}</span>`);
  }

  let bubbleCls = 'bubble';
  let inner = '';
  if (type === 'sticker') {
    bubbleCls = 'bubble sticker';
    inner = `<img src="${escapeHtml(msg.stickerUrl || '')}" alt="">`;
  } else if (type === 'emoji') {
    bubbleCls = 'bubble emoji';
    inner = escapeHtml(msg.text || '');
  } else if (type === 'call') {
    inner = `<div class="call-msg"><span class="call-ic">${CALL_ICON}</span><div><div class="call-title">${escapeHtml(msg.text || '视频通话')}</div><div class="call-sub">${escapeHtml(callSub(msg))}</div></div></div>`;
  } else if (type === 'lyric') {
    bubbleCls = 'bubble lyric';
    inner = escapeHtml(msg.lyric || msg.text || '');
  } else if (type === 'voice') {
    bubbleCls = 'bubble voice';
    const vText = msg.voiceText || msg.text || '';
    const sec = Math.max(1, Number(msg.voiceDur) || Math.round(vText.length / 4));
    inner = `<div class="voice-msg"><span class="voice-wave"><i></i><i></i><i></i><i></i></span><span class="voice-track"></span><span class="voice-dur">${sec}"</span></div>`;
  } else if (type === 'quiz') {
    bubbleCls = 'bubble quiz';
    const q = msg.quiz || {};
    const opts = (q.options || []).map((o, i) => {
      const on = (q.chosen || []).includes(i) ? ' on' : '';
      return `<div class="quiz-opt${on}"><span class="quiz-tick">✓</span><span class="quiz-label">${escapeHtml(o.text)}</span></div>`;
    }).join('');
    inner = `<div class="quiz-q">${escapeHtml(msg.text || '')}</div><div class="quiz-opts">${opts}</div>${q.answer ? `<div class="quiz-ans">${escapeHtml(q.answer)}</div>` : ''}`;
  } else {
    inner = (msg.quote ? `<span class="quote">${escapeHtml(msg.quote)}</span>` : '') + escapeHtml(msg.text);
  }

  // 气泡皮肤兼容：文字 / 歌词气泡额外挂 .message-sent / .message-received，
  // 并把内容包进 .content-wrapper，外部皮肤 CSS 可正常生效（含左右镜像写法）。
  const skinnable = type === 'text' || type === 'lyric';
  if (skinnable) bubbleCls += isMe ? ' message-sent' : ' message-received';
  if (type !== 'sticker' && type !== 'emoji' && type !== 'call' && type !== 'quiz' && type !== 'voice') inner = `<span class="content-wrapper">${inner}</span>`;

  const avatarHtml = showAvatar ? `<span class="avatar" data-avatar="${msg.id}"></span>` : '';
  const meAvatarHtml = isMe ? `<span class="avatar me-avatar" data-avatar="${msg.id}" aria-label="我的资料"></span>` : '';
  const mini = msg.bubbleText ? `<span class="msg-mini">${escapeHtml(msg.bubbleText)}</span>` : '';
  const convertBtn = type === 'voice'
    ? `<button data-fa="toText" aria-label="转文字">${FA_TEXT}</button>`
    : (!isMe && type === 'text' ? `<button data-fa="toVoice" aria-label="转语音">${FA_VOICE}</button>` : '');
  const actions = `<div class="msg-actions">
      <button data-fa="copy" aria-label="复制">${FA_COPY}</button>
      <button data-fa="quote" aria-label="引用">${FA_QUOTE}</button>
      ${convertBtn}
      <button data-fa="bubble" aria-label="添加小气泡">${FA_BUBBLE}</button>
      <button data-fa="fav" aria-label="收藏">${FA_STAR}</button>
      <button data-fa="del" class="danger" aria-label="删除">${FA_TRASH}</button>
    </div>`;
  return `<div class="msg ${isMe ? 'me' : 'them'} ${showAvatar || isMe ? '' : 'no-avatar'} ${openMeta.has(msg.id) ? 'show-meta' : ''} ${fresh.has(msg.id) ? 'fresh' : ''}" data-id="${msg.id}">${avatarHtml}<div class="bubble-wrap">${showName ? `<div class="sender-name">${escapeHtml(sender.name)}</div>` : ''}${mini}<div class="${bubbleCls}">${inner}</div>${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}${actions}</div>${meAvatarHtml}</div>`;
}

function render(forceBottom = false) {
  updateIdentity();
  const list = $('#msgList');
  const scroll = $('#msgScroll');
  const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 70;
  const messages = get().messages;
  $('#emptyChat').classList.toggle('hidden', messages.length > 0);
  list.innerHTML = messages.map(buildMessage).join('');
  fresh.clear();
  $$('.msg .avatar[data-avatar]', list).forEach(el => {
    const msg = messages.find(m => m.id === el.dataset.avatar);
    if (!msg) return;
    if (msg.role === 'me') {
      const me = get().me;
      setAvatar(el, me.name, me.avatar);
      return;
    }
    const sender = senderOf(msg);
    setAvatar(el, sender.name, sender.avatar);
  });
  updateBadge();
  if (forceBottom || nearBottom) {
    requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; });
  }
}

function updateBadge() {
  const unseen = get().messages.filter(m => m.role === 'them' && !m.seen).length;
  const badge = $('#chatBadge');
  badge.hidden = unseen === 0;
  badge.textContent = unseen > 99 ? '99+' : String(unseen);
}

/* ---------- 消息操作 ---------- */

function addIncoming(msgParts) {
  const seen = router.isOpen('chat') && !document.hidden;
  const id = uid();
  fresh.add(id);
  commit(st => {
    st.messages.push({
      id,
      role: 'them',
      type: msgParts.type || 'text',
      text: msgParts.text || '',
      stickerUrl: msgParts.stickerUrl || '',
      ts: Date.now(),
      senderId: msgParts.senderId || '',
      quote: msgParts.quote || '',
      song: msgParts.song || '',
      lyric: msgParts.lyric || '',
      lead: msgParts.lead || '',
      seen,
    });
  });
  if (!seen && msgParts.text) notifyIncoming(msgParts.text, msgParts.senderName);
  return id;
}

function markSelfRead() {
  const s = get();
  if (!s.messages.some(m => m.role === 'me' && !m.read)) return;
  commit(st => { st.messages.forEach(m => { if (m.role === 'me') m.read = true; }); });
}

/* 对方撤回：把刚发的消息换成一条居中提示 */
function recallMessage(id) {
  commit(st => {
    const idx = st.messages.findIndex(m => m.id === id);
    if (idx < 0) return;
    st.messages[idx] = {
      id: st.messages[idx].id,
      role: 'them',
      type: 'recall',
      text: '对方撤回了一条消息',
      ts: Date.now(),
      seen: true,
      senderId: '',
    };
  });
  render(true);
}

function markSeen() {
  if (document.hidden) return;
  const s = get();
  if (!s.messages.some(m => m.role === 'them' && !m.seen)) return;
  commit(st => { st.messages.forEach(m => { if (m.role === 'them') m.seen = true; }); });
}

async function notifyIncoming(text, senderName) {
  const b = get().behavior;
  if (!b.notify) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const p = persona();
  const title = get().group.enabled && senderName ? `${senderName} · ${p.name}` : p.name;
  const options = {
    body: text.length > 60 ? text.slice(0, 60) + '…' : text,
    tag: 'zika-chat',
    silent: true,
    icon: p.avatar || undefined,
  };
  try {
    if (navigator.serviceWorker) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.showNotification(title, options);
        return;
      }
    }
  } catch {}
  try {
    const n = new Notification(title, options);
    n.onclick = () => {
      window.focus();
      router.open('chat');
      markSeen();
      n.close();
    };
  } catch {}
}

function deleteMessage(id) {
  commit(s => { s.messages = s.messages.filter(m => m.id !== id); });
  openMeta.delete(id);
}

function handleTap(row, id) {
  const msg = get().messages.find(m => m.id === id);
  if (!msg) return;
  if (msg.type === 'voice') {
    if (hasTTS()) speak(msg.voiceText || '', { silent: true });
    else toast('先在「设定 → 语音」里配置');
    return;
  }
  if (openMeta.has(id)) openMeta.delete(id); else openMeta.add(id);
  row.classList.toggle('show-meta');
}

let pendingQuote = '';

function clearQuote() {
  pendingQuote = '';
  const bar = $('#quoteBar');
  if (bar) bar.hidden = true;
}

function setQuote(msg) {
  pendingQuote = msg.type === 'sticker' ? '[表情包]' : (msg.text || '').slice(0, 40);
  const bar = $('#quoteBar');
  if (!bar) return;
  $('#quoteText').textContent = `引用：${pendingQuote}`;
  bar.hidden = false;
  closeActions();
}

function closeActions() {
  openMeta.clear();
  $$('.msg.show-meta').forEach(el => el.classList.remove('show-meta'));
}

function favoriteMessage(msg) {
  const isMe = msg.role === 'me';
  const item = {
    id: msg.id,
    kind: msg.type === 'sticker' ? 'sticker' : 'text',
    text: msg.text || '',
    url: msg.stickerUrl || '',
    at: Date.now(),
  };
  commit(s => {
    s.favorites = s.favorites || { his: [], mine: [] };
    const list = s.favorites[isMe ? 'mine' : 'his'];
    if (!list.some(x => x.id === item.id)) list.unshift(item);
  });
  toast('已收藏');
}

function editBubble(id) {
  const msg = get().messages.find(m => m.id === id);
  if (!msg) return;
  openSheet(`
    <div class="bubble-sheet-head">
      <h2 class="bubble-sheet-title">添加小气泡</h2>
      <button class="bubble-sheet-x" id="bubbleX" aria-label="关闭">×</button>
    </div>
    <textarea class="bubble-sheet-input" id="bubbleInput" rows="2" maxlength="60" placeholder="输入小气泡内容...">${escapeHtml(msg.bubbleText || '')}</textarea>
    <p class="bubble-sheet-hint">自己输入的小气泡只在这条消息上显示；联系人会从字卡库「小气泡」随机抽内容</p>
    <button class="bubble-sheet-ok" id="bubbleOk">确定</button>
  `);
  $('#bubbleX').onclick = closeSheet;
  setTimeout(() => $('#bubbleInput').focus(), 120);
  $('#bubbleOk').onclick = () => {
    const text = $('#bubbleInput').value.trim();
    commit(s => {
      const m = s.messages.find(x => x.id === id);
      if (m) m.bubbleText = text;
    });
    closeSheet();
    render();
  };
}

function runAction(action, id) {
  const msg = get().messages.find(m => m.id === id);
  if (!msg) return;
  closeActions();
  if (action === 'copy') {
    const text = msg.type === 'sticker' ? (msg.stickerUrl || '') : (msg.text || '');
    navigator.clipboard?.writeText(text).then(() => toast('已复制')).catch(() => toast('复制失败'));
  } else if (action === 'quote') {
    setQuote(msg);
  } else if (action === 'toVoice') {
    const text = msg.text || '';
    if (!text.trim()) return;
    commit(s => {
      const m = s.messages.find(x => x.id === id);
      if (!m) return;
      m.voiceText = text;
      m.voiceDur = Math.max(1, Math.min(60, Math.round(text.length / 4)));
      m.type = 'voice';
    });
    render();
    toast('已转成语音');
  } else if (action === 'toText') {
    const text = msg.voiceText || msg.text || '';
    commit(s => {
      const m = s.messages.find(x => x.id === id);
      if (!m) return;
      m.type = 'text';
      m.text = text;
      delete m.voiceText;
      delete m.voiceDur;
    });
    render();
  } else if (action === 'bubble') {
    editBubble(id);
  } else if (action === 'fav') {
    favoriteMessage(msg);
  } else if (action === 'del') {
    deleteMessage(id);
  }
}

export function openMeSheet() {
  const me = get().me;
  openSheet(`
    ${sheetTitle('我的资料')}
    <div class="me-edit">
      <button class="avatar-wrap" id="meSheetAvatar" aria-label="更换头像">
        <span class="avatar lg" id="meSheetAvatarView"></span>
        <span class="avatar-edit">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        </span>
      </button>
      <div class="me-fields">
        <input class="input" id="meSheetName" maxlength="12" placeholder="我的昵称" value="${escapeHtml(me.name || '')}">
        <input class="input" id="meSheetStatus" maxlength="30" placeholder="我的状态" value="${escapeHtml(me.status || '')}">
      </div>
    </div>
    <div class="sheet-actions">
      <button class="btn-ghost" id="meSheetClose">关闭</button>
      <button class="btn-ink" id="meSheetSave">保存</button>
    </div>
  `);
  const view = $('#meSheetAvatarView');
  const syncView = () => {
    const m = get().me;
    setAvatar(view, m.name, m.avatar);
  };
  syncView();
  $('#meSheetAvatar').onclick = async () => {
    const file = await pickFile('image/*');
    if (!file) return;
    try {
      const data = await compressImage(file, 320, .85);
      commit(s => { s.me.avatar = data; });
      syncView();
    } catch {
      toast('图片处理失败');
    }
  };
  $('#meSheetClose').onclick = closeSheet;
  $('#meSheetSave').onclick = () => {
    const name = $('#meSheetName').value.trim();
    const status = $('#meSheetStatus').value.trim();
    commit(s => {
      s.me.name = name || '我';
      s.me.status = status;
    });
    closeSheet();
    toast('已保存');
  };
}

function bindMessageEvents() {
  const list = $('#msgList');
  let pressTimer = null;
  let start = null;
  let fired = false;
  let pressId = '';

  const clear = () => { clearTimeout(pressTimer); pressTimer = null; start = null; };

  list.addEventListener('pointerdown', event => {
    const bubble = event.target.closest('.bubble');
    if (!bubble) return;
    const row = bubble.closest('.msg');
    if (!row) return;
    pressId = row.dataset.id;
    fired = false;
    start = { x: event.clientX, y: event.clientY };
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      fired = true;
      openMeta.add(pressId);
      const row = document.querySelector(`.msg[data-id="${pressId}"]`);
      row?.classList.add('show-meta');
    }, 540);
  });

  list.addEventListener('pointermove', event => {
    if (!start) return;
    if (Math.abs(event.clientX - start.x) > 9 || Math.abs(event.clientY - start.y) > 9) clear();
  });
  list.addEventListener('pointerup', clear);
  list.addEventListener('pointercancel', clear);

  list.addEventListener('click', event => {
    const fa = event.target.closest('[data-fa]');
    if (fa) {
      const row = fa.closest('.msg');
      if (row) runAction(fa.dataset.fa, row.dataset.id);
      return;
    }
    const myAvatar = event.target.closest('.msg.me .avatar');
    if (myAvatar) { openMeSheet(); return; }
    if (fired) { fired = false; return; }
    const bubble = event.target.closest('.bubble');
    if (!bubble) return;
    const row = bubble.closest('.msg');
    if (row) handleTap(row, row.dataset.id);
  });
}

/* ---------- 生成回复 ---------- */

function currentTypingText() {
  const raw = get().ui.typingText || '正在输入';
  return raw.replaceAll('{name}', persona().name || '');
}

function showTyping() {
  typingVisible = true;
  $('#emptyChat').classList.add('hidden');
  $('#typingText').textContent = currentTypingText();
  $('#typingRow').hidden = false;
  const scroll = $('#msgScroll');
  requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; });
}

function hideTyping() {
  typingVisible = false;
  $('#typingRow').hidden = true;
  if (!get().messages.length) $('#emptyChat').classList.remove('hidden');
}

function pickQuote() {
  const me = get().messages.filter(m => m.role === 'me').slice(-10);
  if (!me.length) return '';
  return pick(me).text;
}

function setSpeakState(on) {
  const btn = $('#micBtn');
  btn.classList.toggle('busy', on);
}

export async function triggerReply({ proactive = false, allowCall = true } = {}) {
  if (replying) return;
  const b = get().behavior;

  if (!proactive && allowCall && Math.random() * 100 < Number(b.callChance ?? 20)) {
    startCall();
    return;
  }

  if (!proactive && b.readSkip && Math.random() < b.readSkipRate) {
    const btn = $('#micBtn');
    btn.classList.remove('pulse');
    void btn.offsetWidth;
    btn.classList.add('pulse');
    setTimeout(() => btn.classList.remove('pulse'), 900);
    return;
  }

  const pool = availableCards();
  if (!pool.length) {
    if (!proactive) toast('字卡库还没有内容');
    return;
  }

  replying = true;
  setSpeakState(true);
  const btn = $('#micBtn');
  btn.classList.remove('pulse');
  void btn.offsetWidth;
  btn.classList.add('pulse');
  setTimeout(() => btn.classList.remove('pulse'), 900);

  const dMin = Math.max(0, Number(b.delayMin) || 0);
  const dMax = Math.max(dMin, Number(b.delayMax) || 0);
  const delay = dMin === dMax ? dMin : randFloat(dMin, dMax);

  showTyping();
  await sleep(Math.max(delay * 1000, 800));
  hideTyping();

  markSelfRead();

  const stickers = get().stickers || [];
  if (stickers.length && Math.random() * 100 < Number(b.stickerChance ?? 5)) {
    addIncoming({ type: 'sticker', stickerUrl: pick(stickers).url });
    playSound();
    replying = false;
    setSpeakState(false);
    await afterReply();
    return;
  }

  const count = randInt(1, 3);
  const chosen = [...pool].sort(() => Math.random() - .5).slice(0, Math.min(count, pool.length));
  const useQuote = b.quote && Math.random() * 100 < Number(b.quoteChance ?? 30);
  const quote = useQuote ? pickQuote() : '';
  const groupOn = get().group.enabled;
  const randomSender = () => (groupOn ? pick(get().group.members) : null);

  if (b.chain) {
    const sep = pick(SEPARATORS);
    const parts = chosen.map(c => c.text.trim());
    const text = parts.length === 1
      ? parts[0]
      : parts.map((t, i) => (i < parts.length - 1 ? t.replace(/[。！？!?…，,；;、]+$/, '') : t)).join(sep);
    const sender = randomSender();
    const firstId = addIncoming({ text, quote, senderId: sender?.id || '', senderName: sender?.name || '' });
    playSound();
    afterAiMessage(firstId, text);
  } else {
    let firstId = '';
    let firstText = '';
    for (let i = 0; i < chosen.length; i++) {
      const sender = randomSender();
      const id = addIncoming({
        text: chosen[i].text,
        quote: i === 0 ? quote : '',
        senderId: sender?.id || '',
        senderName: sender?.name || '',
      });
      if (!firstId) { firstId = id; firstText = chosen[i].text; }
      if (i === 0) playSound();
      if (i < chosen.length - 1) await sleep(randInt(420, 860));
    }
    afterAiMessage(firstId, firstText);
  }

  replying = false;
  setSpeakState(false);
  await afterReply();
}

/* 发出后：按概率撤回 / 按频率用 MiniMax 语音读出来 */
function afterAiMessage(id, text) {
  const chance = Number(get().behavior.recallChance ?? 15);
  if (id && chance > 0 && Math.random() * 100 < chance) {
    setTimeout(() => recallMessage(id), randInt(1400, 2800));
  }
  if (text && hasTTS() && Math.random() <= voiceRateChance()) {
    setTimeout(() => { speak(text, { silent: true }); }, randInt(300, 900));
  }
}

async function afterReply() {
  const n = get().nudge;
  if (n && n.enabled && n.items && n.items.length && Math.random() * 100 < Number(n.chance ?? 30)) {
    await sleep(randInt(700, 1500));
    const p = persona();
    const item = pick(n.items);
    const id = uid();
    fresh.add(id);
    commit(st => {
      st.messages.push({ id, role: 'them', type: 'nudge', text: `${p.name} ${item.text}`, ts: Date.now(), seen: true, senderId: '' });
    });
  }

  if (isListening() && Math.random() < .3) {
    try {
      const l = await pickLyric();
      if (l) {
        await sleep(randInt(600, 1400));
        addIncoming({ type: 'lyric', text: `${l.lead}《${l.song}》${l.lyric}`, song: l.song, lyric: l.lyric, lead: l.lead });
        playSound();
      }
    } catch {}
  }
}

/* ---------- 主动消息 ---------- */

function proactiveConfigSig() {
  const b = get().behavior;
  return JSON.stringify([b.proactive, b.proactiveMin, b.proactiveMax]);
}

function scheduleProactive() {
  clearTimeout(proTimer);
  proTimer = null;
  const b = get().behavior;
  if (!b.proactive) return;
  const min = Math.max(1, Number(b.proactiveMin) || 1);
  const max = Math.max(min, Number(b.proactiveMax) || min);
  const minutes = min === max ? min : randFloat(min, max);
  proTimer = setTimeout(async () => {
    await triggerReply({ proactive: true });
    scheduleProactive();
  }, minutes * 60000);
}

export function syncProactive() {
  const sig = proactiveConfigSig();
  if (sig === proSignature) return;
  proSignature = sig;
  scheduleProactive();
}

/* ---------- 输入区 ---------- */

function autoGrow() {
  const input = $('#msgInput');
  input.style.height = 'auto';
  input.style.height = Math.min(96, input.scrollHeight) + 'px';
}

function pushSelf(parts) {
  const id = uid();
  fresh.add(id);
  commit(s => {
    s.messages.push({
      id,
      role: 'me',
      text: '',
      ts: Date.now(),
      read: false,
      seen: true,
      senderId: '',
      ...parts,
    });
  });
  return id;
}

function sendMessage() {
  const input = $('#msgInput');
  const text = input.value.trim();
  if (!text) return;
  pushSelf({ text, quote: pendingQuote });
  clearQuote();
  input.value = '';
  autoGrow();
  playSound();
  render(true);
  input.focus();
  triggerReply({ allowCall: false });
}

const ICON_STICKER = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8.4 13.6c.9 1.6 2.2 2.4 3.6 2.4s2.7-.8 3.6-2.4"/><circle cx="9" cy="9.4" r="1.1"/><circle cx="15" cy="9.4" r="1.1"/></svg>`;
const ICON_TRANSFER = `<svg viewBox="0 0 24 24"><path d="M12 19V5M6.6 10.4L12 5l5.4 5.4"/></svg>`;
const ICON_HAND = `<svg viewBox="0 0 24 24"><path d="M8 13.4V7.6a1.5 1.5 0 0 1 3 0v4.2V5.6a1.5 1.5 0 0 1 3 0v6.2V7a1.5 1.5 0 0 1 3 0v7.6a5.6 5.6 0 0 1-5.6 5.6h-1a4.4 4.4 0 0 1-4.4-4.4v-1.5l-1.7 1a1.5 1.5 0 0 1-2-2.2z"/></svg>`;
const ICON_LIST = `<svg viewBox="0 0 24 24"><path d="M4 7h11M4 12h11M4 17h7"/><path d="M18.4 15.5l1.6 1.6 3-3.4"/></svg>`;
const ICON_IMAGE = `<svg viewBox="0 0 24 24"><rect x="3.2" y="5" width="17.6" height="14" rx="3"/><path d="M4.4 16.6l4.3-4.2a1.2 1.2 0 0 1 1.7 0l3.4 3.3M12.4 14.4l1.8-1.7a1.2 1.2 0 0 1 1.7 0l2.3 2.2"/><circle cx="8" cy="9.4" r="1.3"/></svg>`;
const ICON_RECORD = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6"/><path d="M12 7.6V12l3.2 1.9"/></svg>`;
const ICON_QUIZ = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.6"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.4"/><circle cx="12" cy="16.9" r=".9" fill="currentColor" stroke="none"/></svg>`;

function sendSticker(url) {
  const id = uid();
  fresh.add(id);
  commit(s => {
    s.messages.push({
      id,
      role: 'me',
      type: 'sticker',
      text: '',
      stickerUrl: url,
      ts: Date.now(),
      read: false,
      seen: true,
      senderId: '',
    });
  });
  closeSheet();
  playSound();
  render(true);
  triggerReply({ allowCall: false });
}

function openStickerPicker() {
  const stickers = get().stickers || [];
  openSheet(`
    ${sheetTitle('表情包')}
    <div class="sticker-grid">
      ${stickers.map(s => `<button class="sticker-cell" data-pick="${s.id}"><img src="${escapeHtml(s.url)}" alt=""></button>`).join('')}
      <button class="sticker-cell add-cell" id="pickerUpload">
        <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><span>上传</span>
      </button>
    </div>
  `);
  $$('#sheet [data-pick]').forEach(btn => {
    btn.onclick = () => {
      const sticker = get().stickers.find(s => s.id === btn.dataset.pick);
      if (sticker) sendSticker(sticker.url);
    };
  });
  $('#pickerUpload').onclick = async () => {
    const file = await pickFile('image/*');
    if (!file) return;
    try {
      const url = await prepareSticker(file);
      commit(s => { s.stickers.unshift({ id: uid(), url, at: Date.now() }); });
      openStickerPicker();
      toast('已添加');
    } catch {
      toast('图片处理失败');
    }
  };
}

function openAttachPanel() {
  openSheet(`
    <div class="attach-list">
      <button class="attach-row" data-attach="sticker">${ICON_STICKER}<span>表情包</span></button>
      <button class="attach-row" data-attach="transfer">${ICON_TRANSFER}<span>转账</span></button>
      <button class="attach-row" data-attach="nudge">${ICON_HAND}<span>拍一拍</span></button>
      <button class="attach-row" data-attach="burst">${ICON_LIST}<span>连发</span></button>
      <button class="attach-row" data-attach="image">${ICON_IMAGE}<span>图片</span></button>
      <button class="attach-row" data-attach="record">${ICON_RECORD}<span>记录</span></button>
      <button class="attach-row" data-attach="quiz">${ICON_QUIZ}<span>问问TA</span></button>
    </div>
  `);
  $$('#sheet [data-attach]').forEach(btn => {
    btn.onclick = () => {
      const kind = btn.dataset.attach;
      if (kind === 'sticker') { openStickerPicker(); return; }
      if (kind === 'transfer') { openTransfer(); return; }
      if (kind === 'nudge') {
        closeSheet();
        pushSelf({ type: 'nudge', text: `你拍了拍「${persona().name || 'TA'}」` });
        render(true);
        setTimeout(() => addIncoming({ text: '干嘛', senderName: persona().name }), 900);
        return;
      }
      if (kind === 'burst') {
        closeSheet();
        ['想你了', '在干嘛', '理理我'].forEach((text, i) => {
          setTimeout(() => {
            pushSelf({ text });
            render(true);
          }, 260 * i);
        });
        return;
      }
      if (kind === 'image') { pickChatImage(); return; }
      if (kind === 'record') { openRecord(); return; }
      if (kind === 'quiz') { openQuizPanel(); return; }
      closeSheet();
    };
  });
}

/* ---------- 问问TA（问卷） ---------- */

function openQuizPanel() {
  openSheet(`
    <div class="quiz-panel">
      <div class="quiz-title">
        <h3>问问TA</h3>
        <button class="quiz-close" data-quiz-close aria-label="关闭">×</button>
      </div>
      <div class="quiz-field">
        <input class="quiz-input" id="quizQuestion" placeholder="你的问题？" maxlength="80">
        <button class="quiz-clear" data-quiz-clear aria-label="清空">×</button>
      </div>
      <textarea class="quiz-area" id="quizBatch" rows="2" placeholder="批量设置问卷：每行一个问题（可写 问题~选项1~选项2）"></textarea>
      <div class="quiz-modes">
        <button class="quiz-mode on" data-mode="text">文字回复</button>
        <button class="quiz-mode" data-mode="single">单选题</button>
        <button class="quiz-mode" data-mode="multi">多选题</button>
      </div>
      <textarea class="quiz-area" id="quizOptions" rows="3" placeholder="选项：每行一个；可写 选项~TA回应" hidden></textarea>
      <div class="quiz-wait">
        <span>思考时间（秒）</span>
        <div class="quiz-step">
          <button data-step="-1" aria-label="减少">−</button>
          <b id="quizWait">6</b>
          <button data-step="1" aria-label="增加">+</button>
        </div>
      </div>
      <div class="quiz-actions">
        <button class="ghost-btn wide" data-quiz-close>取消</button>
        <button class="ghost-btn wide primary" id="quizSend">发送</button>
      </div>
    </div>
  `);

  let mode = 'text';
  const optionsBox = $('#quizOptions');
  $$('#sheet [data-quiz-close]').forEach(btn => { btn.onclick = closeSheet; });
  $$('#sheet [data-quiz-clear]').forEach(btn => { btn.onclick = () => { $('#quizQuestion').value = ''; $('#quizQuestion').focus(); }; });
  $$('#sheet .quiz-mode').forEach(btn => {
    btn.onclick = () => {
      mode = btn.dataset.mode;
      $$('#sheet .quiz-mode').forEach(b => b.classList.toggle('on', b === btn));
      optionsBox.hidden = mode === 'text';
      if (mode !== 'text') optionsBox.focus();
    };
  });
  $$('#sheet [data-step]').forEach(btn => {
    btn.onclick = () => {
      const el = $('#quizWait');
      const next = Math.min(60, Math.max(1, Number(el.textContent) + Number(btn.dataset.step)));
      el.textContent = String(next);
    };
  });
  $('#quizSend').onclick = () => {
    const question = $('#quizQuestion').value.trim();
    const batch = $('#quizBatch').value.trim();
    const wait = Math.min(60, Math.max(1, Number($('#quizWait').textContent) || 6));
    const fallbackOptions = parseQuizOptions(optionsBox.value);
    const items = batch
      ? batch.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
        const [q, ...rest] = line.split('~').map(x => x.trim()).filter(Boolean);
        return { question: q, options: rest.length ? parseQuizOptions(rest.join('\n')) : fallbackOptions };
      })
      : [{ question, options: fallbackOptions }];
    if (!items.length || !items[0].question) { toast('先写一个问题'); return; }
    const valid = items.filter(it => it.question && (mode === 'text' || it.options.length >= 2));
    if (!valid.length) { toast(mode === 'text' ? '先写一个问题' : '至少写两个选项'); return; }
    closeSheet();
    valid.forEach((it, i) => {
      setTimeout(() => sendQuizCard(it.question, mode === 'text' ? [] : it.options, mode, wait), i * (wait + 2) * 1000);
    });
  };
}

function parseQuizOptions(text) {
  return String(text || '').split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const [text2, reply] = line.split('~').map(x => x.trim());
    return { text: text2, reply: reply || '' };
  }).filter(o => o.text);
}

function sendQuizCard(question, options, mode, wait) {
  const id = uid();
  fresh.add(id);
  commit(st => {
    st.messages.push({
      id,
      role: 'me',
      type: 'quiz',
      text: question,
      ts: Date.now(),
      read: false,
      seen: true,
      senderId: '',
      quiz: { mode, options, chosen: [], answer: '' },
    });
  });
  playSound();
  render(true);
  if (mode !== 'text' && options.length) {
    setTimeout(() => resolveQuiz(id, randomizeQuizAnswer(mode, options)), Math.max(1, wait) * 1000);
  } else {
    setTimeout(() => triggerReply({ allowCall: false }), Math.max(1, wait) * 1000);
  }
}

function randomizeQuizAnswer(mode, options) {
  const count = mode === 'multi'
    ? Math.max(1, Math.min(options.length, randInt(1, 2)))
    : 1;
  const pool = options.map((_, i) => i).sort(() => Math.random() - .5).slice(0, count);
  return pool.sort((a, b) => a - b);
}

function resolveQuiz(id, chosen) {
  const msg = get().messages.find(m => m.id === id);
  if (!msg || !msg.quiz || msg.quiz.answer) return;
  const picked = chosen.map(i => msg.quiz.options[i]).filter(Boolean);
  const answer = picked.map(o => o.reply).filter(Boolean).join(' ') || `我选「${picked.map(o => o.text).join('、')}」`;
  commit(st => {
    const m = st.messages.find(x => x.id === id);
    if (!m || !m.quiz) return;
    m.quiz.chosen = chosen;
    m.quiz.answer = answer;
    m.seen = true;
  });
  render(true);
  if (hasTTS() && Math.random() <= voiceRateChance()) speak(answer, { silent: true });
}

async function openTransfer() {
  const value = await promptSheet({ title: '转账', placeholder: '输入金额', confirm: '转账' });
  if (!value || !value.trim()) return;
  closeSheet();
  pushSelf({ text: `[转账] ¥${value.trim()}` });
  render(true);
  setTimeout(() => addIncoming({ text: '收到啦，谢谢你', senderName: persona().name }), 1200);
}

async function pickChatImage() {
  const file = await pickFile('image/*');
  if (!file) return;
  try {
    const url = await compressImage(file, 900, .8);
    closeSheet();
    sendSticker(url);
  } catch {
    toast('图片处理失败');
  }
}

function openRecord() {
  const all = get().messages;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayCount = all.filter(m => m.ts >= today.getTime()).length;
  const favCount = ((get().favorites?.his || []).length + (get().favorites?.mine || []).length);
  openSheet(`
    ${sheetTitle('记录')}
    <div class="record-stats">
      <div class="record-stat"><b>${all.length}</b><span>全部消息</span></div>
      <div class="record-stat"><b>${todayCount}</b><span>今天</span></div>
      <div class="record-stat"><b>${favCount}</b><span>收藏</span></div>
    </div>
  `);
}

async function pickChatBg() {
  const file = await pickFile('image/*');
  if (!file) return;
  try {
    const data = await compressImage(file, 1280, .8);
    commit(s => { s.ui.chatBg = data; });
    toast('已设置壁纸');
  } catch {
    toast('图片处理失败');
  }
}

function openBgSheet() {
  actionSheet('聊天壁纸', [
    { label: get().ui.chatBg ? '更换壁纸' : '选择图片', onClick: pickChatBg },
    { label: '移除壁纸', danger: true, onClick: () => {
      commit(s => { s.ui.chatBg = ''; });
      toast('已移除壁纸');
    } },
  ]);
}

function openChatMenu() {
  actionSheet('对话', [
    { label: '聊天壁纸', onClick: openBgSheet },
    { label: '打开字卡库', onClick: () => router.open('cards') },
    { label: '打开设定', onClick: () => router.open('settings') },
    { label: '删除所有消息', danger: true, onClick: async () => {
      const ok = await confirmSheet({ title: '删除所有消息', text: '聊天记录将全部清除', confirm: '删除', danger: true });
      if (!ok) return;
      commit(s => { s.messages = []; });
      toast('已清空');
    } },
  ]);
}

/* ---------- 初始化 ---------- */

export function initChat() {
  bindMessageEvents();
  $('#micBtn').onclick = () => {
    if (navigator.vibrate) navigator.vibrate(6);
    triggerReply();
  };
  $('#sendBtn').onclick = sendMessage;
  $('#plusBtn').onclick = openAttachPanel;
  $('#quoteCancel').onclick = clearQuote;
  $('#chatMore').onclick = openChatMenu;
  $('#chatAvatar').onclick = () => openMoments('chat');
  $('#chatCallBtn').onclick = () => {
    if (navigator.vibrate) navigator.vibrate(4);
    startCall();
  };

  const input = $('#msgInput');
  input.addEventListener('input', autoGrow);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  subscribe(() => {
    render();
    syncProactive();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      if (router.isOpen('chat')) markSeen();
    }
  });

  router.register('chat', {
    onOpen: () => {
      markSeen();
      render(true);
      setTimeout(() => $('#msgScroll').scrollTop = $('#msgScroll').scrollHeight, 50);
    },
  });

  syncProactive();
  render(true);
}
