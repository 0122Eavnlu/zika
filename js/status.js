import { get, commit, subscribe } from './state.js?v=20261030e';
import { $, $$, escapeHtml, uid, pick, randInt, toast } from './util.js?v=20261030e';
import { openSheet, closeSheet, sheetTitle, promptSheet } from './ui.js?v=20261030e';

const MIN_WAIT = 10 * 60 * 1000;
const MAX_WAIT = 120 * 60 * 1000;
let timer = null;
let lastAt = -1;
let lastWait = -1;

function statusGroupId() {
  const g = get().cards.groups.find(x => x.name === '状态');
  return g ? g.id : '';
}

export function statusItems() {
  const gid = statusGroupId();
  if (!gid) return [];
  return get().cards.items.filter(c => c.groupId === gid && !c.blocked);
}

function addStatusCards(texts) {
  let gid = statusGroupId();
  const existing = new Set(get().cards.items.map(c => c.text.trim()));
  const fresh = texts.filter(t => !existing.has(t));
  if (!fresh.length) return;
  commit(s => {
    if (!gid) {
      gid = uid();
      s.cards.groups.push({ id: gid, name: '状态', blocked: false, at: Date.now() });
    }
    fresh.forEach((text, i) => {
      s.cards.items.unshift({ id: uid(), text, groupId: gid, blocked: false, at: Date.now() + i });
    });
  });
}

export function setStatus(text) {
  commit(s => {
    s.persona.status = text;
    s.persona.statusAt = Date.now();
    s.persona.statusWait = randInt(MIN_WAIT, MAX_WAIT);
  });
  schedule();
}

function rotate() {
  const items = statusItems();
  const cur = get().persona.status;
  const others = items.filter(c => c.text !== cur);
  const next = others.length ? pick(others) : (items[0] || null);
  commit(s => {
    if (next) s.persona.status = next.text;
    s.persona.statusAt = Date.now();
    s.persona.statusWait = randInt(MIN_WAIT, MAX_WAIT);
  });
  schedule();
}

function schedule() {
  clearTimeout(timer);
  timer = null;
  const p = get().persona;
  let at = Number(p.statusAt) || 0;
  let wait = Number(p.statusWait) || 0;
  if (!at || wait < MIN_WAIT || wait > MAX_WAIT) {
    const now = Date.now();
    at = at || now;
    wait = randInt(MIN_WAIT, MAX_WAIT);
    commit(s => {
      s.persona.statusAt = at;
      s.persona.statusWait = wait;
    });
  }
  const remain = at + wait - Date.now();
  lastAt = at;
  lastWait = wait;
  timer = setTimeout(rotate, Math.min(Math.max(remain, 400), MAX_WAIT));
}

export function initStatus() {
  schedule();
  subscribe(s => {
    const at = Number(s.persona.statusAt) || 0;
    const wait = Number(s.persona.statusWait) || 0;
    if (at !== lastAt || wait !== lastWait) schedule();
  });
}

export function openStatusSheet() {
  const items = statusItems();
  const cur = get().persona.status;
  const rows = items.length
    ? items.map(c => `
      <div class="status-item">
        <button class="status-main ${c.text === cur ? 'active' : ''}" data-status="${c.id}">${escapeHtml(c.text)}</button>
        <button class="status-del" data-status-del="${c.id}" aria-label="删除">
          <svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7l-10 10"/></svg>
        </button>
      </div>`).join('')
    : '<div class="card-empty">空</div>';
  openSheet(`
    ${sheetTitle('状态')}
    <div class="status-list">${rows}</div>
    <div class="sheet-actions">
      <button class="btn-ghost" id="statusClose">关闭</button>
      <button class="btn-ink" id="statusAdd">添加字卡</button>
    </div>
  `);
  $('#statusClose').onclick = closeSheet;
  $('#statusAdd').onclick = () => {
    promptSheet({ title: '状态字卡', placeholder: '一行一条状态', confirm: '添加', multiline: true }).then(text => {
      if (!text || !text.trim()) return;
      const lines = text.split(/\r?\n/).map(t => t.trim()).filter(Boolean);
      if (!lines.length) return;
      addStatusCards(lines);
      setStatus(lines[lines.length - 1]);
      toast('已添加');
      setTimeout(openStatusSheet, 280);
    });
  };
  $$('#sheet [data-status-del]').forEach(btn => {
    btn.onclick = () => {
      commit(s => { s.cards.items = s.cards.items.filter(c => c.id !== btn.dataset.statusDel); });
      openStatusSheet();
      toast('已删除');
    };
  });
  $$('#sheet [data-status]').forEach(btn => {
    btn.onclick = () => {
      const card = get().cards.items.find(c => c.id === btn.dataset.status);
      if (!card) return;
      setStatus(card.text);
      closeSheet();
      toast('状态已更新');
    };
  });
}
