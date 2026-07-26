// 应用入口：左侧两模块（收藏夹 + 灵感碎片）+ 右侧预览区
import { PLATFORMS, getPlatform, detectPlatform } from './platforms.js';
import {
  getAllBookmarks, putBookmark, deleteBookmark, getBookmark, exportJSON, importJSON,
} from './db.js';
import { recommend } from './recommend.js';
import { buildSearchLinks } from './search.js';
import { bookmarkCard, platformChips, detailModal, formModal, closeModal, toast, escapeHtml, formatDate } from './ui.js';
import {
  captureNote, getInboxNotes, compileTopics, getTopics, queryNotes, analyzeNotes, getNoteStats, importPresetNotes, updateNote, deleteNote,
} from './hub.js';

const state = {
  all: [],
  filterPlatform: '',
  query: '',
  activeModule: 'bookmarks', // 'bookmarks' | 'notes'
};

const $ = (sel) => document.querySelector(sel);

function haptic(s = 'light') { try { if (navigator.vibrate) navigator.vibrate(s === 'medium' ? 10 : 4); } catch (_) {} }

function appReady() {
  document.body.classList.add('app-ready');
  document.body.classList.add('has-bottom-nav');
}

async function load() { state.all = await getAllBookmarks(); render(); }

function filtered() {
  const q = state.query.trim().toLowerCase();
  return state.all.filter((bm) => {
    if (state.filterPlatform && bm.platform !== state.filterPlatform) return false;
    if (!q) return true;
    return [bm.title, bm.url, (bm.tags || []).join(' '), bm.note].join(' ').toLowerCase().includes(q);
  });
}

