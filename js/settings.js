import { get, commit, subscribe, getPath, setPath, exportState, importState, resetState } from './state.js';
import { $, $$, escapeHtml, uid, toast, downloadBlob, pickFile, compressImage, setAvatar, getInputNumber } from './util.js';
import { openSheet, closeSheet, sheetTitle, confirmSheet, promptSheet } from './ui.js';
import { playItem } from './audio.js';
import * as router from './router.js';

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

/* ---------- 初始化 ---------- */

export function initSettings() {
  bindControls();
  bindNotify();
  bindData();

  $('#personaAvatar').onclick = uploadPersonaAvatar;
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
