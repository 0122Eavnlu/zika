import { get, commit, subscribe } from './state.js';
import { $, $$, escapeHtml, timeText, setAvatar, toast, sleep, randInt, randFloat, pick, uid } from './util.js';
import { openSheet, closeSheet, sheetTitle, confirmSheet, actionSheet } from './ui.js';
import * as router from './router.js';
import { playSound } from './audio.js';
import { openCardSheet } from './cards.js';

let busy = false;
let replying = false;
let proTimer = null;
let proSignature = '';
let typingVisible = false;
const openMeta = new Set();
const fresh = new Set();

const SEPARATORS = ['，', '、', '；', '。'];

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
    if (g && g.blocked) return false;
    return true;
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
}

function buildMessage(msg) {
  const p = persona();
  const isMe = msg.role === 'me';
  const sender = senderOf(msg);
  const showAvatar = !isMe && p.showAvatar;
  const showName = !isMe && p.showName && get().group.enabled;
  const meta = [];
  if (get().ui.timeOn) meta.push(`<span class="t">${timeText(msg.ts)}</span>`);
  if (isMe && msg.read && get().ui.readOn) {
    meta.push(`<span class="read ok">${escapeHtml(readLabel(get().ui.readStyle))}</span>`);
  }
  const bubbleInner = (msg.quote ? `<span class="quote">${escapeHtml(msg.quote)}</span>` : '') + escapeHtml(msg.text);
  return `<div class="msg ${isMe ? 'me' : 'them'} ${showAvatar ? '' : 'no-avatar'} ${openMeta.has(msg.id) ? 'show-meta' : ''} ${fresh.has(msg.id) ? 'fresh' : ''}" data-id="${msg.id}">${showAvatar ? `<span class="avatar" data-avatar="${msg.id}"></span>` : ''}<div class="bubble-wrap">${showName ? `<div class="sender-name">${escapeHtml(sender.name)}</div>` : ''}<div class="bubble">${bubbleInner}</div>${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}</div></div>`;
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
      text: msgParts.text,
      ts: Date.now(),
      senderId: msgParts.senderId || '',
      quote: msgParts.quote || '',
      seen,
    });
  });
  if (!seen) notifyIncoming(msgParts.text, msgParts.senderName);
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
  const actions = [];
  if (msg.role === 'me') {
    actions.push({ label: '加入字卡', onClick: () => openCardSheet({ text: msg.text, title: '加入字卡' }) });
  }
  actions.push({ label: '复制', onClick: async () => {
    try { await navigator.clipboard.writeText(msg.text); toast('已复制'); } catch { toast('复制失败'); }
  } });
  actions.push({ label: '删除', danger: true, onClick: () => deleteMessage(id) });
  actionSheet(msg.role === 'me' ? '我的消息' : '对方消息', actions);
}

function handleTap(row, id) {
  const msg = get().messages.find(m => m.id === id);
  if (!msg) return;
  if (openMeta.has(id)) openMeta.delete(id); else openMeta.add(id);
  row.classList.toggle('show-meta');
  if (msg.role === 'me') {
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
    const bubble = event.target.closest('.bubble');
    if (!bubble) return;
    if (fired) { fired = false; return; }
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

export async function triggerReply({ proactive = false } = {}) {
  if (replying) return;
  const b = get().behavior;

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

  const count = randInt(1, 3);
  const chosen = [...pool].sort(() => Math.random() - .5).slice(0, Math.min(count, pool.length));
  const useQuote = b.quote && Math.random() < .65;
  const quote = useQuote ? pickQuote() : '';
  const groupOn = get().group.enabled;
  const randomSender = () => (groupOn ? pick(get().group.members) : null);

  markSelfRead();

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
}

function openChatMenu() {
  actionSheet('对话', [
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
  $('#chatMore').onclick = openChatMenu;

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
