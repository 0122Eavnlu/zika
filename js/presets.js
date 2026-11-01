/* 系统预设字卡：情绪 / 心意 / 交流意图，三类各自独立概率，
   每条可单独开关与调整权重。数据是静态的，用户改动只记录在 state.presets.items 里。 */

export const PRESET_TYPES = [
  { id: 'emotion', name: '情绪', prob: 70 },
  { id: 'heart', name: '心意', prob: 40 },
  { id: 'intent', name: '交流意图', prob: 40 },
];

const CATS = {
  emotion: ['开心', '黏人', '害羞', '委屈', '安心', '生气', '想念', '心动'],
  heart: ['喜欢', '在乎', '想靠近', '心疼', '依赖', '吃醋', '珍惜', '想被哄'],
  intent: ['回应', '分享', '倾听', '靠近', '了解', '陪伴', '安慰', '撒娇'],
};

const TEXTS = {
  emotion: {
    开心: ['见到你就开心', '心情被你点亮', '今天心情很好', '偷偷开心', '嘴角下不来', '想和你笑一会儿', '开心到冒泡'],
    黏人: ['有点黏你', '想赖着你', '想一直贴着你', '不想挂电话', '想被你抱着', '想再聊一会儿', '舍不得走'],
    害羞: ['耳朵有点热', '脸有点烫', '不敢看你', '心跳有点快', '说话都变小声', '被你看着会脸红', '想躲一下'],
    委屈: ['有点委屈', '想被你哄', '鼻子有点酸', '憋着一句话没说', '其实有点难过', '想被抱抱', '眼眶有点热'],
    安心: ['有你就安心', '心里踏实了', '忽然不慌了', '觉得被接住了', '想靠一会儿', '你在就好', '心落回原位'],
    生气: ['有点生气', '哼，不说话了', '在闹小脾气', '要你来哄', '气鼓鼓的', '不理你三分钟', '其实没那么气'],
    想念: ['有点想你', '想见你', '想听你说话', '翻着聊天记录', '忽然很想你', '想你想得走神', '什么时候见面'],
    心动: ['心跳漏一拍', '被你撩到了', '有点招架不住', '耳朵红了', '心动了一下', '想再看你一眼', '被戳中了'],
  },
  heart: {
    喜欢: ['喜欢你', '越来越喜欢你', '好像更喜欢你了', '藏不住的喜欢', '满心都是你', '看你哪都好', '喜欢到藏不住'],
    在乎: ['很在乎你', '你说的我都记得', '一直在意你', '怕你受委屈', '把你放心上', '你的事我都想知道', '在意得要命'],
    想靠近: ['想靠近', '想走进你心里', '想离你近一点', '想和你更近', '想牵你的手', '想靠在你肩上', '想和你并肩'],
    心疼: ['有点心疼你', '别一个人扛', '想替你分担', '看你累我会难受', '想抱抱你', '想给你揉揉肩', '别硬撑了'],
    依赖: ['有点依赖你', '习惯了有你', '离不开你了', '想一直有你', '你在就好', '想事事都和你说', '没你不行'],
    吃醋: ['有点吃醋', '心里酸酸的', '不想你和别人太好', '偷偷吃醋了', '只准对我这样', '酸了一下', '想独占你'],
    珍惜: ['很珍惜你', '不想弄丢你', '会好好对你', '想和你久一点', '遇见你真好', '想陪你很久', '你是特别的'],
    想被哄: ['想被哄', '想听你说软话', '想被你偏爱', '想要一个抱抱', '想被你宠着', '想听你说想我', '想被你在乎'],
  },
  intent: {
    回应: ['想回应你', '有在认真听', '想接住你的话', '想马上回你', '看到就想回', '一直在等你', '想接住你的情绪'],
    分享: ['想和你分享', '有件小事想告诉你', '想让你知道', '想和你碎碎念', '想一起看', '想告诉你今天的我', '有好多话想说'],
    倾听: ['想听你说', '你说我在听', '想听你多讲一点', '想懂你的心事', '愿意听你慢慢说', '你说多久都在听', '想听你的声音'],
    靠近: ['想靠近你', '想和你多说几句', '想找你聊', '想和你待在一起', '想更了解你', '想和你单独待着', '想走近一点'],
    了解: ['想更懂你', '想了解你在想什么', '想记住你的喜好', '想读懂你', '想认识更多面的你', '想知道你今天', '想懂你的沉默'],
    陪伴: ['想陪着你', '会一直在', '想陪你到很晚', '想陪你度过', '不想让你一个人', '想陪你说说话', '一直在'],
    安慰: ['想安慰你', '别难过，我在', '想抱抱你', '都会过去的', '你可以靠着我', '慢慢来，不着急', '我在呢'],
    撒娇: ['想撒个娇', '想被你惯着', '想耍赖一下', '想你哄哄我', '想被你宠一下', '想听你哄我', '想赖在你身边'],
  },
};

const PROBS = [60, 70, 50, 80, 40, 65, 55];

export const PRESET_CATEGORIES = CATS;

export const PRESET_ITEMS = PRESET_TYPES.flatMap(type =>
  (CATS[type.id] || []).flatMap((cat, ci) =>
    ((TEXTS[type.id] || {})[cat] || []).map((text, i) => ({
      id: `${type.id}-${ci}-${i}`,
      type: type.id,
      cat,
      text,
      prob: PROBS[i % PROBS.length],
    }))
  )
);

export const PRESET_TYPE_NAME = Object.fromEntries(PRESET_TYPES.map(t => [t.id, t.name]));

/* 读某条预设的实际状态（未改过就用数据里的默认值） */
export function presetItemState(state, item) {
  const o = state?.presets?.items?.[item.id];
  return {
    on: o ? o.on !== false : true,
    prob: o && Number.isFinite(Number(o.prob)) ? Math.max(0, Math.min(100, Number(o.prob))) : item.prob,
  };
}

function weightedPick(pool, rand, state) {
  const weights = pool.map(it => {
    const st = presetItemState(state, it);
    return st.on ? st.prob : 0;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;
  let r = rand() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r < 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/* 按三类概率各自独立判定，返回要挂在气泡下方的小字卡 */
export function rollPresetTags(state, rand = Math.random) {
  const pr = state?.presets;
  if (!pr || !pr.on) return [];
  const out = [];
  for (const type of PRESET_TYPES) {
    const chance = Number(pr.types?.[type.id]?.prob ?? 0);
    if (!(chance > 0) || !(rand() * 100 < chance)) continue;
    const pool = PRESET_ITEMS.filter(it => it.type === type.id && presetItemState(state, it).on);
    if (!pool.length) continue;
    const picked = weightedPick(pool, rand, state);
    if (picked) out.push({ type: type.name, text: picked.text });
  }
  return out;
}
