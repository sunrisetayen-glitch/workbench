// inspiration-hub 核心逻辑：碎片记录 → 分类整理 → 话题提取 → 跨平台分析
// 复用 db.js 的 IndexedDB 连接（notes store 由 db.js 统一创建）

import { uid, getDB } from './db.js';
import { PLATFORMS } from './platforms.js';
import { tokenize } from './recommend.js';

const NOTES_STORE = 'notes';

function notesTx(mode) {
  return getDB().then((db) => db.transaction(NOTES_STORE, mode).objectStore(NOTES_STORE));
}

function reqToP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------- 分词与标签提取 ----------

const STOP = new Set([
  '一个', '这个', '那个', '可以', '什么', '怎么', '如何', '为什么',
  '但是', '而且', '所以', '因为', '已经', '还是', '或者', '没有',
  '他们', '我们', '自己', '就是', '这样', '那样', '一样', '一下',
  '真的', '太', '很', '都', '也', '不', '了', '吗', '呢', '吧',
  '啊', '哦', '嗯', '在', '的', '是', '有', '和', '我', '你',
  '他', '她', '它', '这', '那', '看', '说', '来', '去', '到',
  '这里', '几个', '实用', '必看', '适合', '盘点', '推荐', '分享',
]);

export function extractTags(text, max = 6) {
  if (!text || text.length < 2) return [];
  const freq = new Map();
  const tokens = tokenize(text);
  for (const t of tokens) {
    if (t.length >= 2 && t.length <= 8 && !STOP.has(t)) {
      freq.set(t, (freq.get(t) || 0) + 1);
    }
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w);
}

// ---------- 公开 API ----------

export async function captureNote(rawText) {
  const text = (rawText || '').trim();
  if (!text) return null;
  const urlMatch = text.match(/https?:\/\/[^\s]+/);
  const url = urlMatch ? urlMatch[0] : '';
  const body = url ? text.replace(url, '').trim() : text;
  const type = url ? 'ref' : body.length < 50 ? 'idea' : 'note';
  const tags = extractTags(body);
  const note = {
    id: uid(),
    type,
    body,
    url,
    tags,
    topic: '',
    status: 'inbox',
    createdAt: Date.now(),
  };
  const store = await notesTx('readwrite');
  await reqToP(store.put(note));
  return note;
}

export async function getInboxNotes() {
  const store = await notesTx('readonly');
  const all = await reqToP(store.getAll());
  return all.filter((n) => n.status === 'inbox').sort((a, b) => b.createdAt - a.createdAt);
}

export async function compileTopics() {
  const inbox = await getInboxNotes();
  if (inbox.length < 2) return { topics: [], merged: 0 };

  const groups = [];
  const used = new Set();
  for (let i = 0; i < inbox.length; i++) {
    if (used.has(inbox[i].id)) continue;
    const group = [inbox[i]];
    used.add(inbox[i].id);
    for (let j = i + 1; j < inbox.length; j++) {
      if (used.has(inbox[j].id)) continue;
      const overlap = inbox[i].tags.filter((t) => inbox[j].tags.includes(t));
      if (overlap.length >= 1) { group.push(inbox[j]); used.add(inbox[j].id); }
    }
    groups.push(group);
  }

  const store = await notesTx('readwrite');
  const topics = [];
  let merged = 0;

  for (const group of groups) {
    if (group.length < 2) continue;
    const allTags = group.flatMap((n) => n.tags);
    const tagFreq = new Map();
    for (const t of allTags) tagFreq.set(t, (tagFreq.get(t) || 0) + 1);
    const topTag = [...tagFreq.entries()].sort((a, b) => b[1] - a[1])[0][0];
    for (const n of group) {
      n.topic = topTag;
      n.status = 'compiled';
      await reqToP(store.put(n));
      merged++;
    }
    topics.push({ name: topTag, count: group.length, tags: [...new Set(allTags)].slice(0, 8) });
  }

  return { topics, merged };
}

