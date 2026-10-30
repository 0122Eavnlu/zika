import { get, commit, subscribe, getPath, setPath, exportState, importState, resetState } from './state.js';
import { $, $$, escapeHtml, uid, toast, downloadBlob, pickFile, compressImage, setAvatar, getInputNumber } from './util.js';
import { openSheet, closeSheet, sheetTitle, confirmSheet, promptSheet } from './ui.js';
import { playItem } from './audio.js';
import * as router from './router.js';
import { openStatusSheet } from './status.js';
import { openMeSheet } from './chat.js';

/* ---------- 通用控件 ---------- */

function bindControls() {
  $$('[data-switch]').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.switch;
      commit(s => setPath(key, !getPath(key)));
    });
  });

  $$('[data-select]').forEach(el => {
    el.addEventListener('change', () => {
      commit(s => setPath(el.dataset.select, el.value));
    });
  });

  $$('[data-input]').forEach(el => {
    el.addEventListener('change', () => {
      const key = el.dataset.input;
      const current = getPath(key);
      let value;
      if (typeof current === 'number') {
        const min = el.min === '' ? -Infinity : Number(el.min);
        const max = el.max === '' ? Infinity : Number(el.max);
        value = getInputNumber(el, current, min, max);
        el.value = String(value);
      } else {
        value = el.value;
      }
      commit(s => setPath(key, value));
    });
  });
}

function syncControls() {
  $$('[data-switch]').forEach(el => {
    el.classList.toggle('on', Boolean(getPath(el.dataset.switch)));
  });
  $$('[data-select]').forEach(el => {
    if (document.activeElement !== el) el.value = String(getPath(el.dataset.select) ?? '');
  });
  $$('[data-input]').forEach(el => {
    if (document.activeElement !== el) {
      const value = getPath(el.dataset.input);
      if (typeof value === 'number') el.value = String(value);
      else el.value = value ?? '';
    }
  });

  const name = $('#personaName');
  if (document.activeElement !== name) name.value = get().persona.name || '';
  const meName = $('#meName');
  if (document.activeElement !== meName) meName.value = get().me.name || '';

  const statusText = $('#personaStatusText');
  if (statusText) statusText.textContent = get().persona.status || '添加状态';
  const meStatusText = $('#meStatusText');
  if (meStatusText) meStatusText.textContent = get().me.status || '添加状态';

  const typing = $('#typingText');
  if (document.activeElement !== typing) typing.value = get().ui.typingText || '';

  const rate = get().behavior.readSkipRate;
  $('#readSkipVal').textContent = `${Math.round(rate * 100)}%`;
  const rateInput = $('#readSkipRate');
  if (document.activeElement !== rateInput) rateInput.value = String(Math.round(rate * 100));

  $('#notifySwitch').classList.toggle('on', Boolean(get().behavior.notify));
}

/* ---------- 人物 ---------- */

async function uploadPersonaAvatar() {
  const file = await pickFile('image/*');
  if (!file) return;
  try {
    const data = await compressImage(file, 320, .85);
    commit(s => { s.persona.avatar = data; });
    toast('已更换头像');
  } catch {
    toast('图片处理失败');
  }
}

function renderPersona() {
  const p = get().persona;
  setAvatar($('#personaAvatarView'), p.name, p.avatar);
  const me = get().me;
  setAvatar($('#meAvatarView'), me.name, me.avatar);
}

/* ---------- 群员 ---------- */

function renderMembers() {
  const s = get();
  const list = $('#memberList');
  if (!s.group.members.length) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML = s.group.members.map(m => `
    <div class="member-item" data-id="${m.id}">
      <button class="avatar-btn" data-avatar="${m.id}" aria-label="头像">
        <span class="avatar sm" data-avatar-view="${m.id}"></span>
      </button>
      <input class="m-name" data-name="${m.id}" value="${escapeHtml(m.name)}" maxlength="12" placeholder="名称">
      <button class="m-remove" data-remove="${m.id}">移除</button>
    </div>
  `).join('');

  $$('.member-item .avatar[data-avatar-view]').forEach(el => {
    const m = s.group.members.find(x => x.id === el.dataset.avatarView);
    if (m) setAvatar(el, m.name, m.avatar);
  });

  $$('.member-item .avatar-btn').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.avatar;
      const file = await pickFile('image/*');
      if (!file) return;
      try {
        const data = await compressImage(file, 320, .85);
        commit(st => {
          const m = st.group.members.find(x => x.id === id);
          if (m) m.avatar = data;
        });
      } catch { toast('图片处理失败'); }
    };
  });

  $$('.member-item .m-name').forEach(input => {
    input.addEventListener('change', () => {
      const id = input.dataset.name;
      const value = input.value.trim();
      if (!value) { input.value = get().group.members.find(m => m.id === id)?.name || ''; return; }
      commit(s2 => { const m = s2.group.members.find(x => x.id === id); if (m) m.name = value; });
    });
  });

  $$('.member-item .m-remove').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.remove;
      commit(s2 => { s2.group.members = s2.group.members.filter(m => m.id !== id); });
    };
  });
}

