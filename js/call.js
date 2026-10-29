import { get, commit } from './state.js';
import { $, $$, setAvatar, uid, randInt } from './util.js';

let active = false;
let connected = false;
let startedAt = 0;
let tickId = null;
let resolveId = null;

const fmt = sec => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

function elapsed() {
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

function tick() {
  if (!active) return;
  $('#callTimer').textContent = fmt(elapsed());
}

function setStatus(text) {
  $('#callStatus').textContent = text;
}

function record(status, dur = 0) {
  const id = uid();
  commit(s => {
    s.messages.push({
      id,
      role: 'them',
      type: 'call',
      text: '视频通话',
      callKind: 'video',
      callStatus: status,
      callDur: dur,
      ts: Date.now(),
      seen: true,
      senderId: '',
    });
  });
}

function stopTimers() {
  clearInterval(tickId);
  clearTimeout(resolveId);
  tickId = null;
  resolveId = null;
}

function end() {
  active = false;
  connected = false;
  stopTimers();
  $('#callLayer').hidden = true;
}

export function startCall() {
  if (active) return;
  active = true;
  connected = false;
  startedAt = Date.now();

  const p = get().persona;
  setAvatar($('#callAvatar'), p.name, p.avatar);
  $('#callName').textContent = p.name || '';
  $('#callMute').classList.remove('muted');
  $('#callTimer').textContent = '00:00';
  setStatus('正在等待对方接听…');
  $('#callLayer').hidden = false;
  $('#callTimer').textContent = '00:00';

  stopTimers();
  tickId = setInterval(tick, 1000);
  resolveId = setTimeout(resolveOutcome, randInt(8000, 10000));
}

function resolveOutcome() {
  if (!active) return;
  const b = get().behavior;
  const answer = Number(b.callAnswer ?? 20);
  const hangup = Number(b.callHangup ?? 5);
  const roll = Math.random() * 100;

  if (roll < answer) {
    connected = true;
    setStatus('通话中');
    resolveId = setTimeout(() => {
      if (!active || !connected) return;
      connected = false;
      setStatus('通话结束');
      const sec = elapsed();
      record('ended', sec);
      setTimeout(end, 1200);
    }, randInt(12000, 20000));
    return;
  }

  if (roll < answer + hangup) {
    setStatus('对方已挂断');
    record('declined');
    setTimeout(end, 1500);
    return;
  }

  setStatus('对方暂时没有接听');
  record('missed');
  setTimeout(end, 1600);
}

function hangUp() {
  if (!active) return;
  const sec = elapsed();
  const wasConnected = connected;
  active = false;
  connected = false;
  stopTimers();
  if (wasConnected) {
    setStatus('通话结束');
    record('ended', sec);
  } else {
    setStatus('已取消');
  }
  setTimeout(() => { $('#callLayer').hidden = true; }, wasConnected ? 900 : 400);
}

export function hideCall() {
  if (!active && $('#callLayer').hidden) return;
  active = false;
  connected = false;
  stopTimers();
  $('#callLayer').hidden = true;
}

export function initCall() {
  $('#callHangup').onclick = hangUp;
  $$('#callLayer [data-call-hide]').forEach(btn => { btn.onclick = hangUp; });
  $('#callMute').onclick = () => $('#callMute').classList.toggle('muted');
}