export async function getTopics() {
  const store = await notesTx('readonly');
  const all = await reqToP(store.getAll());
  const compiled = all.filter((n) => n.status === 'compiled' && n.topic);
  const topicMap = new Map();
  for (const n of compiled) {
    if (!topicMap.has(n.topic)) topicMap.set(n.topic, []);
    topicMap.get(n.topic).push(n);
  }
  return [...topicMap.entries()].map(([name, notes]) => ({
    name,
    count: notes.length,
    tags: [...new Set(notes.flatMap((n) => n.tags))],
    notes: notes.sort((a, b) => b.createdAt - a.createdAt),
  }));
}

export async function queryNotes(keyword) {
  const store = await notesTx('readonly');
  const all = await reqToP(store.getAll());
  const kw = (keyword || '').toLowerCase();
  if (!kw) return [];
  return all
    .filter((n) => {
      const hay = [n.body, n.topic, ...(n.tags || [])].join(' ').toLowerCase();
      return hay.includes(kw);
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function analyzeNotes(notes) {
  if (!notes || notes.length === 0) return { keywords: '', links: [], suggestion: '' };
  const allTags = notes.flatMap((n) => n.tags);
  const tagFreq = new Map();
  for (const t of allTags) tagFreq.set(t, (tagFreq.get(t) || 0) + 1);
  const topTags = [...tagFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t);
  const keywords = topTags.join(' ');
  const encoded = encodeURIComponent(keywords);
  const links = PLATFORMS.map((p) => ({
    key: p.key, name: p.name, emoji: p.emoji, color: p.color,
    url: p.search.replace('KEY', encoded),
  }));

  const isShortForm = keywords.includes('短视频') || keywords.includes('抖音');
  const isWriting = keywords.includes('文案') || keywords.includes('标题') || keywords.includes('写作');
  const isGrowth = keywords.includes('涨粉') || keywords.includes('流量') || keywords.includes('算法');

  let suggestion = '建议重点关注小红书（图文种草）+ 抖音（短视频）两个平台。';
  if (isShortForm) suggestion = '短视频话题，优先做抖音 + B站，15-60秒干货型。可拆分为系列选题。';
  if (isWriting) suggestion = '文案/标题类，小红书图文 + 知乎深度回答双管齐下。提炼模板公式更易传播。';
  if (isGrowth) suggestion = '涨粉/流量类，建议做对比测评型内容，小红书 + B站长视频分析。注意时效性。';

  return { keywords, links, suggestion };
}

export async function deleteNote(id) {
  const store = await notesTx('readwrite');
  await reqToP(store.delete(id));
}

export async function getNoteStats() {
  const store = await notesTx('readonly');
  const all = await reqToP(store.getAll());
  return {
    total: all.length,
    inbox: all.filter((n) => n.status === 'inbox').length,
    compiled: all.filter((n) => n.status === 'compiled').length,
  };
}

// 批量导入预设灵感碎片（从 JSON 数组导入到 notes store）
export async function importPresetNotes(notesArray) {
  if (!Array.isArray(notesArray) || notesArray.length === 0) return 0;
  const store = await notesTx('readwrite');
  let count = 0;
  for (const note of notesArray) {
    const id = note.id || (crypto.randomUUID ? crypto.randomUUID() : 'n-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8));
    const body = note.body || (note.title ? note.title + '\n\n' + note.content : note.content || '');
    const record = {
      id,
      type: note.type || ((note.content || body).length < 50 ? 'idea' : 'note'),
      body: body,
      url: note.url || '',
      tags: note.tags || [],
      topic: note.topic || '',
      status: note.status || 'inbox',
      createdAt: note.createdAt || (Date.now() - Math.floor(Math.random() * 86400000)),
    };
    await reqToP(store.put(record));
    count++;
  }
  return count;
}
