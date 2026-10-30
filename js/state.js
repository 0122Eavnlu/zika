import { uid, toast } from './util.js';

const KEY = 'zika.state.v1';

function seeds() {
  const g1 = uid(), g2 = uid(), g3 = uid();
  return {
    cards: {
      groups: [
        { id: g1, name: '问候', blocked: false },
        { id: g2, name: '日常', blocked: false },
        { id: g3, name: '状态', blocked: false },
      ],
      items: [
        { id: uid(), text: '在的。', groupId: g1, blocked: false, at: Date.now() - 60000 },
        { id: uid(), text: '刚看到消息。', groupId: g1, blocked: false, at: Date.now() - 50000 },
        { id: uid(), text: '今天还好吗？', groupId: g1, blocked: false, at: Date.now() - 40000 },
        { id: uid(), text: '别熬太晚。', groupId: g2, blocked: false, at: Date.now() - 30000 },
        { id: uid(), text: '晚点再聊。', groupId: g2, blocked: false, at: Date.now() - 20000 },
        { id: uid(), text: '寻找灵魂伴侣', groupId: g3, blocked: false, at: Date.now() - 12000 },
        { id: uid(), text: '不在线，勿念', groupId: g3, blocked: false, at: Date.now() - 8000 },
        { id: uid(), text: '今天也没有睡好', groupId: g3, blocked: false, at: Date.now() - 4000 },
      ],
    },
  };
}

function defaults(withSeed = true) {
  const seed = withSeed ? seeds() : { cards: { groups: [], items: [] } };
  const members = [
    { id: uid(), name: '阿墨', avatar: '' },
    { id: uid(), name: '小满', avatar: '' },
    { id: uid(), name: '迟野', avatar: '' },
  ];
  return {
    version: 1,
    persona: { name: '阿墨', avatar: '', status: '寻找灵魂伴侣', statusAt: 0, statusWait: 0, showName: true, showAvatar: true },
    me: { name: '我', avatar: '', status: '' },
    anniversary: { enabled: true, date: '', text: '我们在一起' },
    ui: {
      theme: 'auto',
      fontSize: 16,
      avatarSize: 28,
      frost: 65,
      font: '',
      bubbleCss: '',
      chatBg: '',
      homeBg: '',
      timeOn: true,
      readOn: true,
      readStyle: 'text',
      typingText: '正在输入',
    },
    behavior: {
      delayMin: 3,
      delayMax: 12,
      proactive: false,
      proactiveMin: 15,
      proactiveMax: 45,
      readSkip: false,
      readSkipRate: 0.2,
      quote: true,
      chain: false,
      notify: false,
      sound: true,
      soundRandom: true,
      soundDefault: 's1',
      sounds: [
        { id: 's1', name: '轻叩', preset: 'tap' },
        { id: 's2', name: '风铃', preset: 'chime' },
        { id: 's3', name: '墨滴', preset: 'drop' },
      ],
      stickerChance: 5,
      emojiChance: 10,
      callChance: 20,
      callAnswer: 20,
      callHangup: 5,
      momentChance: 70,
      momentShotChance: 25,
      momentReplyChance: 90,
      momentReplyDelayMin: 30,
      momentReplyDelayMax: 300,
      momentPostGapMin: 20,
      momentPostGapMax: 180,
    },
    group: { enabled: false, members },
    cards: seed.cards,
    nudge: {
      enabled: true,
      chance: 30,
      items: [{ id: uid(), text: '拍了拍你', at: Date.now() }],
    },
    stickers: [],
    moments: { bg: '', posts: [] },
    music: { tracks: [], mode: 'sequence', together: false, togetherCount: 0, current: 0, apiBase: '', cookie: '', uid: '', nickname: '' },
    messages: [],
  };
}

function deepMerge(base, extra) {
  if (Array.isArray(base)) {
    return Array.isArray(extra) ? extra.map(v => (v && typeof v === 'object' ? deepMerge({}, v) : v)) : base;
  }
  if (base && typeof base === 'object') {
    const out = { ...base };
    if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
      for (const k of Object.keys(extra)) {
        if (k in base) out[k] = deepMerge(base[k], extra[k]);
        else if (extra[k] !== undefined) out[k] = extra[k];
      }
    }
    return out;
  }
  return extra !== undefined ? extra : base;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults(true);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaults(true);
    return deepMerge(defaults(false), parsed);
  } catch {
    return defaults(true);
  }
}

let state = load();
const listeners = new Set();

export function get() { return state; }
export const store = { get: () => state };

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let quotaWarned = false;
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    if (!quotaWarned) {
      quotaWarned = true;
      toast('本地空间不足，请到「设定 → 存储空间」清理');
    }
    return false;
  }
}

export function commit(mutator) {
  if (mutator) mutator(state);
  save();
  listeners.forEach(fn => fn(state));
}

export function getPath(path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), state);
}

export function setPath(path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  let obj = state;
  for (const k of keys) {
    if (!obj[k] || typeof obj[k] !== 'object') obj[k] = {};
    obj = obj[k];
  }
  obj[last] = value;
}

export function exportState() {
  return {
    app: 'zika',
    version: 1,
    exportedAt: new Date().toISOString(),
    state,
  };
}

export function importState(parsed) {
  const incoming = parsed?.state && typeof parsed.state === 'object' ? parsed.state : (parsed?.cards ? parsed : null);
  if (!incoming) throw new Error('bad-file');
  state = deepMerge(defaults(false), incoming);
  state.version = 1;
  save();
  listeners.forEach(fn => fn(state));
}

export function resetState(keepPersona = false) {
  const persona = keepPersona ? { ...state.persona } : null;
  state = defaults(false);
  if (persona) state.persona = persona;
  save();
  listeners.forEach(fn => fn(state));
}
