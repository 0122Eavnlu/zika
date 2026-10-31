import { $, escapeHtml } from './util.js?v=20261031f';

let keyHandler = null;
let closeToken = 0;

export function openSheet(inner) {
  closeToken++;
  const layer = $('#sheetLayer');
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="grabber"></div>${inner}`;
  sheet.classList.remove('sheet-white');
  layer.classList.remove('closing');
  sheet.classList.remove('closing');
  layer.hidden = false;

  layer.onclick = event => {
    if (event.target === layer) closeSheet();
  };
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = event => {
    if (event.key === 'Escape') closeSheet();
  };
  document.addEventListener('keydown', keyHandler);
  return sheet;
}

export function closeSheet() {
  const layer = $('#sheetLayer');
  const sheet = $('#sheet');
  if (!layer || layer.hidden) return;
  const token = ++closeToken;
  layer.classList.add('closing');
  sheet.classList.add('closing');
  setTimeout(() => {
    if (token !== closeToken) return;
    layer.hidden = true;
    layer.classList.remove('closing');
    sheet.classList.remove('closing');
    sheet.innerHTML = '';
    layer.onclick = null;
    if (keyHandler) {
      document.removeEventListener('keydown', keyHandler);
      keyHandler = null;
    }
  }, 240);
}

export function sheetTitle(title) {
  return `<h2 class="sheet-title">${escapeHtml(title)}</h2>`;
}

export function confirmSheet({ title, text = '', confirm = '确认', danger = false }) {
  return new Promise(resolve => {
    openSheet(`
      ${sheetTitle(title)}
      ${text ? `<p style="text-align:center;color:var(--ink-2);font-size:.85em;line-height:1.7;margin:-4px 0 6px">${escapeHtml(text)}</p>` : ''}
      <div class="sheet-actions">
        <button class="btn-ghost" id="sheetCancel">取消</button>
        <button class="${danger ? 'btn-danger' : 'btn-ink'}" id="sheetOk">${escapeHtml(confirm)}</button>
      </div>
    `);
    $('#sheetCancel').onclick = () => { closeSheet(); resolve(false); };
    $('#sheetOk').onclick = () => { closeSheet(); resolve(true); };
  });
}

export function promptSheet({ title, value = '', placeholder = '', confirm = '保存', multiline = false, maxlength = 4000 }) {
  return new Promise(resolve => {
    const field = multiline
      ? `<textarea class="input area" id="promptValue" rows="5" placeholder="${escapeHtml(placeholder)}" maxlength="${maxlength}">${escapeHtml(value)}</textarea>`
      : `<input class="input" id="promptValue" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" maxlength="${maxlength}">`;
    openSheet(`
      ${sheetTitle(title)}
      <div class="sheet-form">${field}</div>
      <div class="sheet-actions">
        <button class="btn-ghost" id="promptCancel">取消</button>
        <button class="btn-ink" id="promptOk">${escapeHtml(confirm)}</button>
      </div>
    `);
    const input = $('#promptValue');
    setTimeout(() => input.focus(), 120);
    $('#promptCancel').onclick = () => { closeSheet(); resolve(null); };
    $('#promptOk').onclick = () => {
      const val = input.value;
      closeSheet();
      resolve(val);
    };
  });
}

export function actionSheet(title, actions) {
  const html = actions.map((a, i) => `
    <button class="action ${a.danger ? 'danger' : ''}" data-action="${i}">
      <span>${escapeHtml(a.label)}${a.sub ? `<span class="sub" style="display:block">${escapeHtml(a.sub)}</span>` : ''}</span>
      ${a.chevron === false ? '' : '<svg viewBox="0 0 24 24"><path d="M9.5 5.5L16 12l-6.5 6.5"/></svg>'}
    </button>
  `).join('');
  openSheet(`${sheetTitle(title)}<div class="action-list">${html}</div>`);
  actions.forEach((a, i) => {
    $(`[data-action="${i}"]`).onclick = () => {
      closeSheet();
      if (a.onClick) a.onClick();
    };
  });
}
