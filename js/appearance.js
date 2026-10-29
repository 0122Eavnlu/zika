import { get, commit, subscribe } from './state.js';
import { $, pickFile, compressImage, toast } from './util.js';

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
        face.load().then(f => document.fonts.add(f)).catch(() => {});
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
}

function syncBg() {
  const bg = get().ui.chatBg;
  const preview = $('#bgPreview');
  preview.style.backgroundImage = bg ? `url("${bg}")` : '';
  preview.textContent = bg ? '' : '无';
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

  let cssTimer = null;
  $('#bubbleCss').addEventListener('input', event => {
    const value = event.target.value;
    clearTimeout(cssTimer);
    cssTimer = setTimeout(() => commit(s => { s.ui.bubbleCss = value; }), 700);
  });

  $('#bgPick').onclick = async () => {
    const file = await pickFile('image/*');
    if (!file) return;
    try {
      const data = await compressImage(file, 1600, .84);
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
