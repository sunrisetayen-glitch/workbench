// 在线搜索链接生成：根据标题/标签，为每个平台生成搜索入口
import { PLATFORMS } from './platforms.js';

// 清理标题：去掉开头的「3个 / 5种」计数词与常见前缀，方便作为搜索词
function cleanTitle(title) {
  return (title || '')
    .replace(/^\d+\s*[个种类型张条篇课]+/, '')
    .replace(/^(如何|怎么|怎样|为什么|盘点|推荐|分享|教你|学会|掌握)/, '')
    .replace(/^[「『"']+|[」』"']+$/g, '')
    .trim();
}

// 提取搜索关键词：优先用标签（用户主动语义，跨平台更准），否则用清理后的标题
export function buildKeywords(bm) {
  const tags = (bm.tags || []).filter(Boolean);
  const cleaned = cleanTitle(bm.title);
  if (tags.length) return tags.join(' ');
  return cleaned;
}

/**
 * 生成各平台的搜索链接
 * @param {object} bm 收藏项
 * @returns {Array<{key,name,emoji,color,url}>}
 */
export function buildSearchLinks(bm) {
  const kw = buildKeywords(bm);
  if (!kw) return [];
  const encoded = encodeURIComponent(kw);
  return PLATFORMS.map((p) => ({
    key: p.key,
    name: p.name,
    emoji: p.emoji,
    color: p.color,
    url: p.search.replace('KEY', encoded),
  }));
}
