import { uid, toast } from './util.js?v=20261101BL';

const KEY = 'zika.state.v1';
const AT_KEY = 'zika.state.v1.at';
const VERSION = 4;

/* 大容量存储：localStorage 只有 5MB，图片一多就写不进去。
   这里用 IndexedDB（通常几百 MB）做主力持久化，localStorage 仅作快速快照。
   - 每次改动：先防抖（280ms）合并写盘，不再每次 commit 都同步序列化整个 state；
   - localStorage 写失败时自动只写 IndexedDB，不再弹「空间不足」；
   - 启动时若 IndexedDB 的记录比 localStorage 新，就用 IndexedDB 的数据。 */
const DB_NAME = 'zika-db';
const DB_STORE = 'state';
const DB_KEY = 'main';

let dbPromise = null;
let saveTimer = null;
let touched = false;
let localOk = true;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function idbRead() {
  const db = await openDb();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(DB_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbWrite(rec) {
  const db = await openDb();
  if (!db) return false;
  try {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(rec, DB_KEY);
    return true;
  } catch {
    return false;
  }
}

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
    version: VERSION,
    persona: { name: '阿墨', avatar: '', status: '寻找灵魂伴侣', statusAt: 0, statusWait: 0, showName: true, showAvatar: true },
    me: { name: '我', avatar: '', status: '' },
    anniversary: { enabled: true, date: '', text: '我们在一起', bg: '' },
    ui: {
      theme: 'auto',
      fontSize: 16,
      avatarSize: 28,
      frost: 65,
      font: '',
      bubbleCss: '',
      chatBg: '',
      homeBg: '',
      homeCover: '',
      homeCover2: '',
      homePin: '',
      homePinCaption: '',
      homeLoc: '在你身边',
      homeNotes: [],
      pins: [],
      homeMsgLeft: '',
      homeMsgRight: '',
      musicBg: '',
      inkDepth: 100,
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
      readSkipRate: 0.1,
      quote: true,
      quoteChance: 30,
      chain: false,
      notify: true,
      sound: true,
      soundRandom: true,
      soundDefault: 's1',
      sounds: [
        { id: 's1', name: '轻叩', preset: 'tap' },
        { id: 's2', name: '风铃', preset: 'chime' },
        { id: 's3', name: '墨滴', preset: 'drop' },
      ],
      stickerChance: 20,
      emojiChance: 20,
      callChance: 10,
      incomingCallChance: 15,
      callAnswer: 85,
      callHangup: 15,
      momentChance: 70,
      momentShotChance: 25,
      momentReplyChance: 90,
      momentReplyDelayMin: 30,
      momentReplyDelayMax: 300,
      momentPostGapMin: 20,
    momentPostGapMax: 180,
      recallChance: 15,
      freeSentenceChance: 30,
      letter: { enabled: true, minMin: 30, maxMin: 180, chance: 15 },
    },
    tts: {
      provider: 'minimax',
      apiKey: '',
      voiceId: '',
      model: 'speech-02-hd',
      apiBase: 'https://api.minimax.chat',
      groupId: '',
      speed: 1,
      interval: 350,
      autoVoice: false,
      voiceRate: '偶尔',
    },
    group: { enabled: false, members },
    cards: seed.cards,
    freeSentence: {
      on: true,
      long: false,
      cats: {
        who: ['我', '你', '他', '她', '我们', '你们', '大家', '朋友', '同事', '自己'],
        action: ['抱抱你', '陪你', '想你', '等你', '找你', '哄你', '叫你', '提醒你', '陪着你', '看着你'],
        degree: ['有点', '很', '真的', '特别', '非常', '太', '挺', '稍微'],
        mood: ['开心', '累', '难过', '想你', '委屈', '生气', '平静', '满足', '幸福', '安心'],
        thing: ['咖啡', '月亮', '花', '床', '公司', '家', '外面', '路上', '窗边', '梦里'],
        time: ['今晚', '今天', '早上', '明天', '现在', '刚刚', '一会儿', '周末', '刚才', '晚上'],
        particle: ['呀', '啦', '哦', '呢', '嘛', '哈', '哟', '罢了'],
      },
    },
    presets: {
      on: true,
      types: {
        emotion: { prob: 70 },
        heart: { prob: 40 },
        intent: { prob: 40 },
      },
      items: {},
    },
    nudge: {
      enabled: true,
      chance: 3,
      items: [{ id: uid(), text: '拍了拍你', at: Date.now() }],
    },
    stickers: [],
    kaomoji: [],
    emojiMine: [],
    letters: { inbox: [], outbox: [] },
    moments: { bg: '', posts: [] },
    music: { tracks: [], mode: 'sequence', together: false, togetherCount: 0, current: 0, apiBase: '', cookie: '', uid: '', nickname: '', msgStay: 5, sessionStart: 0, history: [], liked: [] },
    messages: [],
    favorites: { his: [], mine: [] },
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

function migrate(state) {
  state.behavior.stickerChance = 20;
  state.behavior.emojiChance = 20;
  state.behavior.callChance = 10;
  state.behavior.incomingCallChance = 15;
  state.behavior.callAnswer = 85;
  state.behavior.callHangup = 15;
  state.behavior.readSkipRate = 0.1;
  state.behavior.quoteChance = 30;
  if (state.nudge) state.nudge.chance = 3;
  if (!Array.isArray(state.ui.pins)) state.ui.pins = [];
  if (!state.ui.pins.length && state.ui.homePin) {
    state.ui.pins = [{ id: uid(), img: state.ui.homePin, caption: state.ui.homePinCaption || '', rot: -6 }];
  }
  if (Number(state.ui.inkDepth) === undefined || !Number.isFinite(Number(state.ui.inkDepth))) state.ui.inkDepth = 100;
  state.version = VERSION;
}

let pendingSave = false;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults(true);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaults(true);
    const merged = deepMerge(defaults(false), parsed);
    const from = Number(parsed.version) || 1;
    if (from < VERSION) {
      migrate(merged);
      pendingSave = true;
    }
    return merged;
  } catch {
    return defaults(true);
  }
}

