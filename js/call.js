import { get, commit } from './state.js?v=20261101BK';
import { $, setAvatar, uid, randInt, toast } from './util.js?v=20261101BK';

let active = false;
let connected = false;
let direction = 'out';     // 'out' = 我打给对方，'in' = 对方打给我
let startedAt = 0;
let tickId = null;
let resolveId = null;
let missId = null;
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
      callDir: direction,
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
  clearTimeout(missId);
  tickId = null;
  resolveId = null;
  missId = null;
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
  const pill = $('#callPill');
  pill.style.left = '';
  pill.style.top = '';
  pill.style.right = '';
}

function end() {
  active = false;
  connected = false;
  minimized = false;
  direction = 'out';
  stopTimers();
  $('#callLayer').hidden = true;
  $('#callPill').hidden = true;
  const card = $('.call-card');
  if (card) card.classList.remove('incoming', 'connected');
}

/* ---------- 我打给对方 ---------- */

export function startCall() {
  if (active) return;
  active = true;
  connected = false;
  direction = 'out';
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

  const card = $('.call-card');
  card.classList.remove('incoming', 'connected');
  $('#callAnswer').hidden = true;

  expand();

  stopTimers();
  tickId = setInterval(tick, 1000);
  resolveId = setTimeout(resolveOutcome, randInt(8000, 10000));
}

function resolveOutcome() {
  if (!active || direction !== 'out') return;
  const b = get().behavior;
  const answer = Number(b.callAnswer ?? 20);
  const hangup = Number(b.callHangup ?? 5);
  const roll = Math.random() * 100;

  if (roll < answer) {
    connectCall();
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

/* ---------- 对方打给我（来电） ---------- */

export function startIncomingCall() {
  if (active) return;
  active = true;
  connected = false;
  direction = 'in';
  minimized = false;
  startedAt = Date.now();

  const p = get().persona;
  setAvatar($('#callAvatar'), p.name, p.avatar);
  setAvatar($('#callPillAvatar'), p.name, p.avatar);
  $('#callName').textContent = p.name || '';
  $('#callPillName').textContent = p.name || '';
  $('#callTimer').textContent = '00:00';
  $('#callPillTimer').textContent = '00:00';
  setStatus(`${p.name || '对方'} 来电 请接听`);

  const card = $('.call-card');
  card.classList.add('incoming');
  card.classList.remove('connected');
  $('#callAnswer').hidden = false;

  expand();

  stopTimers();
  // 来电未接听的倒计时：20~30 秒后自动挂断，记为未接来电
  missId = setTimeout(missedCall, randInt(20000, 30000));
}

function missedCall() {
  if (!active || direction !== 'in' || connected) return;
  setStatus('未接听');
  record('missed');
  notify('未接来电');
  setTimeout(end, 1500);
}

function answerCall() {
  if (!active || direction !== 'in' || connected) return;
  clearTimeout(missId);
  missId = null;
  connectCall();
}

function connectCall() {
  connected = true;
  startedAt = Date.now();
  setStatus('正在通话…');
  $('#callTimer').textContent = '00:00';
  const card = $('.call-card');
  card.classList.add('connected');
  card.classList.remove('incoming');
  $('#callAnswer').hidden = true;
  stopTimers();
  tickId = setInterval(tick, 1000);
}

/* ---------- 挂断 / 拒绝 ---------- */

function hangUp() {
  if (!active) return;
  const sec = elapsed();
  const wasConnected = connected;

  // 来电未接通：我拒接
  if (direction === 'in' && !wasConnected) {
    setStatus('已拒绝');
    record('declined');
    notify('已拒绝来电');
    active = false;
    connected = false;
    minimized = false;
    stopTimers();
    setTimeout(end, 900);
    return;
  }

  if (wasConnected) record('ended', sec);

  active = false;
  connected = false;
  minimized = false;
  stopTimers();
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
  $('#callAnswer').onclick = answerCall;
  $('#callPillHangup').onclick = event => {
    event.stopPropagation();
    hangUp();
  };
  $('[data-call-min]').onclick = minimize;

  const pill = $('#callPill');
  let drag = null;       // { startX, startY, origLeft, origTop }
  let justDragged = false;

  function pointOf(e) {
    return e.touches && e.touches[0] ? e.touches[0]
      : e.changedTouches && e.changedTouches[0] ? e.changedTouches[0]
      : e;
  }

  function onDown(e) {
    if (e.target.closest('#callPillHangup')) return;
    const p = pointOf(e);
    const rect = pill.getBoundingClientRect();
    drag = {
      startX: p.clientX,
      startY: p.clientY,
      origLeft: rect.left,
      origTop: rect.top,
      moved: false,
    };
    pill.style.transition = 'none';
    if (e.cancelable) e.preventDefault();
  }

  function onMove(e) {
    if (!drag) return;
    const p = pointOf(e);
    const dx = p.clientX - drag.startX;
    const dy = p.clientY - drag.startY;
    if (!drag.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
      drag.moved = true;
      justDragged = true;
    }
    if (!drag.moved) return;
    const app = $('#app');
    const appRect = app.getBoundingClientRect();
    const w = pill.offsetWidth;
    const h = pill.offsetHeight;
    let left = drag.origLeft - appRect.left + dx;
    let top = drag.origTop - appRect.top + dy;
    left = Math.max(0, Math.min(left, appRect.width - w));
    top = Math.max(0, Math.min(top, appRect.height - h));
    pill.style.left = left + 'px';
    pill.style.top = top + 'px';
    pill.style.right = 'auto';
    if (e.cancelable) e.preventDefault();
  }

  function onUp() {
    if (!drag) return;
    pill.style.transition = '';
    if (drag.moved) {
      // snap to nearest horizontal edge within #app
      const app = $('#app');
      const appRect = app.getBoundingClientRect();
      const rect = pill.getBoundingClientRect();
      const centerX = rect.left - appRect.left + rect.width / 2;
      const targetX = centerX < appRect.width / 2
        ? 0
        : appRect.width - rect.width;
      pill.style.left = targetX + 'px';
      setTimeout(() => { justDragged = false; }, 0);
    } else {
      justDragged = false;
    }
    drag = null;
  }

  pill.addEventListener('touchstart', onDown, { passive: false });
  pill.addEventListener('touchmove', onMove, { passive: false });
  pill.addEventListener('touchend', onUp);
  pill.addEventListener('touchcancel', onUp);
  pill.addEventListener('mousedown', onDown);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);

  pill.addEventListener('click', () => {
    if (justDragged) return;
    if (active) expand();
  });
}
