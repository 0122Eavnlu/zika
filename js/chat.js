import { get, commit, subscribe } from './state.js?v=20261101C';
import { $, $$, escapeHtml, timeText, setAvatar, toast, sleep, randInt, randFloat, pick, uid, pickFile, prepareSticker, compressImage } from './util.js?v=20261101C';
import { openSheet, closeSheet, sheetTitle, confirmSheet, actionSheet, promptSheet } from './ui.js?v=20261101C';
import * as router from './router.js?v=20261101C';
import { playSound } from './audio.js?v=20261101C';
import { startCall } from './call.js?v=20261101C';
import { openMoments } from './moments.js?v=20261101C';
import { pickLyric, isListening } from './music.js?v=20261101C';
import { speak, hasTTS, voiceRateChance } from './tts.js?v=20261101C';

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

function buildMessage(msg, idx) {
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
  const s = get();
  // 是否和上一条同侧同发送者（连续消息堆叠，更紧凑）
  const prev = idx > 0 ? s.messages[idx - 1] : null;
  const grouped = prev && prev.role === msg.role
    && (prev.senderId || '') === (msg.senderId || '')
    && prev.type !== 'nudge' && prev.type !== 'recall'
    && type !== 'nudge' && type !== 'recall';
  const timeOn = s.ui.timeOn;
  const readOn = s.ui.readOn;

  // 已读 / 已读不回：对方在这条之后回复过 → 已读；否则 → 已读不回
  let readText = '';
  if (isMe && msg.read && readOn) {
    const all = s.messages;
    const idx = all.findIndex(m => m.id === msg.id);
    const hasThemAfter = all.slice(idx + 1).some(m => m.role === 'them');
    readText = hasThemAfter ? '已读' : '已读不回';
  }

  const timeHtml = timeOn ? `<span class="t">${timeText(msg.ts)}</span>` : '';
  const readHtml = readText ? `<span class="read ${readText === '已读不回' ? 'unread' : ''}">${escapeHtml(readText)}</span>` : '';
  const themMeta = timeHtml ? `<div class="avatar-meta">${timeHtml}</div>` : '';
  const meMeta = (timeHtml || readHtml) ? `<div class="avatar-meta">${timeHtml}${readHtml ? `<br>${readHtml}` : ''}</div>` : '';

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
    // 歌词摘取要带上歌名和歌词，和之前一致
    const full = msg.text
      || `${msg.lead || '我摘取了'}《${msg.song || ''}》${msg.lyric ? `的「${msg.lyric}」` : ''}`;
    inner = escapeHtml(full);
  } else if (type === 'voice') {
    bubbleCls = 'bubble voice';
    const vText = msg.voiceText || msg.text || '';
    const sec = Math.max(1, Number(msg.voiceDur) || Math.round(vText.length / 4));
    const quoteHtml = msg.quote ? `<span class="quote">${escapeHtml(msg.quote)}</span>` : '';
    const caption = msg.voiceCaption && vText ? `<span class="voice-text">${escapeHtml(vText)}</span>` : '';
    inner = `${quoteHtml}<div class="voice-msg"><span class="voice-wave"><i></i><i></i><i></i><i></i></span><span class="voice-track"></span><span class="voice-dur">${sec}"</span></div>${caption}`;
  } else if (type === 'quiz') {
    const q = msg.quiz || {};
    const answered = (q.chosen || []).length > 0;
    const soft = q.mode === 'yesno';
    bubbleCls = `bubble quiz${soft ? ' quiz-soft' : ''}`;
    const kind = soft ? `让 ${persona().name || 'TA'} 决定` : '问卷 · 1题';
    const time = get().ui.timeOn ? `<span class="qz-time">${timeText(msg.ts)}</span>` : '';
    const opts = soft
      ? (q.options || []).map((o, i) => {
        const on = (q.chosen || []).includes(i) ? ' on' : '';
        return `<div class="qz-btn${on}">${escapeHtml(o.text)}${on ? ' ✓' : ''}</div>`;
      }).join('')
      : (q.options || []).map((o, i) => {
        const on = (q.chosen || []).includes(i) ? ' on' : '';
        return `<div class="qz-opt${on}"><span class="qz-dot"></span><span class="qz-opt-text">${escapeHtml(o.text)}</span><span class="qz-tick">✓</span></div>`;
      }).join('');
    const status = answered ? 'TA 已选' : (soft ? '等TA选' : '等待中');
    inner = `<div class="qz-card">
        <div class="qz-card-head"><span class="qz-kind">${escapeHtml(kind)}</span>${time}</div>
        <div class="qz-question">${soft ? '' : '1. '}${escapeHtml(msg.text || '')}</div>
        ${opts ? `<div class="${soft ? 'qz-btns' : 'qz-opts'}">${opts}</div>` : ''}
        <div class="qz-foot"><span class="qz-status${answered ? ' done' : ''}">${status}</span></div>
      </div>`;
  } else if (type === 'quizdone') {
    return `<div class="msg quizdone ${fresh.has(msg.id) ? 'fresh' : ''}" data-id="${msg.id}"><span>${escapeHtml(msg.text)}</span></div>`;
  } else {
    inner = (msg.quote ? `<span class="quote">${escapeHtml(msg.quote)}</span>` : '') + escapeHtml(msg.text);
  }

  // 气泡皮肤兼容：文字 / 歌词 / 语音气泡额外挂 .message-sent / .message-received，
  // 并把内容包进 .content-wrapper，外部皮肤 CSS 可正常生效（含左右镜像写法）。
  const skinnable = type === 'text' || type === 'lyric' || type === 'voice';
  if (skinnable) bubbleCls += isMe ? ' message-sent' : ' message-received';
  if (type !== 'sticker' && type !== 'emoji' && type !== 'call' && type !== 'quiz') inner = `<span class="content-wrapper">${inner}</span>`;

  const avatarHtml = showAvatar ? `<span class="avatar" data-avatar="${msg.id}"></span>` : '';
  const meAvatarHtml = isMe ? `<span class="avatar me-avatar" data-avatar="${msg.id}" aria-label="我的资料"></span>` : '';
  const avatarColThem = showAvatar ? `<div class="avatar-col">${avatarHtml}${themMeta}</div>` : '';
  const avatarColMe = isMe ? `<div class="avatar-col">${meAvatarHtml}${meMeta}</div>` : '';
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
  return `<div class="msg ${isMe ? 'me' : 'them'} ${type === 'quiz' ? 'quiz-msg' : ''} ${grouped ? 'grouped' : ''} ${showAvatar || isMe ? '' : 'no-avatar'} ${openMeta.has(msg.id) ? 'show-meta' : ''} ${fresh.has(msg.id) ? 'fresh' : ''}" data-id="${msg.id}">${avatarColThem}<div class="bubble-wrap">${showName ? `<div class="sender-name">${escapeHtml(sender.name)}</div>` : ''}${mini}<div class="${bubbleCls}">${inner}</div>${actions}</div>${avatarColMe}</div>`;
}

