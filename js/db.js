// IndexedDB 封装：收藏项的增删改查 + 导出/导入 JSON
// 纯前端，无后端。数据存于浏览器本地。

const DB_NAME = 'media-workbench';
const DB_VERSION = 1;
const STORE = 'bookmarks';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('platform', 'platform', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode) {
  return openDB().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function uid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'b-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// 新增或更新一条收藏
export async function putBookmark(bm) {
  const store = await tx('readwrite');
  const record = {
    id: bm.id || uid(),
    url: (bm.url || '').trim(),
    platform: bm.platform || '',
    title: (bm.title || '').trim(),
    tags: Array.isArray(bm.tags) ? bm.tags : [],
    note: (bm.note || '').trim(),
    thumb: (bm.thumb || '').trim(),
    createdAt: bm.createdAt || Date.now(),
  };
  await reqToPromise(store.put(record));
  return record;
}

export async function deleteBookmark(id) {
  const store = await tx('readwrite');
  await reqToPromise(store.delete(id));
}

export async function getBookmark(id) {
  const store = await tx('readonly');
  return reqToPromise(store.get(id));
}

// 返回全部收藏，按创建时间倒序
export async function getAllBookmarks() {
  const store = await tx('readonly');
  const all = await reqToPromise(store.getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

// 导出为 JSON 字符串（备份 / 换机）
export async function exportJSON() {
  const all = await getAllBookmarks();
  return JSON.stringify({ type: 'media-workbench', version: 1, exportedAt: Date.now(), items: all }, null, 2);
}

// 从 JSON 导入（合并去重，按 id 覆盖）
export async function importJSON(text) {
  const data = JSON.parse(text);
  const items = Array.isArray(data) ? data : data.items;
  if (!Array.isArray(items)) throw new Error('无效的备份文件');
  const store = await tx('readwrite');
  let count = 0;
  for (const it of items) {
    if (!it || !it.id) continue;
    await reqToPromise(store.put(it));
    count++;
  }
  return count;
}
