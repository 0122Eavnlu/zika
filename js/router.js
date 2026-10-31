/* 单例：避免因版本号不一致重复加载导致两份路由状态，出现「返回键点了没反应」。 */
const shared = window.__zikaRouter__ || (window.__zikaRouter__ = { hooks: {}, current: null });
const hooks = shared.hooks;

export function register(name, hook) {
  hooks[name] = hook || {};
}

export function isOpen(name) {
  return shared.current === name;
}

export function currentScreen() {
  return shared.current;
}

export function open(name) {
  if (shared.current === name) return;
  const app = document.getElementById('app');
  const prev = shared.current ? document.getElementById(`screen-${shared.current}`) : null;
  if (prev) {
    prev.classList.remove('active');
    prev.setAttribute('aria-hidden', 'true');
  }
  shared.current = name;
  app.classList.add('app-open');
  const next = document.getElementById(`screen-${name}`);
  if (next) {
    next.classList.add('active');
    next.setAttribute('aria-hidden', 'false');
  }
  hooks[name]?.onOpen?.();
}

export function close() {
  const activeEls = Array.from(document.querySelectorAll('.screen.active'));
  const name = shared.current || (activeEls[0]?.id || '').replace(/^screen-/, '');
  if (!name && !activeEls.length) return;
  if (name) hooks[name]?.onClose?.();
  // 兜底：无论记录是否对得上，把当前所有可见屏幕都关掉，返回键不会失效
  activeEls.forEach(el => {
    el.classList.remove('active');
    el.setAttribute('aria-hidden', 'true');
  });
  const el = name ? document.getElementById(`screen-${name}`) : null;
  if (el) {
    el.classList.remove('active');
    el.setAttribute('aria-hidden', 'true');
  }
  shared.current = null;
  document.getElementById('app').classList.remove('app-open');
}

export function bindBackButtons() {
  document.querySelectorAll('[data-close]').forEach(btn => {
    if (btn.__zikaBackBound) return;
    btn.__zikaBackBound = true;
    btn.addEventListener('click', () => close());
  });
}