function render(forceBottom = false) {
  updateIdentity();
  const list = $('#msgList');
  const scroll = $('#msgScroll');
  const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 70;
  const messages = get().messages;
  $('#emptyChat').classList.toggle('hidden', messages.length > 0);
  list.innerHTML = messages.map((m, i) => buildMessage(m, i)).join('');
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

/* 同一帧内的多次数据变动只重绘一次，避免连续操作时反复重建整条消息列表 */
let renderRaf = 0;
let renderForce = false;

function scheduleRender(force = false) {
  if (force) renderForce = true;
  if (renderRaf) return;
  renderRaf = requestAnimationFrame(() => {
    renderRaf = 0;
    const f = renderForce;
    renderForce = false;
    render(f);
  });
}

/* 只更新某一条消息的小气泡，不重建整个列表（贴气泡时用，明显更顺） */
function patchBubbleText(id, text) {
  const row = document.querySelector(`.msg[data-id="${id}"]`);
  if (!row) return;
  const wrap = row.querySelector('.bubble-wrap');
  if (!wrap) return;
  let mini = wrap.querySelector('.msg-mini');
  if (text) {
    if (!mini) {
      mini = document.createElement('span');
      mini.className = 'msg-mini';
      const bubble = wrap.querySelector('.bubble');
      if (bubble) wrap.insertBefore(mini, bubble);
      else wrap.appendChild(mini);
    }
    mini.textContent = text;
  } else if (mini) {
    mini.remove();
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
  scheduleRender(true);
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
    // 每条消息用独立 tag，避免新通知把上一条悄悄覆盖掉（那样不会弹横幅）
    tag: `zika-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    renotify: true,
    timestamp: Date.now(),
    // 不能静音，否则安卓只会悄悄进通知栏，不会弹出横幅
    silent: false,
    vibrate: [200, 80, 200],
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
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
  // 点一下展开操作栏（关掉其它已展开的），再点空白处才收回
  openMeta.clear();
  $$('.msg.show-meta').forEach(el => el.classList.remove('show-meta'));
  openMeta.add(id);
  row.classList.add('show-meta');
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

const MINI_PRESETS = ['哼哼', '?', '喜欢你雨善', '……', '无奈', '伤脑筋啊', '笨蛋', '傻瓜'];

function editBubble(id) {
  const msg = get().messages.find(m => m.id === id);
  if (!msg) return;
  const cur = msg.bubbleText || '';
  openSheet(`
    <div class="bubble-sheet-head">
      <h2 class="bubble-sheet-title">添加小气泡</h2>
      <button class="bubble-sheet-x" id="bubbleX" aria-label="关闭">×</button>
    </div>
    <div class="mini-presets">
      ${MINI_PRESETS.map(p => `<button class="mini-chip${p === cur ? ' on' : ''}" data-mini="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join('')}
    </div>
    <textarea class="bubble-sheet-input" id="bubbleInput" rows="2" maxlength="60" placeholder="或输入自定义内容...">${escapeHtml(cur)}</textarea>
    <p class="bubble-sheet-hint">点预设直接用，也可在下面自定义；对方也能给你的气泡贴小气泡</p>
    <button class="bubble-sheet-ok" id="bubbleOk">确定</button>
  `);
  $('#bubbleX').onclick = closeSheet;
  const input = $('#bubbleInput');
  $$('#sheet .mini-chip').forEach(btn => {
    btn.onclick = () => {
      $$('#sheet .mini-chip').forEach(b => b.classList.remove('on'));
      btn.classList.add('on');
      input.value = btn.dataset.mini;
    };
  });
  setTimeout(() => input.focus(), 120);
  $('#bubbleOk').onclick = () => {
    const text = input.value.trim();
    commit(s => {
      const m = s.messages.find(x => x.id === id);
      if (m) m.bubbleText = text;
    });
    if (renderRaf) {
      cancelAnimationFrame(renderRaf);
      renderRaf = 0;
      renderForce = false;
    }
    patchBubbleText(id, text);
    closeSheet();
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
    scheduleRender();
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
      delete m.voiceCaption;
    });
    scheduleRender();
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
    // 点对方头像 → 拍一拍（可自定义）
    const themAvatar = event.target.closest('.msg.them .avatar');
    if (themAvatar) { openNudgePrompt(); return; }
    const myAvatar = event.target.closest('.msg.me .avatar');
    if (myAvatar) { openMeSheet(); return; }
    if (fired) { fired = false; return; }
    const bubble = event.target.closest('.bubble');
    if (!bubble) return;
    const row = bubble.closest('.msg');
    if (row) handleTap(row, row.dataset.id);
  });

  // 点气泡/操作栏/头像以外的地方 → 收回操作栏
  document.addEventListener('click', event => {
    if (!openMeta.size) return;
    if (event.target.closest('.bubble') || event.target.closest('.msg-actions') || event.target.closest('.msg .avatar')) return;
    closeActions();
  }, true);
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

/* 发出后：按概率撤回 / 按频率发成语音气泡（不自动朗读，点一下才播） */
function afterAiMessage(id, text) {
  const chance = Number(get().behavior.recallChance ?? 15);
  if (id && chance > 0 && Math.random() * 100 < chance) {
    setTimeout(() => recallMessage(id), randInt(1400, 2800));
  }
  if (id && text && hasTTS() && Math.random() <= voiceRateChance()) {
    commit(s => {
      const m = s.messages.find(x => x.id === id);
      if (!m) return;
      m.type = 'voice';
      m.voiceText = text;
      m.voiceDur = Math.max(1, Math.min(60, Math.round(text.length / 4)));
      m.voiceCaption = true;
    });
    scheduleRender();
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

  // 对方给我最近的一条气泡贴个小气泡
  if (Math.random() < .25) {
    const myMsgs = get().messages.filter(m => m.role === 'me');
    if (myMsgs.length) {
      const target = myMsgs[myMsgs.length - 1];
      if (!target.bubbleText) {
        const chip = pick(MINI_PRESETS);
        await sleep(randInt(500, 1200));
        commit(s => {
          const m = s.messages.find(x => x.id === target.id);
          if (m) m.bubbleText = chip;
        });
        scheduleRender();
      }
    }
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
  scheduleRender(true);
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
  scheduleRender(true);
  triggerReply({ allowCall: false });
}

function sendEmojiText(text) {
  const id = uid();
  fresh.add(id);
  commit(s => {
    s.messages.push({
      id,
      role: 'me',
      type: 'emoji',
      text,
      ts: Date.now(),
      read: false,
      seen: true,
      senderId: '',
    });
  });
  closeSheet();
  playSound();
  scheduleRender(true);
  triggerReply({ allowCall: false });
}

function openStickerPicker(tab = 'stickers') {
  const s = get();
  const stickers = s.stickers || [];
  const myKaomoji = s.kaomoji || [];
  const myEmoji = s.emojiMine || [];

  let gridHtml = '';
  if (tab === 'stickers') {
    gridHtml = `
      <div class="sticker-grid">
        ${stickers.map(st => `<button class="sticker-cell" data-pick="${st.id}"><img src="${escapeHtml(st.url)}" alt=""></button>`).join('')}
        <button class="sticker-cell add-cell" id="pickerUpload">
          <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg><span>上传</span>
        </button>
      </div>`;
  } else if (tab === 'kaomoji') {
    const list = myKaomoji.map(k => k.text);
    gridHtml = `
      <div class="kaomoji-grid">
        ${list.map((t, i) => `<button class="kaomoji-cell" data-kao="${i}">${escapeHtml(t)}</button>`).join('') || '<div class="card-empty">还没有颜文字，去字卡库添加</div>'}
      </div>
      <button class="ghost-btn wide" id="kaomojiAdd">添加颜文字</button>`;
  } else {
    const list = myEmoji.map(e => e.text);
    gridHtml = `
      <div class="emoji-grid">
        ${list.map((t, i) => `<button class="emoji-cell" data-em="${i}">${escapeHtml(t)}</button>`).join('') || '<div class="card-empty">还没有 emoji，去字卡库添加</div>'}
      </div>
      <button class="ghost-btn wide" id="emojiAdd">添加 emoji</button>`;
  }

  openSheet(`
    ${sheetTitle('表情')}
    <div class="picker-tabs" id="pickerTabs">
      <button data-ptab="stickers" class="${tab === 'stickers' ? 'active' : ''}">表情包</button>
      <button data-ptab="kaomoji" class="${tab === 'kaomoji' ? 'active' : ''}">颜文字</button>
      <button data-ptab="emoji" class="${tab === 'emoji' ? 'active' : ''}">emoji</button>
    </div>
    <div class="picker-body">${gridHtml}</div>
  `);

  $$('#pickerTabs button').forEach(b => {
    b.onclick = () => openStickerPicker(b.dataset.ptab);
  });

  if (tab === 'stickers') {
    $$('#sheet [data-pick]').forEach(btn => {
      btn.onclick = () => {
        const sticker = get().stickers.find(x => x.id === btn.dataset.pick);
        if (sticker) sendSticker(sticker.url);
      };
    });
    const up = $('#pickerUpload');
    if (up) up.onclick = async () => {
      const file = await pickFile('image/*');
      if (!file) return;
      try {
        const url = await prepareSticker(file);
        commit(s => { s.stickers.unshift({ id: uid(), url, at: Date.now() }); });
        openStickerPicker('stickers');
        toast('已添加');
      } catch {
        toast('图片处理失败');
      }
    };
  } else if (tab === 'kaomoji') {
    const list = myKaomoji.map(k => k.text);
    $$('#sheet [data-kao]').forEach(btn => {
      btn.onclick = () => sendEmojiText(list[Number(btn.dataset.kao)]);
      btn.oncontextmenu = e => {
        e.preventDefault();
        const idx = Number(btn.dataset.kao);
        commit(s => { s.kaomoji.splice(idx, 1); });
        openStickerPicker('kaomoji');
      };
    });
    const add = $('#kaomojiAdd');
    if (add) add.onclick = () => {
      promptSheet({ title: '添加颜文字', placeholder: '输入颜文字', confirm: '添加' }).then(text => {
        const t = (text || '').trim();
        if (!t) return;
        commit(s => { s.kaomoji.unshift({ id: uid(), text: t, at: Date.now() }); });
        openStickerPicker('kaomoji');
      });
    };
  } else {
    const list = myEmoji.map(e => e.text);
    $$('#sheet [data-em]').forEach(btn => {
      btn.onclick = () => sendEmojiText(list[Number(btn.dataset.em)]);
      btn.oncontextmenu = e => {
        e.preventDefault();
        const idx = Number(btn.dataset.em);
        commit(s => { s.emojiMine.splice(idx, 1); });
        openStickerPicker('emoji');
      };
    });
    const add = $('#emojiAdd');
    if (add) add.onclick = () => {
      promptSheet({ title: '添加 emoji', placeholder: '输入 emoji', confirm: '添加' }).then(text => {
        const t = (text || '').trim();
        if (!t) return;
        commit(s => { s.emojiMine.unshift({ id: uid(), text: t, at: Date.now() }); });
        openStickerPicker('emoji');
      });
    };
  }
}

function openNudgePrompt() {
  promptSheet({ title: '拍一拍', placeholder: '自定义内容（留空 = 拍一拍）', confirm: '拍一下' }).then(text => {
    const name = persona().name || 'TA';
    const suffix = (text || '').trim();
    const label = suffix ? `我拍了拍${name} ${suffix}` : `我拍了拍${name}`;
    pushSelf({ type: 'nudge', text: label });
    scheduleRender(true);
  });
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
        scheduleRender(true);
        return;
      }
      if (kind === 'burst') {
        closeSheet();
        ['想你了', '在干嘛', '理理我'].forEach((text, i) => {
          setTimeout(() => {
            pushSelf({ text });
            scheduleRender(true);
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
  const p = persona();
  openSheet(`
    <div class="qz-panel">
      <div class="qz-head">
        <h3>让 ${escapeHtml(p.name || 'TA')} 决定</h3>
        <button class="qz-x" data-quiz-close aria-label="关闭">×</button>
      </div>
      <div class="qz-label">回复时间</div>
      <div class="qz-reply">
        <button class="qz-reply-btn on" data-delay="now"><b>立即回复</b><span>10秒后自动选择</span></button>
        <button class="qz-reply-btn" data-delay="later"><b>等一会儿</b><span>约1-6分钟后</span></button>
      </div>
      <div class="qz-label">是非题</div>
      <div class="qz-yesno">
        <input class="qz-input" id="qzYesNo" placeholder="例如：你在吗？" maxlength="80">
        <button class="qz-mini" id="qzSendYesNo">发送是非题</button>
      </div>
      <div class="qz-label">选择题：问题</div>
      <input class="qz-input" id="qzQuestion" placeholder="例如：今晚吃什么？" maxlength="80">
      <div class="qz-label">选项</div>
      <div class="qz-opts" id="qzOptionList"></div>
      <button class="qz-add" id="qzAddOption">+ 添加选项</button>
      <div class="qz-label">允许同时选择</div>
      <div class="qz-count"><button data-qz-count="-1" aria-label="减少">−</button><b id="qzCount">1</b><button data-qz-count="1" aria-label="增加">+</button></div>
      <div class="qz-actions">
        <button class="ghost-btn wide" data-quiz-close>取消</button>
        <button class="ghost-btn wide primary" id="qzSend">让TA决定</button>
      </div>
      <button class="qz-history" id="qzHistory">决策记录 (${quizHistoryCount()})</button>
    </div>
  `);

  let delayMode = 'now';
  let options = ['', ''];
  let allowCount = 1;

  const listEl = $('#qzOptionList');
  const countEl = $('#qzCount');
  const clampCount = () => {
    allowCount = Math.max(1, Math.min(Math.max(1, options.length), allowCount));
    countEl.textContent = String(allowCount);
  };
  const renderOptions = () => {
    listEl.innerHTML = options.map((text, i) => `
      <div class="qz-opt-row">
        <span class="qz-opt-no">${String(i + 1).padStart(2, '0')}</span>
        <input class="qz-input" data-qz-opt="${i}" value="${escapeHtml(text)}" placeholder="选项${i + 1}" maxlength="40">
        ${options.length > 2 ? `<button class="qz-opt-del" data-qz-del="${i}" aria-label="删除">×</button>` : ''}
      </div>`).join('');
    $$('#qzOptionList [data-qz-opt]').forEach(input => {
      input.oninput = () => { options[Number(input.dataset.qzOpt)] = input.value; };
    });
    $$('#qzOptionList [data-qz-del]').forEach(btn => {
      btn.onclick = () => {
        options.splice(Number(btn.dataset.qzDel), 1);
        if (options.length < 2) options.push('');
        renderOptions();
      };
    });
    clampCount();
  };
  renderOptions();

  const delaySeconds = () => (delayMode === 'now' ? 10 : randInt(60, 360));

  $$('#sheet [data-quiz-close]').forEach(btn => { btn.onclick = closeSheet; });
  $$('#sheet .qz-reply-btn').forEach(btn => {
    btn.onclick = () => {
      delayMode = btn.dataset.delay;
      $$('#sheet .qz-reply-btn').forEach(b => b.classList.toggle('on', b === btn));
    };
  });
  $$('#sheet [data-qz-count]').forEach(btn => {
    btn.onclick = () => {
      allowCount += Number(btn.dataset.qzCount);
      clampCount();
    };
  });
  $('#qzAddOption').onclick = () => {
    if (options.length >= 8) { toast('最多 8 个选项'); return; }
    options.push('');
    renderOptions();
  };
  $('#qzSendYesNo').onclick = () => {
    const question = $('#qzYesNo').value.trim();
    if (!question) { toast('先写一个问题'); return; }
    const wait = delaySeconds();
    closeSheet();
    sendQuizCard(question, [{ text: '是' }, { text: '否' }], 'yesno', wait, 1);
  };
  $('#qzSend').onclick = () => {
    const question = $('#qzQuestion').value.trim();
    const opts = options.map(t => t.trim()).filter(Boolean);
    if (!question) { toast('先写一个问题'); return; }
    if (opts.length < 2) { toast('至少写两个选项'); return; }
    const wait = delaySeconds();
    const mode = allowCount > 1 ? 'multi' : 'single';
    closeSheet();
    sendQuizCard(question, opts.map(t => ({ text: t })), mode, wait, allowCount);
  };
  $('#qzHistory').onclick = openQuizHistory;
}

function quizHistoryCount() {
  return get().messages.filter(m => m.type === 'quiz').length;
}

function openQuizHistory() {
  const items = get().messages.filter(m => m.type === 'quiz').slice(-40).reverse();
  const rows = items.length ? items.map(m => {
    const q = m.quiz || {};
    const answered = (q.chosen || []).length > 0;
    const picked = (q.chosen || []).map(i => (q.options || [])[i]?.text).filter(Boolean).join('、');
    return `<div class="qz-his-row">
        <div class="qz-his-q">${escapeHtml(m.text || '')}</div>
        <div class="qz-his-meta"><span class="qz-his-st${answered ? ' done' : ''}">${answered ? 'TA 已选' : '等待中'}</span>${picked ? `<span class="qz-his-pick">${escapeHtml(picked)}</span>` : ''}</div>
      </div>`;
  }).join('') : '<div class="card-empty">还没有决策</div>';
  openSheet(`
    ${sheetTitle('决策记录')}
    <div class="qz-his">${rows}</div>
    <div class="sheet-actions"><button class="btn-ghost" data-quiz-close>关闭</button></div>
  `);
  $$('#sheet [data-quiz-close]').forEach(btn => { btn.onclick = closeSheet; });
}

function sendQuizCard(question, options, mode, wait, maxCount = 1) {
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
      quiz: { mode, options, chosen: [], answer: '', maxCount: Math.max(1, Number(maxCount) || 1) },
    });
  });
  playSound();
  scheduleRender(true);
  if (mode !== 'text' && options.length) {
    setTimeout(() => resolveQuiz(id, randomizeQuizAnswer(mode, options, maxCount)), Math.max(1, wait) * 1000);
  } else {
    setTimeout(() => triggerReply({ allowCall: false }), Math.max(1, wait) * 1000);
  }
}

function randomizeQuizAnswer(mode, options, maxCount = 1) {
  const cap = Math.max(1, Math.min(options.length, Number(maxCount) || 1));
  const count = mode === 'multi' ? randInt(1, cap) : 1;
  const pool = options.map((_, i) => i).sort(() => Math.random() - .5).slice(0, count);
  return pool.sort((a, b) => a - b);
}

function resolveQuiz(id, chosen) {
  const msg = get().messages.find(m => m.id === id);
  if (!msg || !msg.quiz || msg.quiz.answer) return;
  const picked = chosen.map(i => msg.quiz.options[i]).filter(Boolean);
  if (!picked.length) return;
  const answer = picked.map(o => o.reply).filter(Boolean).join(' ') || `我选「${picked.map(o => o.text).join('、')}」`;
  commit(st => {
    const m = st.messages.find(x => x.id === id);
    if (!m || !m.quiz) return;
    m.quiz.chosen = chosen;
    m.quiz.answer = answer;
    m.seen = true;
  });
  scheduleRender(true);
  const p = persona();
  // 对方作答：一条简短选择，再出现「填完了问卷」的提示
  addIncoming({ text: answer, senderName: p.name, senderId: '' });
  const noticeId = uid();
  fresh.add(noticeId);
  commit(st => {
    st.messages.push({
      id: noticeId,
      role: 'them',
      type: 'quizdone',
      text: `${p.name || 'TA'} 填完了问卷`,
      ts: Date.now(),
      seen: true,
      senderId: '',
    });
  });
  scheduleRender(true);
}

async function openTransfer() {
  const value = await promptSheet({ title: '转账', placeholder: '输入金额', confirm: '转账' });
  if (!value || !value.trim()) return;
  closeSheet();
  pushSelf({ text: `[转账] ¥${value.trim()}` });
  scheduleRender(true);
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
    updateBadge();
    if (router.isOpen('chat')) scheduleRender();
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
      if (renderRaf) {
        cancelAnimationFrame(renderRaf);
        renderRaf = 0;
        renderForce = false;
      }
      render(true);
      setTimeout(() => $('#msgScroll').scrollTop = $('#msgScroll').scrollHeight, 50);
    },
  });

  syncProactive();
  render(true);
}