function render() {
  const chipsHost = $('#chips');
  chipsHost.innerHTML = '';
  chipsHost.appendChild(platformChips(PLATFORMS, state.filterPlatform, (key) => { state.filterPlatform = key; render(); }));
  renderTagCloud();
  const grid = $('#grid');
  grid.innerHTML = '';
  const list = filtered();
  $('#count').textContent = `${list.length} / ${state.all.length}`;
  if (list.length === 0) {
    grid.innerHTML = `<div class="empty">${state.all.length === 0 ? '还没有收藏，点右下角 ＋ 添加第一条灵感吧' : '没有匹配的内容，换个筛选试试'}</div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  for (const bm of list) frag.appendChild(bookmarkCard(bm));
  grid.appendChild(frag);
}

function renderTagCloud() {
  const host = $('#tagcloud');
  const freq = new Map();
  for (const bm of state.all) for (const t of bm.tags || []) { const k = t.toLowerCase(); freq.set(k, (freq.get(k) || 0) + 1); }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);
  host.innerHTML = top.length ? top.map(([t]) => `<button class="cloud-tag" type="button" data-tag="${t}">#${t}</button>`).join('') : '<span class="muted">收藏后打标签，这里会出现标签云</span>';
}

// ===== 右侧预览：点击左侧收藏时在右侧展示详情 =====
async function showPreview(id) {
  const bm = await getBookmark(id);
  if (!bm) return;
  const p = getPlatform(bm.platform);
  const color = p ? p.color : '#888';
  const emoji = p ? p.emoji : '🔖';
  const pname = p ? p.name : '其他';
  const tags = (bm.tags || []).filter(Boolean).map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join('') || '<span class="muted">无标签</span>';

  const similar = recommend(bm, state.all, 5);
  const similarHtml = similar.length
    ? similar.map((s) => `
      <button class="sim-item" data-id="${s.bookmark.id}" type="button">
        <span class="sim-emoji">${getPlatform(s.bookmark.platform)?.emoji || '🔖'}</span>
        <span class="sim-title">${escapeHtml(s.bookmark.title || s.bookmark.url)}</span>
        <span class="sim-score">${Math.round(s.score * 100)}%</span>
      </button>`).join('')
    : '<p class="muted">库里还没有相似内容</p>';

  const links = buildSearchLinks(bm);
  const searchHtml = links.map((l) => `
    <a class="search-link" href="${escapeHtml(l.url)}" target="_blank" rel="noopener" style="--brand:${l.color}">
      <span class="sl-emoji">${l.emoji}</span><span class="sl-name">${escapeHtml(l.name)}</span><span class="sl-go">↗</span>
    </a>`).join('');

  const el = $('#preview-content');
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <span class="plat-badge" style="background:${color};width:24px;height:24px;font-size:14px">${emoji}</span>
      <span style="color:var(--muted);font-size:14px">${escapeHtml(pname)}</span>
    </div>
    <h2 style="font-size:20px;margin:0 0 8px">${escapeHtml(bm.title || '未命名')}</h2>
    <div class="card-tags" style="margin-bottom:10px">${tags}</div>
    ${bm.note ? `<div class="modal-note">${escapeHtml(bm.note)}</div>` : ''}
    <div class="modal-actions">
      ${bm.url ? `<a class="btn btn--primary" href="${escapeHtml(bm.url)}" target="_blank" rel="noopener">打开原帖 ↗</a>` : ''}
      <button class="btn btn--ghost" data-act="edit-preview" data-id="${escapeHtml(bm.id)}" type="button">编辑</button>
      <button class="btn btn--danger" data-act="delete-preview" data-id="${escapeHtml(bm.id)}" type="button">删除</button>
    </div>
    <div class="modal-section"><h4>📚 库内相似内容</h4><div class="similar-list">${similarHtml}</div></div>
    <div class="modal-section"><h4>🌐 各平台搜索类似内容</h4><div class="search-links">${searchHtml}</div></div>`;

  el.classList.add('preview-content--show');
  const ph = $('#preview-placeholder');
  if (ph) ph.style.display = 'none';
}

// ===== 右侧预览：点击左侧灵感碎片笔记时在右侧展示 =====
async function showNotePreview(id) {
  // 从 IndexedDB 获取笔记
  let note = null;
  try {
    const { getDB } = await import('./db.js');
    const db = await getDB();
    const store = db.transaction('notes', 'readonly').objectStore('notes');
    note = await new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (_) { return; }
  if (!note) return;

  let bodyHtml = escapeHtml(note.body);
  bodyHtml = bodyHtml.replace(/\n/g, '<br>');
  bodyHtml = bodyHtml.replace(/【(.+?)】/g, '<strong style="color:var(--accent);font-weight:700">【$1】</strong>');

  const tagsHtml = (note.tags || []).map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join('') || '<span class="muted" style="font-size:11px">无标签</span>';

  const el = $('#preview-content');
  el.innerHTML = `
    <div class="note-preview-card">
      <div class="note-preview-actions">
        <button class="btn btn--ghost" data-act="edit-note" data-note-id="${escapeHtml(note.id)}" type="button" style="padding:6px 12px;font-size:12px">✏️ 编辑</button>
        <button class="btn btn--danger" data-act="del-note" data-note-id="${escapeHtml(note.id)}" type="button" style="padding:6px 12px;font-size:12px">🗑 删除</button>
      </div>
      <div class="note-preview-body">${bodyHtml}</div>
      <div class="note-preview-tags">${tagsHtml}</div>
      <div class="note-preview-meta">
        ${formatDate(note.createdAt)} · ${note.type === 'ref' ? '含链接' : note.type === 'idea' ? '灵感' : '笔记'}
        ${note.topic ? ` · 📌 ${escapeHtml(note.topic)}` : ''}
      </div>
    </div>`;

  el.classList.add('preview-content--show');
  const ph = $('#preview-placeholder');
  if (ph) ph.style.display = 'none';

  // 移动端：点击笔记后收起面板浮层，让用户看到右侧内容
  if (window.innerWidth < 768) {
    document.querySelectorAll('.module-panel--active').forEach(p => p.classList.remove('module-panel--active'));
    document.querySelectorAll('.module-tab--active').forEach(t => t.classList.remove('module-tab--active'));
    document.querySelectorAll('.bn-item').forEach(b => b.classList.remove('bn-item--active'));
  }
}

// ===== 模块切换 =====
function switchModule(mod) {
  state.activeModule = mod;
  document.querySelectorAll('.module-tab').forEach((b) => b.classList.toggle('module-tab--active', b.dataset.module === mod));
  document.querySelectorAll('.module-panel').forEach((p) => p.classList.toggle('module-panel--active', p.id === `module-${mod}`));
  // 底部导航高亮
  document.querySelectorAll('.bn-item').forEach((b) => {
    b.classList.toggle('bn-item--active',
      (b.id === 'bn-bookmarks' && mod === 'bookmarks') || (b.id === 'bn-notes' && mod === 'notes'));
  });
  if (mod === 'notes') refreshInboxList();
}

function switchHubTab(tab) {
  document.querySelectorAll('.hub-tab').forEach((b) => b.classList.toggle('hub-tab--active', b.dataset.tab === tab));
  document.querySelectorAll('.hub-panel').forEach((p) => p.classList.toggle('hub-panel--active', p.id === `panel-${tab}`));
  if (tab === 'capture') refreshInboxList();
  if (tab === 'compile') refreshTopicsList();
}

// ===== 灵感碎片辅助 =====
async function refreshSidebarStats() {
  try { const s = await getNoteStats(); $('#stat-total').textContent = s.total; $('#stat-inbox').textContent = s.inbox; } catch (_) {}
}

// 渲染单条笔记的 HTML（带排版 + 编辑/删除按钮）
function renderNoteItem(n, extraMeta = '') {
  // 将 body 按 【】标题拆分，优化排版
  let bodyHtml = escapeHtml(n.body);
  // 保留换行
  bodyHtml = bodyHtml.replace(/\n/g, '<br>');
  // 高亮【xxx】标题
  bodyHtml = bodyHtml.replace(/【(.+?)】/g, '<strong class="note-heading">【$1】</strong>');

  const borderColor = n.status === 'compiled' ? '#4caf50' : 'var(--accent)';
  return `
    <div class="note-item" style="border-left-color:${borderColor}" data-note-id="${escapeHtml(n.id)}">
      <div class="note-actions">
        <button class="note-act-btn note-act-edit" data-act="edit-note" data-note-id="${escapeHtml(n.id)}" title="编辑">✏️<span class="act-label">编辑</span></button>
        <button class="note-act-btn note-act-del" data-act="del-note" data-note-id="${escapeHtml(n.id)}" title="删除">🗑<span class="act-label">删除</span></button>
      </div>
      <div class="note-body" data-act="preview-note" data-note-id="${escapeHtml(n.id)}">${bodyHtml}</div>
      <div class="note-tags">${(n.tags || []).map((t) => `<span class="note-tag">#${escapeHtml(t)}</span>`).join('')}</div>
      <div class="note-meta">${formatDate(n.createdAt)} · ${n.type === 'ref' ? '含链接' : n.type === 'idea' ? '灵感' : '笔记'}${extraMeta}</div>
    </div>`;
}

async function refreshInboxList() {
  const el = $('#inbox-list');
  try {
    const notes = await getInboxNotes();
    if (notes.length === 0) { el.innerHTML = '<p class="hub-hint">还没有碎片笔记</p>'; return; }
    el.innerHTML = notes.map((n) => renderNoteItem(n)).join('');
  } catch (_) { el.innerHTML = '<p class="hub-hint">加载失败</p>'; }
}

async function refreshTopicsList() {
  const el = $('#topics-list');
  try {
    const topics = await getTopics();
    if (topics.length === 0) { el.innerHTML = '<p class="hub-hint">还没有整理过话题</p>'; return; }
    el.innerHTML = topics.map((t) => `<div class="topic-item" data-topic="${escapeHtml(t.name)}"><div class="topic-name">📌 ${escapeHtml(t.name)}</div><div class="topic-count">${t.count} 条笔记</div></div>`).join('');
    const sel = $('#analyze-topic-select');
    sel.innerHTML = '<option value="">-- 选择话题 --</option>' + topics.map((t) => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)} (${t.count}条)</option>`).join('');
  } catch (_) { el.innerHTML = '<p class="hub-hint">加载失败</p>'; }
}

