import { get, commit, subscribe } from './state.js?v=20261030d';
import { $, $$, escapeHtml, uid, toast, downloadBlob, pickFile, prepareSticker, setAvatar } from './util.js?v=20261030d';
import { openSheet, closeSheet, sheetTitle, confirmSheet, promptSheet, actionSheet } from './ui.js?v=20261030d';
import * as router from './router.js?v=20261030d';

const norm = text => text.replace(/\s+/g, ' ').trim();

let activeGroup = 'all';
let query = '';
let sortMode = 'new';
let selecting = false;
let tab = 'cards';
const selected = new Set();

/* ---------- 数据 ---------- */

export function addCard(text, groupId = '') {
  const t = text.trim();
  if (!t) return false;
  const n = norm(t);
  if (get().cards.items.some(c => norm(c.text) === n)) return false;
  const gid = get().cards.groups.some(g => g.id === groupId) ? groupId : '';
  commit(s => {
    s.cards.items.unshift({ id: uid(), text: t, groupId: gid, blocked: false, at: Date.now() });
  });
  return true;
}

export function parseCardText(raw) {
  const lines = raw.replaceAll('\ufeff', '').split(/\r?\n/);
  let current = null;
  const entries = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^[\[［]([^\]］]+)[\]］]\s*$/);
    if (m) { current = m[1].trim(); continue; }
    entries.push({ groupName: current, text: t });
  }
  return entries;
}

export function importCardText(raw) {
  const entries = parseCardText(raw);
  if (!entries.length) return 0;
  let added = 0;
  const existing = new Set(get().cards.items.map(c => norm(c.text)));
  commit(s => {
    const groupByName = new Map(s.cards.groups.map(g => [g.name, g.id]));
    for (const entry of entries) {
      let gid = '';
      if (entry.groupName) {
        if (groupByName.has(entry.groupName)) {
          gid = groupByName.get(entry.groupName);
        } else {
          const id = uid();
          s.cards.groups.push({ id, name: entry.groupName, blocked: false, at: Date.now() });
          groupByName.set(entry.groupName, id);
          gid = id;
        }
      }
      const n = norm(entry.text);
      if (existing.has(n)) continue;
      existing.add(n);
      s.cards.items.push({ id: uid(), text: entry.text, groupId: gid, blocked: false, at: Date.now() + added });
      added++;
    }
  });
  return added;
}

export function cardsToText() {
  const s = get();
  const lines = [];
  const pushGroup = (name, items) => {
    lines.push(`[${name}]`);
    items.forEach(c => lines.push(c.text));
    lines.push('');
  };
  s.cards.groups.forEach(g => {
    pushGroup(g.name, s.cards.items.filter(c => c.groupId === g.id));
  });
  const loose = s.cards.items.filter(c => !s.cards.groups.some(g => g.id === c.groupId));
  if (loose.length) pushGroup('未分组', loose);
  return lines.join('\n').trim() + '\n';
}

/* ---------- 渲染 ---------- */

function groupOf(card) {
  return get().cards.groups.find(g => g.id === card.groupId) || null;
}

function filtered() {
  const s = get();
  let items = s.cards.items.slice();
  if (activeGroup === 'none') items = items.filter(c => !groupOf(c));
  else if (activeGroup !== 'all') items = items.filter(c => c.groupId === activeGroup);
  if (query) {
    const q = query.toLowerCase();
    items = items.filter(c => c.text.toLowerCase().includes(q));
  }
  if (sortMode === 'alpha') items.sort((a, b) => a.text.localeCompare(b.text, 'zh-CN'));
  else if (sortMode === 'old') items.sort((a, b) => a.at - b.at);
  else items.sort((a, b) => b.at - a.at);
  return items;
}