/* ---------- 音效 ---------- */

function renderSounds() {
  const b = get().behavior;
  const list = $('#soundList');
  list.innerHTML = (b.sounds || []).map(item => `
    <div class="sound-item ${item.id === b.soundDefault ? 'default' : ''}" data-id="${item.id}">
      <span class="sound-dot"></span>
      <button class="s-name ${item.url ? 'custom' : ''}" data-name="${item.id}">${escapeHtml(item.name)}</button>
      <button class="mini-btn" data-play="${item.id}">试听</button>
      <button class="mini-btn danger" data-del="${item.id}">删</button>
    </div>
  `).join('');

  $$('.sound-item [data-name]').forEach(btn => {
    btn.onclick = () => commit(s => { s.behavior.soundDefault = btn.dataset.name; });
  });
  $$('.sound-item [data-play]').forEach(btn => {
    btn.onclick = () => {
      const item = get().behavior.sounds.find(s => s.id === btn.dataset.play);
      playItem(item);
    };
  });
  $$('.sound-item [data-del]').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.del;
      commit(s => {
        s.behavior.sounds = s.behavior.sounds.filter(x => x.id !== id);
        if (s.behavior.soundDefault === id) s.behavior.soundDefault = s.behavior.sounds[0]?.id || '';
      });
    };
  });
}

async function addSound() {
  const file = await pickFile('audio/*');
  if (!file) return;
  let dataUrl;
  try {
    dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  } catch {
    toast('读取失败');
    return;
  }
  const defaultName = file.name.replace(/\.\w+$/, '');
  const name = await promptSheet({ title: '音效名称', value: defaultName, placeholder: '名称' });
  if (!name || !name.trim()) return;
  const id = uid();
  commit(s => {
    s.behavior.sounds.push({ id, name: name.trim(), url: dataUrl });
  });
  toast('已添加');
}

/* ---------- 通知 ---------- */

function bindNotify() {
  $('#notifySwitch').onclick = async () => {
    if (get().behavior.notify) {
      commit(s => { s.behavior.notify = false; });
      return;
    }
    if (!('Notification' in window)) { toast('当前环境不支持通知'); return; }
    if (Notification.permission === 'granted') {
      commit(s => { s.behavior.notify = true; });
      return;
    }
    if (Notification.permission === 'denied') {
      toast('通知权限已被拒绝');
      return;
    }
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      commit(s => { s.behavior.notify = true; });
      toast('已开启通知');
    } else {
      toast('未获得通知权限');
    }
  };
}

/* ---------- 数据 ---------- */

