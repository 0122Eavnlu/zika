import { get, commit, subscribe } from './state.js?v=20261101H';
import { $, $$, escapeHtml, timeText, toast, pick, randInt, randFloat, uid, downloadBlob, pickFile } from './util.js?v=20261101H';
import * as router from './router.js?v=20261101H';
import { confirmSheet } from './ui.js?v=20261101H';

let letterTimer = null;
let letterSig = '';
let currentTab = 'inbox';

const SEPS = ['，', '。', '、', '；', '…'];

function personaName() {
  return get().persona?.name || 'TA';
}

function meName() {
  return get().me?.name || '我';
}

/* ---------- 生成信件内容 ---------- */

function genLetterText() {
  const items = (get().cards?.items || []).filter(c => c && c.text && !c.blocked);
  const pool = items.length ? items : [{ text: '今天也很想你。' }, { text: '记得好好吃饭。' }, { text: '晚安。' }];
  const n = randInt(5, Math.min(30, pool.length));
  const shuffled = [...pool].sort(() => Math.random() - 0.5).slice(0, n);
  return shuffled.map(c => c.text).join(pick(SEPS)) + pick(['。', '…', '']);
}

/* ---------- 渲染 ---------- */

function renderList(box) {
  const list = get().letters?.[box] || [];
  const el = box === 'inbox' ? $('#inboxList') : $('#outboxList');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = `<div class="letter-empty">还没有信</div>`;
    return;
  }
  // 按月份分组
  const groups = new Map();
  [...list].sort((a, b) => b.ts - a.ts).forEach(l => {
    const d = new Date(l.ts);
    const key = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(l);
  });
  el.innerHTML = [...groups.entries()].map(([month, items]) => `
    <div class="letter-month">${month}</div>
    ${items.map(l => `
      <div class="letter-item${l.read ? '' : ' unread'}" data-lid="${l.id}">
        <div class="letter-head">
          <span class="letter-from">${box === 'inbox' ? escapeHtml(personaName()) : escapeHtml(meName())}</span>
          <span class="letter-time">${timeText(l.ts)}</span>
        </div>
        <div class="letter-body">${escapeHtml(l.text)}</div>
      </div>
    `).join('')}
  `).join('');
  el.querySelectorAll('.letter-item').forEach(item => {
    item.onclick = () => {
      const id = item.dataset.lid;
      if (box === 'inbox') {
        commit(s => {
          const l = (s.letters.inbox || []).find(x => x.id === id);
          if (l) l.read = true;
        });
      }
    };
  });
}

function render() {
  if (currentTab === 'inbox') renderList('inbox');
  else if (currentTab === 'outbox') renderList('outbox');
}

function switchTab(tab) {
  currentTab = tab;
  $$('#letterTabs button').forEach(b => b.classList.toggle('active', b.dataset.ltab === tab));
  $('#letter-inbox').hidden = tab !== 'inbox';
  $('#letter-outbox').hidden = tab !== 'outbox';
  $('#letter-write').hidden = tab !== 'write';
  $('#letter-data').hidden = tab !== 'data';
  render();
}

/* ---------- 写信 / 寄信 ---------- */

function updateCount() {
  const ta = $('#letterText');
  $('#letterCount').textContent = `${(ta.value || '').length} 字`;
}

function sendLetter() {
  const text = ($('#letterText').value || '').trim();
  if (!text) {
    toast('写点什么吧');
    return;
  }
  commit(s => {
    s.letters.outbox.unshift({ id: uid(), text, ts: Date.now(), read: true });
  });
  $('#letterText').value = '';
  updateCount();
  toast('已寄出');
  // 对方有概率回一封信
  maybeReplyLetter();
}

function maybeReplyLetter() {
  setTimeout(() => {
    receiveLetter(genLetterText());
  }, randInt(30, 120) * 1000);
}

function receiveLetter(text) {
  const id = uid();
  commit(s => {
    s.letters.inbox.unshift({ id, text, ts: Date.now(), read: false });
  });
  updateBadge();
}

/* ---------- 数据 ---------- */

function exportLetters() {
  const data = { app: 'zika-letters', version: 1, exportedAt: new Date().toISOString(), letters: get().letters };
  downloadBlob(`letters-${Date.now()}.json`, JSON.stringify(data, null, 2), 'application/json');
  toast('已导出');
}

async function importLetters() {
  const file = await pickFile('application/json,.json');
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const letters = parsed?.letters || parsed;
    if (!letters || typeof letters !== 'object') throw new Error('bad');
    commit(s => {
      if (Array.isArray(letters.inbox)) s.letters.inbox = letters.inbox;
      if (Array.isArray(letters.outbox)) s.letters.outbox = letters.outbox;
    });
    toast('已导入');
    render();
  } catch {
    toast('文件格式不对');
  }
}

function clearLetters() {
  confirmSheet('确定清空所有信件？此操作不可撤销').then(ok => {
    if (!ok) return;
    commit(s => { s.letters = { inbox: [], outbox: [] }; });
    updateBadge();
    render();
    toast('已清空');
  });
}

/* ---------- 未读角标 ---------- */

function updateBadge() {
  const unread = (get().letters?.inbox || []).filter(l => !l.read).length;
  $$('[data-letter-badge], #letterBadge').forEach(badge => {
    if (unread > 0) {
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  });
}

/* ---------- 主动来信定时器 ---------- */

function letterConfigSig() {
  const b = get().behavior?.letter || {};
  return `${b.enabled}|${b.minMin}|${b.maxMin}|${b.chance}`;
}

function scheduleLetter() {
  clearTimeout(letterTimer);
  letterTimer = null;
  const b = get().behavior?.letter;
  if (!b || !b.enabled) return;
  const min = Math.max(1, Number(b.minMin) || 30);
  const max = Math.max(min, Number(b.maxMin) || min);
  const minutes = min === max ? min : randFloat(min, max);
  letterTimer = setTimeout(() => {
    const chance = Math.max(0, Math.min(100, Number(b.chance) || 0));
    if (Math.random() * 100 < chance) {
      receiveLetter(genLetterText());
    }
    scheduleLetter();
  }, minutes * 60000);
}

export function syncLetter() {
  const sig = letterConfigSig();
  if (sig === letterSig) return;
  letterSig = sig;
  scheduleLetter();
}

/* ---------- 初始化 ---------- */

export function initLetters() {
  router.register('letters', {
    onOpen() {
      switchTab('inbox');
      // 进入信箱时全部标为已读
      commit(s => { (s.letters.inbox || []).forEach(l => { l.read = true; }); });
      updateBadge();
    },
  });

  $$('#letterTabs button').forEach(btn => {
    btn.onclick = () => switchTab(btn.dataset.ltab);
  });

  $('#letterGen').onclick = () => {
    $('#letterText').value = genLetterText();
    updateCount();
  };
  $('#letterText').addEventListener('input', updateCount);
  $('#letterSend').onclick = sendLetter;

  $('#letterExport').onclick = exportLetters;
  $('#letterImport').onclick = importLetters;
  $('#letterClear').onclick = clearLetters;

  subscribe(() => {
    updateBadge();
    if (router.currentScreen() === 'letters') render();
  });

  updateBadge();
  syncLetter();
}
