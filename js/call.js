import { get, commit } from './state.js?v=20261030r';
import { $, setAvatar, uid, randInt, toast } from './util.js?v=20261030r';

let active = false;
let connected = false;
let startedAt = 0;
let tickId = null;
let resolveId = null;
let minimized = false;

const fmt = sec => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

function elapsed() {
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
}

function tick() {
  if (!active) return;
  const value = fmt(elapsed());
  $('#callTimer').textContent = value;
  $('#callPillTimer').textContent = value;
}

function setStatus(text) {
  $('#callStatus').textContent = text;
}

function notify(text) {
  if (minimized) toast(text);
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

function expand() {
  minimized = false;
  $('#callPill').hidden = true;
  $('#callLayer').hidden = false;
}

function minimize() {
  minimized = true;
  $('#callLayer').hidden = true;
  $('#callPill').hidden = false;
}

function end() {
  active = false;
  connected = false;
  minimized = false;
  stopTimers();
  $('#callLayer').hidden = true;
  $('#callPill').hidden = true;
}

export function startCall() {
  if (active) return;
  active = true;
  connected = false;
  minimized = false;
  startedAt = Date.now();

  const p = get().persona;
  setAvatar($('#callAvatar'), p.name, p.avatar);
  setAvatar($('#callPillAvatar'), p.name, p.avatar);
  $('#callName').textContent = p.name || '';
  $('#callPillName').textContent = p.name || '';
  $('#callTimer').textContent = '00:00';
  $('#callPillTimer').textContent = '00:00';
  setStatus('正在等待对方接听…');
  expand();

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
    setStatus('正在通话…');
    resolveId = setTimeout(() => {
      if (!active || !connected) return;
      connected = false;
      setStatus('通话结束');
      const sec = elapsed();
      record('ended', sec);
      notify(`通话结束 · ${fmt(sec)}`);
      setTimeout(end, 1200);
    }, randInt(12000, 20000));
    return;
  }

  if (roll < answer + hangup) {
    setStatus('对方已挂断');
    record('declined');
    notify('对方已挂断');
    setTimeout(end, 1500);
    return;
  }

  setStatus('对方暂时没有接听');
  record('missed');
  notify('对方暂时没有接听');
  setTimeout(end, 1600);
}

function hangUp() {
  if (!active) return;
  const sec = elapsed();
  const wasConnected = connected;
  active = false;
  connected = false;
  minimized = false;
  stopTimers();
  if (wasConnected) record('ended', sec);
  end();
}

export function hideCall() {
  if (active) {
    if (!$('#callLayer').hidden) minimize();
    return;
  }
  $('#callLayer').hidden = true;
  $('#callPill').hidden = true;
}

export function initCall() {
  $('#callHangup').onclick = hangUp;
  $('#callPillHangup').onclick = event => {
    event.stopPropagation();
    hangUp();
  };
  $('[data-call-min]').onclick = minimize;
  $('#callPill').addEventListener('click', () => {
    if (active) expand();
  });
}