function bindData() {
  $('#exportAll').onclick = () => {
    downloadBlob(`字卡备份-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(exportState(), null, 2), 'application/json');
    toast('已导出');
  };

  $('#importAll').onclick = async () => {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    try {
      const text = await file.text();
      importState(JSON.parse(text));
      toast('已导入');
    } catch {
      toast('文件格式不正确');
    }
  };

  $('#resetAll').onclick = async () => {
    const ok = await confirmSheet({
      title: '重置所有数据',
      text: '字卡、消息、外观与设定将全部清空',
      confirm: '重置',
      danger: true,
    });
    if (!ok) return;
    resetState(false);
    toast('已重置');
  };
}

/* ---------- 存储空间 ---------- */

function sizeOf(val) {
  try { return new Blob([JSON.stringify(val ?? '')]).size; } catch { return 0; }
}
function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}

function storageSections() {
  const s = get();
  return [
    { key: 'messages', label: '聊天记录', size: sizeOf(s.messages), clear: () => commit(st => { st.messages = []; }) },
    { key: 'stickers', label: '表情包', size: sizeOf(s.stickers), clear: () => commit(st => { st.stickers = []; }) },
    { key: 'cards', label: '字卡库', size: sizeOf(s.cards.items), clear: () => commit(st => { st.cards.items = []; }) },
    { key: 'moments', label: '朋友圈', size: sizeOf(s.moments.posts), clear: () => commit(st => { st.moments.posts = []; }) },
    { key: 'music', label: '音乐', size: sizeOf(s.music.tracks), clear: () => commit(st => { st.music.tracks = []; }) },
    { key: 'bgs', label: '背景 / 头像', size: sizeOf({ home: s.ui.homeBg, chat: s.ui.chatBg, moments: s.moments.bg, me: s.me.avatar, persona: s.persona.avatar }), clear: () => commit(st => { st.ui.homeBg = ''; st.ui.chatBg = ''; st.moments.bg = ''; st.me.avatar = ''; st.persona.avatar = ''; }) },
  ];
}

function openStorageSheet() {
  const render = () => {
    const sections = storageSections();
    const total = sections.reduce((a, b) => a + b.size, 0);
    const rows = sections.map(sec => `
      <div class="storage-row" data-key="${sec.key}">
        <div class="storage-info">
          <span class="storage-label">${escapeHtml(sec.label)}</span>
          <span class="storage-size">${fmtSize(sec.size)}</span>
        </div>
        <button class="ghost-btn tiny danger-text" data-clear="${sec.key}">清空</button>
      </div>`).join('');
    const body = document.querySelector('#storageBody');
    if (body) {
      body.innerHTML = `
        <div class="storage-total">占用 ${fmtSize(total)}</div>
        ${rows}
        <p class="storage-hint">表情包和背景图通常占空间最大，可优先清理。</p>`;
      body.querySelectorAll('[data-clear]').forEach(btn => {
        btn.onclick = async () => {
          const sec = sections.find(x => x.key === btn.dataset.clear);
          if (!sec) return;
          const ok = await confirmSheet({ title: `清空${sec.label}`, text: `将删除所有${sec.label}，无法恢复`, confirm: '清空', danger: true });
          if (!ok) return;
          sec.clear();
          toast(`已清空${sec.label}`);
          render();
        };
      });
    }
  };
  openSheet(`
    ${sheetTitle('存储空间')}
    <div id="storageBody"></div>
  `);
  render();
}

/* ---------- 初始化 ---------- */

export function initSettings() {
  bindControls();
  bindNotify();
  bindData();

  $('#personaAvatar').onclick = uploadPersonaAvatar;
  $('#personaStatus').onclick = openStatusSheet;
  $('#meAvatar').onclick = openMeSheet;
  $('#meStatus').onclick = openMeSheet;
  $('#meName').addEventListener('change', event => {
    const value = event.target.value.trim();
    commit(s => { s.me.name = value || '我'; });
  });
  $('#personaName').addEventListener('change', event => {
    const value = event.target.value.trim();
    commit(s => { s.persona.name = value || '阿墨'; });
  });

  $('#typingText').addEventListener('change', event => {
    commit(s => { s.ui.typingText = event.target.value.trim() || '正在输入'; });
  });

  $('#readSkipRate').addEventListener('input', event => {
    const value = Number(event.target.value) / 100;
    $('#readSkipVal').textContent = `${Math.round(value * 100)}%`;
    commit(s => { s.behavior.readSkipRate = value; });
  });

  $('#soundAdd').onclick = addSound;
  $('#storageBtn').onclick = openStorageSheet;
  $('#memberAdd').onclick = () => {
    commit(s => {
      const count = s.group.members.length + 1;
      s.group.members.push({ id: uid(), name: `成员${count}`, avatar: '' });
    });
  };

  subscribe(() => {
    syncControls();
    if (router.isOpen('settings')) {
      renderPersona();
      renderMembers();
      renderSounds();
    }
  });

  router.register('settings', { onOpen: () => {
    syncControls();
    renderPersona();
    renderMembers();
    renderSounds();
  } });

  syncControls();
  renderPersona();
  renderMembers();
  renderSounds();
}
