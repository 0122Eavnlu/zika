import { get, commit, subscribe } from './state.js?v=20261030h';
import { $, $$, escapeHtml, timeText, setAvatar, toast, sleep, randInt, randFloat, pick, uid, pickFile, prepareSticker, compressImage } from './util.js?v=20261030h';
import { openSheet, closeSheet, sheetTitle, confirmSheet, actionSheet } from './ui.js?v=20261030h';
import * as router from './router.js?v=20261030h';
import { playSound } from './audio.js?v=20261030h';
import { startCall } from './call.js?v=20261030h';
import { openCardSheet } from './cards.js?v=20261030h';
import { openMoments } from './moments.js?v=20261030h';
import { pickLyric, isListening } from './music.js?v=20261030h';

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
  $('#chatStatus').style.display = p.showName && p.status ? '' : 'none';
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

function buildMessage(msg) {
  const p = persona();
  const isMe = msg.role === 'me';
  const type = msg.type || 'text';

  if (type === 'nudge') {
    return `<div class="msg nudge ${fresh.has(msg.id) ? 'fresh' : ''}" data-id="${msg.id}"><span>${escapeHtml(msg.text)}</span></div>`;
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
    inner = escapeHtml(`${msg.lead || '我想给你的'}《${msg.song || ''}》${msg.lyric || ''}`);
  } else {
    inner = (msg.quote ? `<span class="quote">${escapeHtml(msg.quote)}</span>` : '') + escapeHtml(msg.text);
  }

  // 气泡皮肤兼容：文字 / 歌词气泡额外挂 .message-sent / .message-received，
  // 并把内容包进 .content-wrapper，外部皮肤 CSS 可正常生效（含左右镜像写法）。
  const skinnable = type === 'text' || type === 'lyric';
  if (skinnable) bubbleCls += isMe ? ' message-sent' : ' message-received';
  if (type !== 'sticker' && type !== 'emoji' && type !== 'call') inner = `<span class="content-wrapper">${inner}</span>`;

  const avatarHtml = showAvatar ? `<span class="avatar" data-avatar="${msg.id}"></span>` : '';
  const meAvatarHtml = isMe ? `<span class="avatar me-avatar" data-avatar="${msg.id}" aria-label="我的资料"></span>` : '';
  return `<div class="msg ${isMe ? 'me' : 'them'} ${showAvatar || isMe ? '' : 'no-avatar'} ${openMeta.has(msg.id) ? 'show-meta' : ''} ${fresh.has(msg.id) ? 'fresh' : ''}" data-id="${msg.id}">${avatarHtml}<div class="bubble-wrap">${showName ? `<div class="sender-name">${escapeHtml(sender.name)}</div>` : ''}<div class="${bubbleCls}">${inner}</div>${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}</div>${meAvatarHtml}</div>`;
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
}