function renderChips() {
  const s = get();
  const el = $('#cardChips');
  const total = s.cards.items.length;
  const loose = s.cards.items.filter(c => !groupOf(c)).length;
  let html = `<button class="chip ${activeGroup === 'all' ? 'active' : ''}" data-chip="all">全部</button>`;
  html += `<button class="chip ${activeGroup === 'none' ? 'active' : ''}" data-chip="none">未分组</button>`;
  s.cards.groups.forEach(g => {
    const count = s.cards.items.filter(c => c.groupId === g.id).length;
    html += `<button class="chip ${activeGroup === g.id ? 'active' : ''} ${g.blocked ? 'blocked' : ''}" data-chip="${g.id}" data-group="${g.id}">${escapeHtml(g.name)}</button>`;
  });
  html += `<button class="chip add" id="chipAdd" aria-label="新建分组"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>`;
  el.innerHTML = html;
  $('#chipAdd').onclick = newGroup;
}

function renderList() {
  const list = $('#cardList');
  const items = filtered();
  $('#cardCount').textContent = items.length ? `${items.length} 张` : '';
  if (!items.length) {
    list.innerHTML = `<div class="card-empty">空</div>`;
    return;
  }
  list.innerHTML = items.map(card => {
    const g = groupOf(card);
    const isSel = selected.has(card.id);
    return `
      <div class="card-item ${card.blocked ? 'blocked' : ''} ${isSel ? 'selected' : ''}" data-id="${card.id}">
        ${selecting ? `<span class="check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg></span>` : ''}
        <div class="card-main">
          <div class="card-text">${escapeHtml(card.text)}</div>
          <div class="card-sub">
            ${g ? `<span class="tag">${escapeHtml(g.name)}</span>` : ''}
            ${card.blocked ? '<span class="blocked-mark">屏蔽</span>' : ''}
          </div>
        </div>
        ${selecting ? '' : `<button class="card-more" data-more="${card.id}" aria-label="更多"><svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/></svg></button>`}
      </div>`;
  }).join('');
}

function renderBatchBar() {
  const bar = $('#batchBar');
  bar.hidden = !selecting;
  $('#cardSelectBtn').textContent = selecting ? '完成' : '选择';
  if (selecting) {
    $('#batchCount').textContent = `${selected.size}`;
    $('#batchMove').disabled = selected.size === 0;
    $('#batchBlock').disabled = selected.size === 0;
    $('#batchDelete').disabled = selected.size === 0;
  }
}

function renderStickers() {
  const stickers = get().stickers || [];
  const grid = $('#stickerGrid');
  if (!stickers.length) {
    grid.innerHTML = `<div class="card-empty">空</div>`;
    return;
  }
  grid.innerHTML = stickers.map(s => `
    <div class="sticker-cell" data-sticker="${s.id}">
      <img src="${s.url}" alt="">
      <button class="del" data-sticker-del="${s.id}" aria-label="删除">
        <svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7l-10 10"/></svg>
      </button>
    </div>
  `).join('');
}

function renderNudge() {
  const n = get().nudge;
  $('#nudgeSwitch').classList.toggle('on', Boolean(n.enabled));
  $('#nudgeChance').value = String(n.chance);
  $('#nudgeVal').textContent = `${n.chance}%`;
  const list = $('#nudgeList');
  if (!n.items.length) {
    list.innerHTML = `<div class="nudge-empty">空</div>`;
    return;
  }
  list.innerHTML = n.items.map(it => `
    <div class="nudge-item" data-nudge="${it.id}">
      <span class="nudge-name">${escapeHtml(it.text)}</span>
      <button class="nudge-remove" data-nudge-del="${it.id}">删除</button>
    </div>
  `).join('');
}

function render() {
  if (tab === 'cards') {
    renderChips();
    renderList();
    renderBatchBar();
    return;
  }
  $('#batchBar').hidden = true;
  if (tab === 'stickers') renderStickers();
  else renderNudge();
}

function setTab(next) {
  tab = next;
  $$('#cardTabs button').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === next));
  $('#panel-cards').hidden = next !== 'cards';
  $('#panel-stickers').hidden = next !== 'stickers';
  $('#panel-nudge').hidden = next !== 'nudge';
  if (next !== 'cards') {
    selecting = false;
    selected.clear();
  }
  render();
}

/* ---------- 分组 ---------- */

function newGroup() {
  promptSheet({ title: '新建分组', placeholder: '分组名称', confirm: '创建' }).then(name => {
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const exists = get().cards.groups.find(g => g.name === trimmed);
    if (exists) { toast('分组已存在'); return; }
    const gid = uid();
    commit(s => s.cards.groups.push({ id: gid, name: trimmed, blocked: false, at: Date.now() }));
    activeGroup = gid;
    render();
    toast('已创建');
  });
}

function openGroupSheet(gid) {
  const g = get().cards.groups.find(x => x.id === gid);
  if (!g) return;
  actionSheet(g.name, [
    { label: '重命名', onClick: () => renameGroup(gid) },
    { label: g.blocked ? '取消屏蔽' : '屏蔽分组', onClick: () => toggleGroupBlock(gid) },
    { label: '删除分组', danger: true, onClick: () => deleteGroup(gid) },
  ]);
}

function renameGroup(gid) {
  const g = get().cards.groups.find(x => x.id === gid);
  if (!g) return;
  promptSheet({ title: '重命名', value: g.name, placeholder: '分组名称' }).then(name => {
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    if (get().cards.groups.some(x => x.name === trimmed && x.id !== gid)) { toast('名称重复'); return; }
    commit(s => { const t = s.cards.groups.find(x => x.id === gid); if (t) t.name = trimmed; });
  });
}

function toggleGroupBlock(gid) {
  commit(s => { const g = s.cards.groups.find(x => x.id === gid); if (g) g.blocked = !g.blocked; });
}

function deleteGroup(gid) {
  const g = get().cards.groups.find(x => x.id === gid);
  if (!g) return;
  const count = get().cards.items.filter(c => c.groupId === gid).length;
  confirmSheet({
    title: '删除分组',
    text: `「${g.name}」及其中 ${count} 张字卡将被删除`,
    confirm: '删除',
    danger: true,
  }).then(ok => {
    if (!ok) return;
    commit(s => {
      s.cards.items = s.cards.items.filter(c => c.groupId !== gid);
      s.cards.groups = s.cards.groups.filter(x => x.id !== gid);
    });
    if (activeGroup === gid) activeGroup = 'all';
    toast('已删除');
  });
}

/* ---------- 字卡编辑 ---------- */

function groupOptions(selectedId) {
  const s = get();
  return [
    `<option value="" ${selectedId === '' ? 'selected' : ''}>未分组</option>`,
    ...s.cards.groups.map(g => `<option value="${g.id}" ${g.id === selectedId ? 'selected' : ''}>${escapeHtml(g.name)}</option>`),
  ].join('');
}

export function openCardSheet({ text = '', groupId = '', title = '新字卡', cardId = '' } = {}) {
  const defaultGroup = groupId || (activeGroup !== 'all' && activeGroup !== 'none' ? activeGroup : '');
  openSheet(`
    ${sheetTitle(title)}
    <div class="sheet-form">
      <textarea id="cardText" class="input area" rows="4" placeholder="字卡内容，一行一张" maxlength="2000">${escapeHtml(text)}</textarea>
      <select id="cardGroup" class="input">${groupOptions(defaultGroup)}</select>
    </div>
    <div class="sheet-actions">
      <button class="btn-ghost" id="cardCancel">取消</button>
      <button class="btn-ink" id="cardSave">保存</button>
    </div>
  `);
  const area = $('#cardText');
  setTimeout(() => { area.focus(); area.setSelectionRange(area.value.length, area.value.length); }, 100);
  $('#cardCancel').onclick = closeSheet;
  $('#cardSave').onclick = () => {
    const raw = area.value;
    if (!raw.trim()) return;
    const gid = $('#cardGroup').value;
    if (cardId) {
      const value = raw.trim();
      const n = norm(value);
      const dup = get().cards.items.some(c => c.id !== cardId && norm(c.text) === n);
      if (dup) { toast('字卡已存在'); return; }
      commit(s => {
        const t = s.cards.items.find(c => c.id === cardId);
        if (t) { t.text = value; t.groupId = gid; }
      });
      closeSheet();
      toast('已保存');
      return;
    }
    const lines = raw.split(/\r?\n/).map(t => t.trim()).filter(Boolean);
    const existing = new Set(get().cards.items.map(c => norm(c.text)));
    let added = 0;
    commit(s => {
      for (const line of lines) {
        const n = norm(line);
        if (existing.has(n)) continue;
        existing.add(n);
        s.cards.items.unshift({ id: uid(), text: line, groupId: gid, blocked: false, at: Date.now() + added });
        added++;
      }
    });
    closeSheet();
    toast(added === 1 ? '已加入' : added ? `已加入 ${added} 张` : '字卡已存在');
  };
}

function openCardActions(id) {
  const card = get().cards.items.find(c => c.id === id);
  if (!card) return;
  actionSheet('字卡', [
    { label: '编辑', onClick: () => openCardSheet({ text: card.text, groupId: card.groupId, title: '编辑字卡', cardId: id }) },
    { label: '移动', onClick: () => openMovePicker([id]) },
    { label: card.blocked ? '取消屏蔽' : '屏蔽', onClick: () => commit(s => { const c = s.cards.items.find(x => x.id === id); if (c) c.blocked = !c.blocked; }) },
    { label: '删除', danger: true, onClick: () => {
      commit(s => { s.cards.items = s.cards.items.filter(c => c.id !== id); });
      toast('已删除');
    } },
  ]);
}

function openMovePicker(ids) {
  const s = get();
  const rows = [
    `<button data-move="" class="${ids.length && get().cards.items.find(c => c.id === ids[0])?.groupId === '' ? 'active' : ''}">未分组</button>`,
    ...s.cards.groups.map(g => `<button data-move="${g.id}" class="${ids.length && get().cards.items.find(c => c.id === ids[0])?.groupId === g.id ? 'active' : ''}">${escapeHtml(g.name)}</button>`),
    `<button data-move="__new">＋ 新建分组</button>`,
  ].join('');
  openSheet(`${sheetTitle('移动到')}<div class="group-pick">${rows}</div>`);
  $$('#sheet .group-pick button').forEach(btn => {
    btn.onclick = () => {
      const target = btn.dataset.move;
      if (target === '__new') {
        promptSheet({ title: '新建分组', placeholder: '分组名称', confirm: '创建' }).then(name => {
          if (!name || !name.trim()) return;
          const nm = name.trim();
          let gid = get().cards.groups.find(g => g.name === nm)?.id;
          if (!gid) {
            gid = uid();
            commit(s2 => s2.cards.groups.push({ id: gid, name: nm, blocked: false, at: Date.now() }));
          }
          doMove(ids, gid);
        });
        return;
      }
      doMove(ids, target);
    };
  });
}

function doMove(ids, groupId) {
  commit(s => {
    s.cards.items.forEach(c => { if (ids.includes(c.id)) c.groupId = groupId; });
  });
  closeSheet();
  toast(`已移动 ${ids.length} 张`);
}

/* ---------- 表情包 ---------- */

async function uploadSticker() {
  const files = await pickFile('image/*', true);
  if (!files || !files.length) return;
  const list = Array.from(files).slice(0, 100);
  let added = 0;
  for (const file of list) {
    try {
      const url = await prepareSticker(file);
      commit(s => { s.stickers.unshift({ id: uid(), url, at: Date.now() }); });
      added++;
    } catch {}
  }
  toast(added ? `已添加 ${added} 张` : '图片处理失败');
}

/* ---------- 拍一拍 ---------- */

function addNudge() {
  promptSheet({ title: '拍一拍', placeholder: '拍了拍你的肩膀', confirm: '添加' }).then(text => {
    if (!text || !text.trim()) return;
    commit(s => { s.nudge.items.unshift({ id: uid(), text: text.trim(), at: Date.now() }); });
    toast('已添加');
  });
}

function editNudge(id) {
  const item = get().nudge.items.find(x => x.id === id);
  if (!item) return;
  promptSheet({ title: '拍一拍', value: item.text, placeholder: '拍了拍你的肩膀' }).then(text => {
    if (!text || !text.trim()) return;
    commit(s => {
      const t = s.nudge.items.find(x => x.id === id);
      if (t) t.text = text.trim();
    });
  });
}

/* ---------- 批量 ---------- */

function openBatchAdd() {
  openSheet(`
    ${sheetTitle('批量添加')}
    <div class="sheet-form">
      <textarea id="batchText" class="input area" rows="8" placeholder="[分组]&#10;一行一张字卡" spellcheck="false"></textarea>
    </div>
    <div class="sheet-actions">
      <button class="btn-ghost" id="batchCancel">取消</button>
      <button class="btn-ink" id="batchSave">加入</button>
    </div>
  `);
  const area = $('#batchText');
  setTimeout(() => area.focus(), 100);
  $('#batchCancel').onclick = closeSheet;
  $('#batchSave').onclick = () => {
    const raw = area.value;
    if (!raw.trim()) return;
    const added = importCardText(raw);
    closeSheet();
    toast(added ? `已加入 ${added} 张` : '没有新增字卡');
  };
}

function openCardMenu() {
  actionSheet('字卡库', [
    { label: '批量添加', onClick: openBatchAdd },
    { label: '导入 TXT', onClick: () => importFile() },
    { label: '导出 TXT', onClick: () => {
      downloadBlob('字卡库.txt', '\ufeff' + cardsToText(), 'text/plain;charset=utf-8');
      toast('已导出');
    } },
    { label: '全选当前', onClick: () => { selecting = true; filtered().forEach(c => selected.add(c.id)); render(); } },
  ]);
}

async function importFile() {
  const file = await pickFile('.txt,text/plain');
  if (!file) return;
  const raw = await file.text();
  const added = importCardText(raw);
  toast(added ? `已导入 ${added} 张` : '没有新增字卡');
}

/* ---------- 事件 ---------- */

function bind() {
  $('#cardAdd').onclick = () => {
    if (tab === 'stickers') uploadSticker();
    else if (tab === 'nudge') addNudge();
    else openCardSheet({});
  };
  $('#cardMenu').onclick = openCardMenu;
  $('#cardTabs').addEventListener('click', event => {
    const btn = event.target.closest('[data-tab]');
    if (btn) setTab(btn.dataset.tab);
  });
  $('#stickerUpload').onclick = uploadSticker;
  $('#stickerGrid').addEventListener('click', event => {
    const del = event.target.closest('[data-sticker-del]');
    if (!del) return;
    commit(s => { s.stickers = s.stickers.filter(x => x.id !== del.dataset.stickerDel); });
    toast('已删除');
  });
  $('#nudgeSwitch').onclick = () => commit(s => { s.nudge.enabled = !s.nudge.enabled; });
  $('#nudgeChance').addEventListener('input', event => {
    const value = Number(event.target.value);
    $('#nudgeVal').textContent = `${value}%`;
    commit(s => { s.nudge.chance = value; });
  });
  $('#nudgeAdd').onclick = addNudge;
  $('#nudgeList').addEventListener('click', event => {
    const del = event.target.closest('[data-nudge-del]');
    if (del) {
      commit(s => { s.nudge.items = s.nudge.items.filter(x => x.id !== del.dataset.nudgeDel); });
      toast('已删除');
      return;
    }
    const item = event.target.closest('[data-nudge]');
    if (item) editNudge(item.dataset.nudge);
  });
  $('#cardSelectBtn').onclick = () => {
    selecting = !selecting;
    if (!selecting) selected.clear();
    render();
  };
  $('#cardSort').onchange = event => {
    sortMode = event.target.value;
    renderList();
  };
  const search = $('#cardSearch');
  search.addEventListener('input', () => {
    query = search.value.trim();
    $('#cardSearchClear').hidden = !query;
    renderList();
  });
  $('#cardSearchClear').onclick = () => {
    search.value = '';
    query = '';
    $('#cardSearchClear').hidden = true;
    renderList();
  };

  $('#cardChips').addEventListener('click', event => {
    const chip = event.target.closest('[data-chip]');
    if (!chip) return;
    if (chip.dataset.longpress === '1') { chip.dataset.longpress = '0'; return; }
    activeGroup = chip.dataset.chip;
    renderChips();
    renderList();
  });

  let chipTimer = null;
  let chipStart = null;
  $('#cardChips').addEventListener('pointerdown', event => {
    const chip = event.target.closest('[data-group]');
    if (!chip) return;
    chipStart = { x: event.clientX, y: event.clientY };
    const gid = chip.dataset.group;
    chipTimer = setTimeout(() => {
      chip.dataset.longpress = '1';
      setTimeout(() => { chip.dataset.longpress = '0'; }, 900);
      openGroupSheet(gid);
    }, 520);
  });
  const cancelChipTimer = () => { clearTimeout(chipTimer); chipTimer = null; };
  $('#cardChips').addEventListener('pointermove', event => {
    if (!chipStart) return;
    if (Math.abs(event.clientX - chipStart.x) > 8 || Math.abs(event.clientY - chipStart.y) > 8) cancelChipTimer();
  });
  $('#cardChips').addEventListener('pointerup', cancelChipTimer);
  $('#cardChips').addEventListener('pointercancel', cancelChipTimer);

  $('#cardList').addEventListener('click', event => {
    const more = event.target.closest('[data-more]');
    if (more) {
      event.stopPropagation();
      openCardActions(more.dataset.more);
      return;
    }
    const item = event.target.closest('.card-item');
    if (!item) return;
    const id = item.dataset.id;
    if (selecting) {
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      render();
    } else {
      const card = get().cards.items.find(c => c.id === id);
      if (card) openCardSheet({ text: card.text, groupId: card.groupId, title: '编辑字卡', cardId: id });
    }
  });

  $('#batchCancel').onclick = () => { selecting = false; selected.clear(); render(); };
  $('#batchDelete').onclick = () => {
    if (!selected.size) return;
    confirmSheet({ title: '删除字卡', text: `将删除 ${selected.size} 张字卡`, confirm: '删除', danger: true }).then(ok => {
      if (!ok) return;
      commit(s => { s.cards.items = s.cards.items.filter(c => !selected.has(c.id)); });
      selected.clear();
      selecting = false;
      render();
      toast('已删除');
    });
  };
  $('#batchBlock').onclick = () => {
    if (!selected.size) return;
    const cards = get().cards.items.filter(c => selected.has(c.id));
    const allBlocked = cards.every(c => c.blocked);
    commit(s => { s.cards.items.forEach(c => { if (selected.has(c.id)) c.blocked = !allBlocked; }); });
    render();
  };
  $('#batchMove').onclick = () => {
    if (!selected.size) return;
    openMovePicker([...selected]);
  };
}

export function initCards() {
  bind();
  subscribe(() => {
    if (router.isOpen('cards')) {
      if (selected.size) {
        selected.forEach(id => { if (!get().cards.items.some(c => c.id === id)) selected.delete(id); });
      }
      render();
    }
  });
  router.register('cards', { onOpen: () => {
    $('#cardSort').value = sortMode;
    render();
  } });
  render();
}
