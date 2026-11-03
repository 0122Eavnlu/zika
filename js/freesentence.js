import { get } from './state.js?v=20261101BM';
import { pick, randInt } from './util.js?v=20261101BM';

const CAT_ORDER = ['who', 'action', 'degree', 'mood', 'thing', 'time', 'particle'];

const CAT_LABEL = {
  who: '谁',
  action: '干什么',
  degree: '程度',
  mood: '心情',
  thing: '东西·地点',
  time: '时间',
  particle: '语气',
};

function catWords(cat) {
  const fs = get().freeSentence;
  if (!fs || !fs.cats) return [];
  return fs.cats[cat] || [];
}

function pickCat(cat) {
  const words = catWords(cat);
  return words.length ? pick(words) : '';
}

function hasWords(cat) {
  return catWords(cat).length > 0;
}

/* 在词与词之间偶尔插入一点连接词 / 标点，让句子更自然 */
const EXTRA_FILLERS = ['，', '、', '，', ' '];
function maybeFiller() {
  return Math.random() < 0.18 ? pick(EXTRA_FILLERS) : '';
}

/* 从字卡库里抽一张其他字卡，作为补充成分塞进去 */
function extraCardWord() {
  const s = get();
  const groups = new Map(s.cards.groups.map(g => [g.id, g]));
  const pool = (s.cards.items || []).filter(c => {
    if (c.blocked) return false;
    const g = groups.get(c.groupId);
    if (!g) return true;
    if (g.blocked) return false;
    return g.name !== '状态';
  });
  if (!pool.length) return '';
  const t = (pick(pool).text || '').trim();
  // 只取一个词，避免把整句话塞进去
  return t ? t.split(/\s+/)[0] : '';
}

/**
 * 自由造句：按类别挑词，组成一句话。
 * 短句 3-6 段，长句 7-12 段。每段之间可插入标点/连接词。
 * 有概率从字卡库额外抽一个词混进去。
 * 返回 null 表示无法造句（没词）。
 */
export function composeFreeSentence() {
  const fs = get().freeSentence;
  if (!fs || !fs.on) return null;
  if (!hasWords('who') || !hasWords('action')) {
    // 至少要有「谁」和「干什么」两个核心成分，否则造不出完整句
    return null;
  }

  const long = !!fs.long;
  const segments = [];

  // 核心：谁 + 干什么
  segments.push({ text: pickCat('who'), glue: '' });
  segments.push({ text: pickCat('action'), glue: '' });

  const addIf = (cat, prefix = '', suffix = '', prob = 0.5) => {
    if (hasWords(cat) && Math.random() < prob) {
      const w = pickCat(cat);
      if (w) segments.push({ text: prefix + w + suffix, glue: '' });
    }
  };

  if (long) {
    // 长句：成分更全
    addIf('time', '', '', 0.55);
    addIf('degree', '', '', 0.6);
    addIf('mood', '', '', 0.6);
    addIf('thing', '在', '', 0.45);
    addIf('who', '', '', 0.25);   // 偶尔再来一个主语
    addIf('action', '', '', 0.3); // 再来一个动作
    addIf('degree', '', '', 0.3);
    addIf('mood', '', '', 0.3);
    addIf('time', '', '', 0.2);
  } else {
    // 短句：挑 1-3 个补充成分
    addIf('degree', '', '', 0.5);
    addIf('mood', '', '', 0.5);
    addIf('time', '', '', 0.35);
    addIf('thing', '在', '', 0.3);
  }

  // 语气词放句尾
  if (hasWords('particle') && Math.random() < (long ? 0.7 : 0.5)) {
    segments.push({ text: pickCat('particle'), glue: '' });
  }

  // 有概率从字卡库额外抽一个词，插在中间
  if (Math.random() < 0.3) {
    const extra = extraCardWord();
    if (extra && segments.length > 1) {
      const at = randInt(1, segments.length - 1);
      segments.splice(at, 0, { text: extra, glue: '' });
    }
  }

  // 组装：清理空段，段间偶尔插入标点/空格
  const parts = segments
    .map(s => s.text)
    .filter(Boolean)
    .map((t, i, arr) => {
      if (i === arr.length - 1) return t;
      return t + maybeFiller();
    });

  let sentence = parts.join('').trim();
  if (!sentence) return null;

  // 句尾标点：如果没有标点，有概率加一个句号/感叹号/问号
  if (!/[。！？!?…]$/.test(sentence)) {
    const r = Math.random();
    if (r < 0.35) sentence += '。';
    else if (r < 0.6) sentence += '！';
    else if (r < 0.72) sentence += '？';
    // 其余不加，保持口语感
  }

  return sentence;
}

export { CAT_ORDER, CAT_LABEL };