// ===== 笔记编辑弹窗 =====
function openNoteEditor(note) {
  const tags = [...(note.tags || [])];

  const renderTagChips = () => tags.map((t, i) =>
    `<span class="editor-tag">#${escapeHtml(t)}<button class="editor-tag-remove" data-tag-idx="${i}" title="移除">×</button></span>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'note-editor-overlay';
  overlay.innerHTML = `
    <div class="modal note-editor-modal">
      <button class="modal-close" id="editor-close">✕</button>
      <h3 style="margin:0 0 12px;font-size:16px">✏️ 编辑笔记</h3>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;color:#555;margin-bottom:10px">
        内容
        <textarea id="editor-body" class="editor-textarea" rows="8">${escapeHtml(note.body)}</textarea>
      </label>
      <label style="display:flex;flex-direction:column;gap:4px;font-size:13px;color:#555;margin-bottom:8px">
        标签
        <div class="editor-tags-row">
          <span class="editor-tags-chips" id="editor-tags-chips">${renderTagChips()}</span>
        </div>
        <div style="display:flex;gap:6px;margin-top:4px">
          <input id="editor-tag-input" class="hub-input" style="flex:1" placeholder="输入新标签，回车添加" />
          <button id="editor-tag-add" class="btn btn--ghost" style="padding:6px 12px;font-size:12px">添加</button>
        </div>
      </label>
      <div style="display:flex;gap:8px;margin-top:16px">
        <button id="editor-save" class="btn btn--primary" style="flex:1">保存</button>
        <button id="editor-cancel" class="btn btn--ghost" style="flex:1">取消</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  // 关闭
  const close = () => overlay.remove();
  overlay.querySelector('#editor-close').addEventListener('click', close);
  overlay.querySelector('#editor-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  // 添加标签
  overlay.querySelector('#editor-tag-add').addEventListener('click', () => {
    const input = overlay.querySelector('#editor-tag-input');
    const val = input.value.trim();
    if (val && !tags.includes(val)) {
      tags.push(val);
      overlay.querySelector('#editor-tags-chips').innerHTML = renderTagChips();
      rebindTagRemove(overlay);
    }
    input.value = '';
  });
  overlay.querySelector('#editor-tag-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      overlay.querySelector('#editor-tag-add').click();
    }
  });

  // 移除标签
  function rebindTagRemove(el) {
    el.querySelectorAll('.editor-tag-remove').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.tagIdx);
        tags.splice(idx, 1);
        el.querySelector('#editor-tags-chips').innerHTML = renderTagChips();
        rebindTagRemove(el);
      });
    });
  }
  rebindTagRemove(overlay);

  // 保存
  overlay.querySelector('#editor-save').addEventListener('click', async () => {
    const body = overlay.querySelector('#editor-body').value.trim();
    if (!body) { toast('内容不能为空'); return; }
    try {
      await updateNote(note.id, { body, tags });
      close();
      await refreshInboxList();
      await refreshSidebarStats();
      toast('笔记已更新');
    } catch (err) { toast('保存失败'); }
  });
}

