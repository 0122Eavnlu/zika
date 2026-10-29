const hooks = {};
let current = null;

export function register(name, hook) {
  hooks[name] = hook || {};
}

export function isOpen(name) {
  return current === name;
}

export function currentScreen() {
  return current;
}

export function open(name) {
  if (current === name) return;
  const app = document.getElementById('app');
  const prev = current ? document.getElementById(`screen-${current}`) : null;
  if (prev) {
    prev.classList.remove('active');
    prev.setAttribute('aria-hidden', 'true');
  }
  current = name;
  app.classList.add('app-open');
  const next = document.getElementById(`screen-${name}`);
  if (next) {
    next.classList.add('active');
    next.setAttribute('aria-hidden', 'false');
  }
  hooks[name]?.onOpen?.();
}

export function close() {
  if (!current) return;
  const el = document.getElementById(`screen-${current}`);
  if (el) {
    el.classList.remove('active');
    el.setAttribute('aria-hidden', 'true');
  }
  hooks[current]?.onClose?.();
  current = null;
  document.getElementById('app').classList.remove('app-open');
}

export function bindBackButtons() {
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => close());
  });
}