function markSelfRead() {
  const s = get();
  if (!s.messages.some(m => m.role === 'me' && !m.read)) return;
  commit(st => { st.messages.forEach(m => { if (m.role === 'me') m.read = true; }); });
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

function openMessageSheet(id) {
  const msg = get().messages.find(m => m.id === id);
  if (!msg) return;
  const isText = !msg.type || msg.type === 'text';
  const actions = [];
  if (msg.role === 'me' && isText) {
    actions.push({ label: '加入字卡', onClick: () => openCardSheet({ text: msg.text, title: '加入字卡' }) });
  }
  if (isText) {
    actions.push({ label: '复制', onClick: async () => {
      try { await navigator.clipboard.writeText(msg.text); toast('已复制'); } catch { toast('复制失败'); }
    } });
  }
  actions.push({ label: '删除', danger: true, onClick: () => deleteMessage(id) });
  actionSheet(msg.role === 'me' ? '我的消息' : '对方消息', actions);
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

function handleTap(row, id) {
  const msg = get().messages.find(m => m.id === id);
  if (!msg) return;
  if (openMeta.has(id)) openMeta.delete(id); else openMeta.add(id);
  row.classList.toggle('show-meta');
  if (msg.role === 'me' && (!msg.type || msg.type === 'text')) {
    openCardSheet({ text: msg.text, title: '加入字卡' });
  }
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
      openMessageSheet(pressId);
    }, 540);
  });

  list.addEventListener('pointermove', event => {
    if (!start) return;
    if (Math.abs(event.clientX - start.x) > 9 || Math.abs(event.clientY - start.y) > 9) clear();
  });
  list.addEventListener('pointerup', clear);
  list.addEventListener('pointercancel', clear);

  list.addEventListener('click', event => {
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
  const btn = $('#speakBtn');
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
    const btn = $('#speakBtn');
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
  const btn = $('#speakBtn');
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
    addIncoming({ text, quote, senderId: sender?.id || '', senderName: sender?.name || '' });
    playSound();
  } else {
    for (let i = 0; i < chosen.length; i++) {
      const sender = randomSender();
      addIncoming({
        text: chosen[i].text,
        quote: i === 0 ? quote : '',
        senderId: sender?.id || '',
        senderName: sender?.name || '',
      });
      if (i === 0) playSound();
      if (i < chosen.length - 1) await sleep(randInt(420, 860));
    }
  }

  replying = false;
  setSpeakState(false);
  await afterReply();
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
  $('#sendBtn').disabled = !input.value.trim();
}

function sendMessage() {
  const input = $('#msgInput');
  const text = input.value.trim();
  if (!text) return;
  const id = uid();
  fresh.add(id);
  commit(s => {
    s.messages.push({
      id,
      role: 'me',
      text,
      ts: Date.now(),
      read: false,
      seen: true,
      senderId: '',
    });
  });
  input.value = '';
  autoGrow();
  playSound();
  render(true);
  input.focus();
  triggerReply({ allowCall: false });
}

const ICON_STICKER = `<svg viewBox="0 0 24 24"><rect x="2.5" y="4.5" width="19" height="15" rx="4"/><circle cx="8" cy="10" r="1.6"/><path d="M5.4 15.6c.6-1.4 1.6-2.1 2.6-2.1s2 .7 2.6 2.1"/><path d="M14 9.5h5M14 13h5M14 16.5h3"/></svg>`;
const ICON_VIDEO = `<svg viewBox="0 0 24 24"><rect x="2.5" y="7" width="12.5" height="10" rx="3"/><path d="M15 11.2l5.4-3.1a.6.6 0 0 1 .9.5v6.8a.6.6 0 0 1-.9.5l-5.4-3.1z"/></svg>`;
const ICON_VOICE = `<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="9.5" rx="3"/><path d="M6.5 11a5.5 5.5 0 0 0 11 0M12 16.5v4M8.5 20.5h7"/></svg>`;

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
    ${sheetTitle('添加')}
    <div class="attach-grid">
      <button class="attach-item" data-attach="sticker">${ICON_STICKER}<span>表情包</span></button>
      <button class="attach-item" data-attach="video">${ICON_VIDEO}<span>视频</span></button>
      <button class="attach-item" data-attach="voice">${ICON_VOICE}<span>语音</span></button>
    </div>
  `);
  $$('#sheet [data-attach]').forEach(btn => {
    btn.onclick = () => {
      if (btn.dataset.attach === 'sticker') {
        openStickerPicker();
        return;
      }
      closeSheet();
      setTimeout(() => startCall(), 260);
    };
  });
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
  $('#speakBtn').onclick = () => {
    if (navigator.vibrate) navigator.vibrate(6);
    triggerReply();
  };
  $('#sendBtn').onclick = sendMessage;
  $('#plusBtn').onclick = openAttachPanel;
  $('#chatMore').onclick = openChatMenu;
  $('#chatAvatar').onclick = () => openMoments('chat');

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