// ===== 侧栏开关 =====
function toggleSidebar() {
  const sidebar = $('#sidebar');
  const isMobile = window.innerWidth < 768;
  if (isMobile) {
    // 移动端：窄侧栏模式，不需要折叠
    return;
  } else {
    sidebar.classList.toggle('sidebar--collapsed');
  }
}

function showMobileSidebar() {
  // 移动端窄侧栏模式下，点击底部菜单按钮直接切换模块
  // 不再需要弹出 overlay
  const sidebar = $('#sidebar');
  if (window.innerWidth >= 768) return;
  // 确保当前激活的面板可见
  const activePanel = document.querySelector('.module-panel--active');
  if (activePanel) {
    activePanel.scrollTop = 0;
  }
}

// ===== 表单相关 =====
function suggestTags(text) {
  if (!text || text.length < 2) return [];
  const seg = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' && (() => { try { return new Intl.Segmenter('zh', { granularity: 'word' }); } catch (_) { return null; } })();
  const freq = new Map(); const t = text.toLowerCase();
  if (seg) { for (const { segment, isWordLike } of seg.segment(t)) { if (isWordLike && segment.length >= 2 && segment.length <= 8) freq.set(segment, (freq.get(segment) || 0) + 1); } }
  else { const en = t.match(/[a-z]{3,}/g) || []; for (const w of en) freq.set(w, (freq.get(w) || 0) + 1); const cn = t.match(/[\u4e00-\u9fff]/g) || []; for (let i = 0; i < cn.length - 1; i++) { freq.set(cn[i] + cn[i + 1], (freq.get(cn[i] + cn[i + 1]) || 0) + 1); } }
  const stop = new Set(['一个','这个','那个','可以','什么','怎么','如何','为什么','但是','而且','所以','因为','已经','还是','或者','没有','他们','我们','自己','就是','这样','那样','一样','一下','真的','太','很','都','也','不','了','吗','呢','吧','啊','哦','嗯','在','的','是','有','和','我','你','他','她','它','这','那','看','说','来','去','到']);
  return [...freq.entries()].filter(([w]) => !stop.has(w)).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w]) => w);
}

