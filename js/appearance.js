import { get, commit, subscribe } from './state.js?v=20261031b';
import { $, pickFile, compressImage, toast } from './util.js?v=20261031b';

const root = document.documentElement;
let loadedFontUrl = '';

function resolvedTheme() {
  const mode = get().ui.theme;
  if (mode === 'light' || mode === 'dark') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyVisuals() {
  const ui = get().ui;
  root.dataset.theme = resolvedTheme();

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolvedTheme() === 'dark' ? '#0c0c0d' : '#efece5');

  root.style.setProperty('--fs', String(ui.fontSize));
  root.style.setProperty('--avatar-size', `${Number(ui.avatarSize) || 28}px`);
  const frost = Math.min(100, Math.max(0, Number(ui.frost ?? 65)));
  root.style.setProperty('--frost-alpha', `${Math.max(0, 100 - frost * 1.15).toFixed(0)}%`);
  root.style.setProperty('--frost-blur', `${(frost * .12).toFixed(1)}px`);

  const font = (ui.font || '').trim();
  if (!font) {
    root.style.removeProperty('--serif');
    loadedFontUrl = '';
  } else if (/^https?:\/\//i.test(font) && /\.(woff2?|ttf|otf|eot)(\?.*)?$/i.test(font)) {
    root.style.setProperty('--serif', '"ZikaUserFont", "Songti SC", "STSong", serif');
    if (loadedFontUrl !== font) {
      loadedFontUrl = font;
      try {
        const face = new FontFace('ZikaUserFont', `url("${font}")`);
        face.load()
          .then(f => document.fonts.add(f))
          .catch(() => toast('字体加载失败：该地址未开放跨域，换一个字体地址'));
      } catch {}
    }
  } else {
    const stack = font.includes(',') ? font : `${font}, "Songti SC", "STSong", serif`;
    root.style.setProperty('--serif', stack);
  }

  const bubbleStyle = $('#bubble-style');
  if (bubbleStyle) bubbleStyle.textContent = ui.bubbleCss || '';
}

function syncThemeButtons() {
  const mode = get().ui.theme;
  document.querySelectorAll('#themeSeg button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeSet === mode);
  });
}

function syncFont() {
  const font = get().ui.font || '';
  const preset = $('#fontPreset');
  const options = [...preset.options].map(o => o.value);
  if (options.includes(font)) preset.value = font;
  else preset.value = font ? '__custom' : '';
  const custom = $('#fontCustom');
  if (document.activeElement !== custom) custom.value = font;
}

function syncSlider() {
  $('#fontSize').value = get().ui.fontSize;
  $('#fontSizeVal').textContent = String(get().ui.fontSize);
  $('#avatarSize').value = get().ui.avatarSize;
  $('#avatarSizeVal').textContent = String(get().ui.avatarSize);
  $('#frostLevel').value = get().ui.frost;
  $('#frostLevelVal').textContent = String(get().ui.frost);
}

function syncBg() {
  const bg = get().ui.chatBg;
  const preview = $('#bgPreview');
  preview.style.backgroundImage = bg ? `url("${bg}")` : '';
  preview.textContent = bg ? '' : '无';
  const homeBg = get().ui.homeBg;
  const homePreview = $('#homeBgPreview');
  homePreview.style.backgroundImage = homeBg ? `url("${homeBg}")` : '';
  homePreview.textContent = homeBg ? '' : '无';
}

function syncCss() {
  const field = $('#bubbleCss');
  if (document.activeElement !== field) field.value = get().ui.bubbleCss || '';
}

export function initAppearance() {
  syncThemeButtons();
  syncFont();
  syncSlider();
  syncBg();
  syncCss();

  document.querySelectorAll('#themeSeg button').forEach(btn => {
    btn.onclick = () => commit(s => { s.ui.theme = btn.dataset.themeSet; });
  });

  $('#fontPreset').onchange = event => {
    if (event.target.value === '__custom') return;
    commit(s => { s.ui.font = event.target.value; });
  };

  let fontTimer = null;
  $('#fontCustom').addEventListener('input', event => {
    const value = event.target.value;
    clearTimeout(fontTimer);
    fontTimer = setTimeout(() => commit(s => { s.ui.font = value.trim(); }), 700);
  });

  $('#fontSize').addEventListener('input', event => {
    const value = Number(event.target.value);
    $('#fontSizeVal').textContent = String(value);
    commit(s => { s.ui.fontSize = value; });
  });

  $('#avatarSize').addEventListener('input', event => {
    const value = Number(event.target.value);
    $('#avatarSizeVal').textContent = String(value);
    commit(s => { s.ui.avatarSize = value; });
  });

  $('#frostLevel').addEventListener('input', event => {
    const value = Number(event.target.value);
    $('#frostLevelVal').textContent = String(value);
    commit(s => { s.ui.frost = value; });
  });

  let cssTimer = null;
  $('#bubbleCss').addEventListener('input', event => {
    const value = event.target.value;
    clearTimeout(cssTimer);
    cssTimer = setTimeout(() => commit(s => { s.ui.bubbleCss = value; }), 700);
  });

  $('#bubbleCssSave').onclick = () => {
    clearTimeout(cssTimer);
    const value = $('#bubbleCss').value;
    if (/^https?:\/\/\S+$/.test(value.trim())) {
      toast('这里要填 CSS 代码，不是链接');
      return;
    }
    commit(s => { s.ui.bubbleCss = value; });
    applyVisuals();
    toast('气泡样式已应用');
  };

  $('#bubbleCssClear').onclick = () => {
    clearTimeout(cssTimer);
    $('#bubbleCss').value = '';
    commit(s => { s.ui.bubbleCss = ''; });
    applyVisuals();
    toast('已清除气泡样式');
  };

  $('#bgPick').onclick = async () => {
    const file = await pickFile('image/*');
    if (!file) return;
    try {
      const data = await compressImage(file, 1280, .8);
      commit(s => { s.ui.chatBg = data; });
      toast('已设置背景');
    } catch {
      toast('图片处理失败');
    }
  };

  $('#bgClear').onclick = () => {
    commit(s => { s.ui.chatBg = ''; });
    toast('已移除');
  };

  $('#homeBgPick').onclick = async () => {
    const file = await pickFile('image/*');
    if (!file) return;
    try {
      const data = await compressImage(file, 1280, .8);
      commit(s => { s.ui.homeBg = data; });
      toast('已设置主屏壁纸');
    } catch {
      toast('图片处理失败');
    }
  };

  $('#homeBgClear').onclick = () => {
    commit(s => { s.ui.homeBg = ''; });
    toast('已移除');
  };

  subscribe(() => {
    applyVisuals();
    syncThemeButtons();
    syncFont();
    syncSlider();
    syncBg();
    syncCss();
  });

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (get().ui.theme === 'auto') applyVisuals();
  });

  applyVisuals();
}
