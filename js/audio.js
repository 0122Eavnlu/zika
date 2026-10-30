import { get } from './state.js?v=20261030m';
import { pick } from './util.js?v=20261030m';

let ctx = null;

function context() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, start, dur, gainValue, type = 'sine', glideTo = null) {
  const ac = context();
  if (!ac) return;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ac.currentTime + start);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, ac.currentTime + start + dur);
  gain.gain.setValueAtTime(0, ac.currentTime + start);
  gain.gain.linearRampToValueAtTime(gainValue, ac.currentTime + start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(ac.currentTime + start);
  osc.stop(ac.currentTime + start + dur + 0.02);
}

export function playPreset(kind) {
  const ac = context();
  if (!ac) return;
  switch (kind) {
    case 'chime':
      tone(1174.7, 0, .9, .16);
      tone(1568, .03, .75, .09, 'sine');
      tone(2349.3, .06, .55, .05, 'sine');
      break;
    case 'drop':
      tone(196, 0, .32, .2, 'sine', 82);
      tone(392, .02, .22, .06, 'triangle', 164);
      break;
    case 'tap':
    default:
      tone(523, 0, .09, .14, 'triangle', 392);
      tone(880, .015, .07, .06, 'sine', 660);
      break;
  }
}

export function playItem(item) {
  if (!item) return;
  if (item.url) {
    const audio = new Audio(item.url);
    audio.volume = .9;
    audio.play().catch(() => {});
    return;
  }
  playPreset(item.preset || 'tap');
}

export function playSound() {
  const b = get().behavior;
  if (!b.sound) return;
  const list = (b.sounds || []).filter(s => s && (s.url || s.preset));
  if (!list.length) return;
  let item;
  if (b.soundRandom) item = pick(list);
  else item = list.find(s => s.id === b.soundDefault) || list[0];
  playItem(item);
}