function cleanClipboardText(raw) {
  return raw.replace(/^(小红书|抖音|快手|微博|知乎|B站|bilibili|豆瓣|YouTube|Twitter|Instagram|TikTok)\s*[｜|\-—·:：\s]\s*/i, '').replace(/[\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

async function openFormWithClipboard() {
  closeModal();
  let prefill = {};
  try {
    const raw = await navigator.clipboard.readText();
    if (!raw) { document.body.appendChild(formModal(PLATFORMS, {})); return; }
    const urlMatch = raw.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      const url = urlMatch[0]; const platform = detectPlatform(url);
      let rest = raw.replace(url, '').trim(); rest = cleanClipboardText(rest);
      const tags = suggestTags(rest); prefill = { url, platform, title: rest, tags };
      const pname = platform ? getPlatform(platform)?.name : '';
      const detail = [pname, rest ? '标题' : '', tags.length ? `${tags.length}个标签` : ''].filter(Boolean).join(' + ');
      toast(detail ? `已识别：${detail}` : `已识别链接：${pname || '未知平台'}`);
    }
  } catch (_) {}
  document.body.appendChild(formModal(PLATFORMS, prefill));
}

// ===== 事件绑定 =====
function bindEvents() {
  // 模块切换
  $('#module-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.module-tab');
    if (!tab) return;
    switchModule(tab.dataset.module);
  });

  // 底部导航切换
  $('#bn-bookmarks')?.addEventListener('click', () => switchModule('bookmarks'));
  $('#bn-notes')?.addEventListener('click', () => switchModule('notes'));

  // 移动端：点击 main-area 背景关闭面板浮层
  $('#main-area').addEventListener('click', (e) => {
    if (window.innerWidth >= 768) return;
    // 只响应直接点击 main-area 本身（不是内部元素冒泡）
    if (e.target !== $('#main-area')) return;
    // 关闭面板：移除所有 module-panel--active
    document.querySelectorAll('.module-panel--active').forEach(p => p.classList.remove('module-panel--active'));
    document.querySelectorAll('.module-tab--active').forEach(t => t.classList.remove('module-tab--active'));
    // 重置底部导航
    document.querySelectorAll('.bn-item').forEach(b => b.classList.remove('bn-item--active'));
  });

  // 打开收藏详情（预览区）
  document.addEventListener('open-bookmark', (e) => { haptic(); showPreview(e.detail); });

  // 添加按钮
  $('#add-btn').addEventListener('click', () => { haptic('medium'); openFormWithClipboard(); });
  $('#add-btn-nav')?.addEventListener('click', () => { haptic('medium'); openFormWithClipboard(); });

  // 搜索
  let qTimer = null;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(qTimer); const v = e.target.value;
    qTimer = setTimeout(() => { state.query = v; render(); }, 200);
  });

  // 标签云
  $('#tagcloud').addEventListener('click', (e) => {
    const btn = e.target.closest('.cloud-tag'); if (!btn) return; haptic();
    $('#search').value = btn.dataset.tag; state.query = btn.dataset.tag; render();
  });

  // 收藏表单提交
  document.addEventListener('submit', async (e) => {
    if (e.target.id !== 'bm-form') return;
    e.preventDefault(); const fd = new FormData(e.target);
    const url = fd.get('url').trim(); let platform = fd.get('platform');
    if (!platform) platform = detectPlatform(url);
    const tags = fd.get('tags').split(',').map((s) => s.trim()).filter(Boolean);
    const record = { id: e.target.dataset.id || undefined, url, platform, title: fd.get('title').trim(), tags, note: fd.get('note').trim(), thumb: fd.get('thumb').trim() };
    await putBookmark(record); closeModal(); await load(); toast('已保存');
  });

  // 预览区编辑/删除 + 相似卡片点击
  document.addEventListener('click', async (e) => {
    // 编辑
    let btn = e.target.closest('[data-act="edit-preview"]');
    if (btn) { const bm = await getBookmark(btn.dataset.id); closeModal(); document.body.appendChild(formModal(PLATFORMS, bm)); return; }
    // 删除
    btn = e.target.closest('[data-act="delete-preview"]');
    if (btn) { if (confirm('确定删除？')) { await deleteBookmark(btn.dataset.id); showPreview(null); await load(); toast('已删除'); } return; }
    // 相似卡片点击
    const sim = e.target.closest('.sim-item');
    if (sim) { showPreview(sim.dataset.id); return; }
    // 弹窗内编辑/删除
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'edit') { const id = e.target.closest('.modal').dataset.id; const bm = await getBookmark(id); closeModal(); document.body.appendChild(formModal(PLATFORMS, bm)); }
    if (act === 'delete') { const modal = e.target.closest('.modal'); const id = modal.dataset.id; if (confirm('确定删除？')) { await deleteBookmark(id); closeModal(); await load(); toast('已删除'); } }
  });

  // 导出/导入（如果按钮存在）
  const exportBtn = $('#export-btn');
  if (exportBtn) exportBtn.addEventListener('click', async () => {
    const json = await exportJSON(); const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `workbench-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href); toast('备份已下载');
  });
  const importBtn = $('#import-btn');
  const importFile = $('#import-file');
  if (importBtn && importFile) {
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try { const text = await file.text(); const n = await importJSON(text); await load(); toast(`已导入 ${n} 条`); }
      catch (err) { toast('导入失败：' + err.message); } e.target.value = '';
    });
  }

  // === Hub 事件 ===
  $('#capture-btn').addEventListener('click', async () => {
    const text = $('#capture-input').value.trim(); if (!text) { toast('请输入内容'); return; }
    const note = await captureNote(text); $('#capture-input').value = '';
    await refreshInboxList(); await refreshSidebarStats();
    toast(`已记录：${(note.tags || []).slice(0, 3).join(', ')}`);
  });

  // 笔记编辑/删除事件委托（inbox、query-results、topics-list 统一处理）
  document.addEventListener('click', async (e) => {
    // 编辑笔记
    const editBtn = e.target.closest('[data-act="edit-note"]');
    if (editBtn) {
      e.preventDefault();
      const id = editBtn.dataset.noteId;
      // 从 IndexedDB 获取完整笔记数据
      try {
        const { getDB } = await import('./db.js');
        const db = await getDB();
        const store = db.transaction('notes', 'readonly').objectStore('notes');
        const note = await new Promise((resolve, reject) => {
          const req = store.get(id);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        if (note) openNoteEditor(note);
      } catch (_) { toast('无法加载笔记'); }
      return;
    }
    // 删除笔记
    const delBtn = e.target.closest('[data-act="del-note"]');
    if (delBtn) {
      e.preventDefault();
      const id = delBtn.dataset.noteId;
      if (!confirm('确定删除这条笔记？')) return;
      try {
        await deleteNote(id);
        await refreshInboxList();
        await refreshSidebarStats();
        toast('已删除');
      } catch (_) { toast('删除失败'); }
      return;
    }
    // 预览笔记（点击笔记正文）
    const previewBtn = e.target.closest('[data-act="preview-note"]');
    if (previewBtn) {
      e.preventDefault();
      showNotePreview(previewBtn.dataset.noteId);
      return;
    }
  });

  $('#compile-btn').addEventListener('click', async () => {
    const btn = $('#compile-btn'); btn.textContent = '整理中...'; btn.disabled = true;
    try {
      const result = await compileTopics();
      await refreshInboxList(); await refreshTopicsList(); await refreshSidebarStats();
      if (result.topics.length === 0) toast('暂无足够笔记可整理');
      else toast(`已整理 ${result.topics.length} 个话题，${result.merged} 条笔记`);
    } catch (err) { toast('整理失败'); }
    btn.textContent = '自动整理'; btn.disabled = false;
  });

  $('#query-btn').addEventListener('click', async () => {
    const kw = $('#query-input').value.trim(); if (!kw) { toast('请输入关键词'); return; }
    const notes = await queryNotes(kw); const el = $('#query-results');
    if (notes.length === 0) { el.innerHTML = '<p class="hub-hint">没有找到相关笔记</p>'; return; }
    el.innerHTML = notes.map((n) => {
      const topicMeta = n.topic ? ` · 📌 ${escapeHtml(n.topic)}` : '';
      return renderNoteItem(n, topicMeta);
    }).join('');
  });

  $('#analyze-btn').addEventListener('click', async () => {
    const topic = $('#analyze-topic-select').value; if (!topic) { toast('请先选择话题'); return; }
    const notes = await queryNotes(topic); if (notes.length === 0) { toast('没有找到相关笔记'); return; }
    const result = await analyzeNotes(notes); const el = $('#analyze-results');
    el.innerHTML = `
      <div class="analyze-suggestion">💡 ${escapeHtml(result.suggestion)}</div>
      <p class="hub-hint" style="margin-top:4px">🔑 核心词：${escapeHtml(result.keywords)}</p>
      <div class="analyze-links">${result.links.map((l) => `<a class="analyze-link" href="${escapeHtml(l.url)}" target="_blank" rel="noopener" style="--brand:${l.color}"><span>${l.emoji}</span><span style="flex:1">${escapeHtml(l.name)}</span><span>↗</span></a>`).join('')}</div>`;
  });

  // hub tab 切换
  $('#hub-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.hub-tab'); if (!tab) return; switchHubTab(tab.dataset.tab);
  });

  // 话题点击 → 提取
  $('#topics-list').addEventListener('click', async (e) => {
    const item = e.target.closest('.topic-item'); if (!item) return;
    const topic = item.dataset.topic; $('#query-input').value = topic; switchHubTab('query');
    const notes = await queryNotes(topic); const el = $('#query-results');
    el.innerHTML = notes.map((n) => renderNoteItem(n)).join('');
  });

  // 侧栏
  $('#sidebar-toggle').addEventListener('click', toggleSidebar);
  const mobileSidebarBtn = $('#mobile-sidebar-btn');
  if (mobileSidebarBtn) mobileSidebarBtn.addEventListener('click', showMobileSidebar);

  window.addEventListener('resize', () => {
    if (window.innerWidth >= 768) { const s = $('#sidebar'); s.classList.remove('sidebar--open'); const o = document.querySelector('.sidebar-overlay'); if (o) o.remove(); }
  });
}

function registerSW() { if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {}); }

// 首次使用时自动加载预设灵感碎片
async function autoImportPresetNotes() {
  const stats = await getNoteStats().catch(() => ({ total: 0 }));
  if (stats.total > 0) return; // 已有数据，跳过

  try {
    const resp = await fetch('./preset-notes.json');
    if (!resp.ok) return;
    const notes = await resp.json();
    const count = await importPresetNotes(notes);
    if (count > 0) {
      await refreshInboxList();
      await refreshSidebarStats();
      toast(`已导入 ${count} 条灵感碎片`);
    }
  } catch (_) {}
}

async function init() {
  bindEvents();
  try { await load(); } catch (_) {}
  try { await refreshSidebarStats(); } catch (_) {}
  try { await refreshInboxList(); } catch (_) {}
  try { await autoImportPresetNotes(); } catch (_) {}
  appReady();
  registerSW();
}

init();