/* 单例：同一次会话里若因版本号不一致重复加载本模块，共用同一个 store，
   避免两份内存状态互相覆盖（曾导致朋友圈 / 拍立得数据丢失）。 */
const shared = window.__zikaStore__ || (window.__zikaStore__ = { state: null, listeners: new Set(), quotaWarned: false });

let state = shared.state || load();
shared.state = state;
if (pendingSave) {
  pendingSave = false;
  persistNow();
}
const listeners = shared.listeners;

export function get() { return state; }
export const store = { get: () => state };

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function persistNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const at = Date.now();
  // 每次都尝试写 localStorage（同步落盘最可靠），失败仅本次降级到 IndexedDB，
  // 不再永久禁用——之前一旦某次写满就再也不写 localStorage，刷新后读回旧数据，
  // 导致删掉的字卡 / 表情包又冒出来。
  let localFailed = false;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    localStorage.setItem(AT_KEY, String(at));
    localOk = true;
  } catch {
    localFailed = true;
  }
  // IndexedDB 支持结构化存储，不用把整个状态转成字符串，写入更快、容量也大得多
  const wrote = idbWrite({ state, at });
  if (localFailed) {
    wrote.then(ok => {
      if (!ok && !shared.quotaWarned) {
        shared.quotaWarned = true;
        toast('存储空间已满，请到「设定 → 存储空间」清理');
      }
    });
  }
  return true;
}

/* 防抖：连续多次改动只在 280ms 后落盘一次，避免每按一下都卡顿 */
function scheduleSave() {
  touched = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistNow();
  }, 280);
}

export function commit(mutator) {
  if (mutator) mutator(state);
  scheduleSave();
  listeners.forEach(fn => fn(state));
  return true;
}

/* 启动后异步读取大容量存档：若它比 localStorage 更新，则替换为它的数据 */
function hydrateFromIdb() {
  if (shared.hydrated) return;
  shared.hydrated = true;
  idbRead().then(rec => {
    if (!rec || typeof rec.at !== 'number' || touched) return;
    const localAt = Number(localStorage.getItem(AT_KEY) || 0);
    if (!(rec.at > localAt)) return;
    try {
      const parsed = (rec.state && typeof rec.state === 'object')
        ? rec.state
        : (typeof rec.json === 'string' ? JSON.parse(rec.json) : null);
      if (!parsed || typeof parsed !== 'object') return;
      state = deepMerge(defaults(false), parsed);
      state.version = VERSION;
      shared.state = state;
      listeners.forEach(fn => fn(state));
      scheduleSave();
    } catch {}
  });
}

function flushSave() {
  if (saveTimer) persistNow();
}

window.addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) flushSave();
});

hydrateFromIdb();

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
  shared.state = state;
  persistNow();
  listeners.forEach(fn => fn(state));
}

export function resetState(keepPersona = false) {
  const persona = keepPersona ? { ...state.persona } : null;
  state = defaults(false);
  if (persona) state.persona = persona;
  shared.state = state;
  persistNow();
  listeners.forEach(fn => fn(state));
}
