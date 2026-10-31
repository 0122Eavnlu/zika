import { get } from './state.js?v=20261031C';
import { toast } from './util.js?v=20261031C';

const DEFAULTS = {
  provider: 'minimax',
  apiKey: '',
  voiceId: '',
  model: 'speech-02-hd',
  apiBase: 'https://api.minimax.chat',
  groupId: '',
  speed: 1,
  interval: 350,
};

export function ttsConfig() {
  return { ...DEFAULTS, ...(get().tts || {}) };
}

export function hasTTS() {
  const c = ttsConfig();
  return Boolean(c.apiKey && c.voiceId);
}

function hexToBytes(hex) {
  const clean = String(hex || '').replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

export async function synthesize(text, config = ttsConfig()) {
  const t = String(text || '').trim();
  if (!t) throw new Error('没有文字');
  if (!config.apiKey) throw new Error('还没有填 API Key');
  if (!config.voiceId) throw new Error('还没有填音色 ID');
  const base = (config.apiBase || DEFAULTS.apiBase).replace(/\/+$/, '');
  const url = `${base}/v1/t2a_v2${config.groupId ? `?GroupId=${encodeURIComponent(config.groupId)}` : ''}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model || DEFAULTS.model,
      text: t,
      stream: false,
      voice_setting: {
        voice_id: config.voiceId,
        speed: Number(config.speed) || 1,
        vol: 1,
        pitch: 0,
      },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const code = json?.base_resp?.status_code;
  if (code) throw new Error(json?.base_resp?.status_msg || `错误 ${code}`);
  const hex = json?.data?.audio;
  if (!hex) throw new Error('接口没有返回音频');
  return new Blob([hexToBytes(hex)], { type: 'audio/mpeg' });
}

let current = null;

export async function speak(text, { silent = false } = {}) {
  const t = String(text || '').trim();
  if (!t) return false;
  try {
    const blob = await synthesize(t);
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    current = audio;
    audio.addEventListener('ended', () => {
      URL.revokeObjectURL(url);
      if (current === audio) current = null;
    });
    await audio.play();
    return true;
  } catch (error) {
    if (!silent) toast(`语音合成失败：${error.message}`);
    return false;
  }
}

export function stopSpeak() {
  if (!current) return;
  try { current.pause(); } catch {}
  current = null;
}

/* 克隆音色：把本地录音上传到 MiniMax，返回新的音色 ID */
export async function cloneVoice(file, voiceId, config = ttsConfig()) {
  if (!config.apiKey) throw new Error('还没有填 API Key');
  const base = (config.apiBase || DEFAULTS.apiBase).replace(/\/+$/, '');
  const url = `${base}/v1/voice_clone${config.groupId ? `?GroupId=${encodeURIComponent(config.groupId)}` : ''}`;
  const form = new FormData();
  form.append('voice_id', voiceId);
  form.append('file', file, file.name || 'voice.mp3');
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json?.base_resp?.status_code) throw new Error(json.base_resp.status_msg || '克隆失败');
  return json?.voice_id || voiceId;
}

export function voiceRateChance() {
  const rate = ttsConfig().voiceRate;
  if (rate === '总是') return 1;
  if (rate === '经常') return 0.4;
  return 0.15;
}
