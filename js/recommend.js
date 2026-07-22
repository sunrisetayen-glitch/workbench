// 本地相似推荐：标签 Jaccard 相似度 + 标题分词余弦相似度
// 中文分词优先用 Intl.Segmenter，不支持时回退到字符 bigram

const HAS_SEGMENTER =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';

let segmenter = null;
if (HAS_SEGMENTER) {
  try {
    segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
  } catch (e) {
    segmenter = null;
  }
}

// 把文本切成词元（小写、去标点）
export function tokenize(text) {
  const t = (text || '').toLowerCase();
  if (segmenter) {
    const words = [];
    for (const { segment, isWordLike } of segmenter.segment(t)) {
      if (isWordLike && segment.trim()) words.push(segment.trim());
    }
    return words;
  }
  // 回退：英文按词，中文按相邻 2 字 bigram
  const en = t.match(/[a-z0-9]+/g) || [];
  const cn = t.match(/[\u4e00-\u9fff]/g) || [];
  const bigrams = [];
  for (let i = 0; i < cn.length - 1; i++) bigrams.push(cn[i] + cn[i + 1]);
  if (cn.length === 1) bigrams.push(cn[0]);
  return [...en, ...bigrams];
}

// 词频向量
function termFreq(tokens) {
  const f = new Map();
  for (const tk of tokens) f.set(tk, (f.get(tk) || 0) + 1);
  return f;
}

// 余弦相似度（两个词频向量）
function cosine(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const v of a.values()) na += v * v;
  for (const v of b.values()) nb += v * v;
  const small = a.size < b.size ? a : b;
  const other = small === a ? b : a;
  for (const [k, v] of small) {
    const ov = other.get(k);
    if (ov) dot += v * ov;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// Jaccard 相似度（标签集合）
function jaccard(a = [], b = []) {
  const sa = new Set(a.map((x) => (x || '').toLowerCase()));
  const sb = new Set(b.map((x) => (x || '').toLowerCase()));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const uni = new Set([...sa, ...sb]).size;
  return inter / (uni || 1);
}

// 缓存标题向量，避免重复计算
const titleVecCache = new WeakMap();

function titleVec(bm) {
  if (titleVecCache.has(bm)) return titleVecCache.get(bm);
  const v = termFreq(tokenize(bm.title || ''));
  titleVecCache.set(bm, v);
  return v;
}

/**
 * 计算 target 与其余收藏的相似度，返回排序后的 top N
 * @param {object} target 目标收藏
 * @param {object[]} all 全部收藏（含 target 也可，会被排除）
 * @param {number} limit 返回条数
 */
export function recommend(target, all, limit = 6) {
  const tv = titleVec(target);
  const scored = [];
  for (const bm of all) {
    if (bm.id === target.id) continue;
    const tagSim = jaccard(target.tags, bm.tags);
    const titleSim = cosine(tv, titleVec(bm));
    // 标签权重更高，因为标签是用户主动语义
    const score = tagSim * 0.7 + titleSim * 0.3;
    if (score <= 0) continue;
    scored.push({ bm, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => ({ bookmark: s.bm, score: s.score }));
}
