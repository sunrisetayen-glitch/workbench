// 应用入口：状态管理、事件绑定、筛选/搜索、渲染编排 + inspiration-hub 集成
import { PLATFORMS, getPlatform, detectPlatform } from './platforms.js';
import {
  getAllBookmarks,
  putBookmark,
  deleteBookmark,
  getBookmark,
  exportJSON,
  importJSON,
} from './db.js';
import { recommend } from './recommend.js';
import { buildSearchLinks } from './search.js';
import {
  bookmarkCard,
  platformChips,
  detailModal,
  formModal,
  closeModal,
  toast,
  escapeHtml,
  formatDate,
} from './ui.js';
import {
  captureNote,
  getInboxNotes,
  compileTopics,
  getTopics,
  queryNotes,
  analyzeNotes,
  deleteNote,
  getNoteStats,
} from './hub.js';

const state = {
  all: [],
  filterPlatform: '',
  query: '',
};

const $ = (sel) => document.querySelector(sel);

// iOS 触觉反馈
function haptic(style = 'light') {
  try { if (navigator.vibrate) navigator.vibrate(style === 'medium' ? 10 : 4); } catch (_) {}
}

function appReady() {
  document.body.classList.add('app-ready');
  document.body.classList.add('has-bottom-nav');
}

async function load() {
  state.all = await getAllBookmarks();
  render();
}

function filtered() {
  const q = state.query.trim().toLowerCase();
  return state.all.filter((bm) => {
    if (state.filterPlatform && bm.platform !== state.filterPlatform) return false;
    if (!q) return true;
    const hay = [bm.title, bm.url, (bm.tags || []).join(' '), bm.note].join(' ').toLowerCase();
    return hay.includes(q);
  });
}

function render() {
  const chipsHost = $('#chips');
  chipsHost.innerHTML = '';
  chipsHost.appendChild(platformChips(PLATFORMS, state.filterPlatform, (key) => {
    state.filterPlatform = key;
    render();
  }));
  renderTagCloud();
  const grid = $('#grid');
  grid.innerHTML = '';
  const list = filtered();
  $('#count').textContent = `${list.length} / ${state.all.length}`;
  if (list.length === 0) {
    grid.innerHTML = `<div class="empty">${state.all.length === 0 ? '还没有收藏，点右下角 ➕ 添加第一条灵感吧' : '没有匹配的内容，换个筛选试试'}</div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  for (const bm of list) frag.appendChild(bookmarkCard(bm));
  grid.appendChild(frag);
}

function renderTagCloud() {
  const host = $('#tagcloud');
  const freq = new Map();
  for (const bm of state.all) {
    for (const t of bm.tags || []) { const k = t.toLowerCase(); freq.set(k, (freq.get(k) || 0) + 1); }
  }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);
  host.innerHTML = top.length ? top.map(([t]) => `<button class="cloud-tag" type="button" data-tag="${t}">#${t}</button>`).join('') : '<span class="muted">收藏后打标签，这里会出现标签云</span>';
}

async function openDetail(id) {
  const bm = await getBookmark(id);
  if (!bm) return;
  closeModal();
  const similar = recommend(bm, state.all, 6);
  const links = buildSearchLinks(bm);
  document.body.appendChild(detailModal(bm, similar, links));
}

function openForm(initial) {
  closeModal();
  document.body.appendChild(formModal(PLATFORMS, initial || {}));
}

function suggestTags(text) {
  if (!text || text.length < 2) return [];
  const seg = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' && (() => { try { return new Intl.Segmenter('zh', { granularity: 'word' }); } catch (_) { return null; } })();
  const freq = new Map();
  const t = text.toLowerCase();
  if (seg) {
    for (const { segment, isWordLike } of seg.segment(t)) { if (isWordLike && segment.length >= 2 && segment.length <= 8) freq.set(segment, (freq.get(segment) || 0) + 1); }
  } else {
    const en = t.match(/[a-z]{3,}/g) || []; for (const w of en) freq.set(w, (freq.get(w) || 0) + 1);
    const cn = t.match(/[\u4e00-\u9fff]/g) || []; for (let i = 0; i < cn.length - 1; i++) { const bg = cn[i] + cn[i + 1]; freq.set(bg, (freq.get(bg) || 0) + 1); }
  }
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
      const url = urlMatch[0];
      const platform = detectPlatform(url);
      let rest = raw.replace(url, '').trim();
      rest = cleanClipboardText(rest);
      const tags = suggestTags(rest);
      prefill = { url, platform, title: rest, tags };
      const pname = platform ? getPlatform(platform)?.name : '';
      const detail = [pname, rest ? '标题' : '', tags.length ? `${tags.length}个标签` : ''].filter(Boolean).join(' + ');
      toast(detail ? `已识别：${detail}` : `已识别链接：${pname || '未知平台'}`);
    }
  } catch (_) {}
  document.body.appendChild(formModal(PLATFORMS, prefill));
}

// ===== Inspiration Hub 逻辑 =====

async function refreshSidebarStats() {
  try {
    const stats = await getNoteStats();
    $('#stat-total').textContent = stats.total;
    $('#stat-inbox').textContent = stats.inbox;
  } catch (_) {}
}

async function refreshInboxList() {
  const el = $('#inbox-list');
  try {
    const notes = await getInboxNotes();
    if (notes.length === 0) { el.innerHTML = '<p class="hub-hint">还没有碎片笔记，在输入框里写点什么吧</p>'; return; }
    el.innerHTML = notes.map((n) => `
      <div class="note-item">
        <div>${escapeHtml(n.body)}</div>
        <div class="note-tags">${(n.tags || []).map((t) => `<span class="note-tag">#${escapeHtml(t)}</span>`).join('')}</div>
        <div class="note-meta">${formatDate(n.createdAt)} · ${n.type === 'ref' ? '含链接' : n.type === 'idea' ? '灵感' : '笔记'}</div>
      </div>`).join('');
  } catch (_) { el.innerHTML = '<p class="hub-hint">加载失败</p>'; }
}

async function refreshTopicsList() {
  const el = $('#topics-list');
  try {
    const topics = await getTopics();
    if (topics.length === 0) { el.innerHTML = '<p class="hub-hint">还没有整理过话题，先记录一些碎片再点"自动整理"</p>'; return; }
    el.innerHTML = topics.map((t) => `
      <div class="topic-item" data-topic="${escapeHtml(t.name)}">
        <div class="topic-name">📌 ${escapeHtml(t.name)}</div>
        <div class="topic-count">${t.count} 条笔记</div>
      </div>`).join('');

    // 刷新分析面板的话题下拉
    const sel = $('#analyze-topic-select');
    sel.innerHTML = '<option value="">-- 选择话题 --</option>' + topics.map((t) => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)} (${t.count}条)</option>`).join('');
  } catch (_) { el.innerHTML = '<p class="hub-hint">加载失败</p>'; }
}

// hub tab 切换
function switchHubTab(tab) {
  document.querySelectorAll('.hub-tab').forEach((b) => b.classList.toggle('hub-tab--active', b.dataset.tab === tab));
  document.querySelectorAll('.hub-panel').forEach((p) => p.classList.toggle('hub-panel--active', p.id === `panel-${tab}`));
  if (tab === 'capture') refreshInboxList();
  if (tab === 'compile') refreshTopicsList();
}

// 侧栏开关（桌面端折叠 / 移动端浮层）
function toggleSidebar() {
  const sidebar = $('#sidebar');
  const isMobile = window.innerWidth < 768;
  if (isMobile) {
    sidebar.classList.toggle('sidebar--open');
    const overlay = document.querySelector('.sidebar-overlay');
    if (sidebar.classList.contains('sidebar--open')) {
      if (!overlay) {
        const div = document.createElement('div');
        div.className = 'sidebar-overlay sidebar-overlay--show';
        div.addEventListener('click', () => { sidebar.classList.remove('sidebar--open'); div.remove(); });
        document.body.appendChild(div);
      }
    } else {
      if (overlay) overlay.remove();
    }
  } else {
    sidebar.classList.toggle('sidebar--collapsed');
  }
}

// 移动端底栏切换到笔记面板
function showMobileSidebar() {
  const sidebar = $('#sidebar');
  sidebar.classList.add('sidebar--open');
  const overlay = document.querySelector('.sidebar-overlay') || (() => {
    const div = document.createElement('div'); div.className = 'sidebar-overlay sidebar-overlay--show';
    div.addEventListener('click', () => { sidebar.classList.remove('sidebar--open'); div.remove(); });
    document.body.appendChild(div); return div;
  })();
}

// ===== 事件绑定 =====
function bindEvents() {
  document.addEventListener('open-bookmark', (e) => { haptic(); openDetail(e.detail); });

  $('#add-btn').addEventListener('click', () => { haptic('medium'); openFormWithClipboard(); });
  const navAdd = $('#add-btn-nav');
  if (navAdd) navAdd.addEventListener('click', () => { haptic('medium'); openFormWithClipboard(); });

  let qTimer = null;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    const v = e.target.value;
    qTimer = setTimeout(() => { state.query = v; render(); }, 200);
  });

  $('#tagcloud').addEventListener('click', (e) => {
    const btn = e.target.closest('.cloud-tag');
    if (!btn) return;
    haptic();
    const tag = btn.dataset.tag;
    $('#search').value = tag;
    state.query = tag;
    render();
  });

  document.addEventListener('submit', async (e) => {
    if (e.target.id !== 'bm-form') return;
    e.preventDefault();
    const fd = new FormData(e.target);
    const url = fd.get('url').trim();
    let platform = fd.get('platform');
    if (!platform) platform = detectPlatform(url);
    const tags = fd.get('tags').split(',').map((s) => s.trim()).filter(Boolean);
    const record = { id: e.target.dataset.id || undefined, url, platform, title: fd.get('title').trim(), tags, note: fd.get('note').trim(), thumb: fd.get('thumb').trim() };
    await putBookmark(record);
    closeModal();
    await load();
    toast('已保存');
  });

  document.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'edit') {
      const id = e.target.closest('.modal').dataset.id;
      const bm = await getBookmark(id);
      openForm(bm);
    } else if (act === 'delete') {
      const modal = e.target.closest('.modal');
      const id = modal.dataset.id;
      if (confirm('确定删除这条收藏？')) {
        await deleteBookmark(id);
        closeModal();
        await load();
        toast('已删除');
      }
    }
  });

  $('#export-btn').addEventListener('click', async () => {
    const json = await exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `workbench-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('备份已下载');
  });

  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try { const text = await file.text(); const n = await importJSON(text); await load(); toast(`已导入 ${n} 条`); }
    catch (err) { toast('导入失败：' + err.message); }
    e.target.value = '';
  });

  // === Hub 事件 ===

  // 记录
  $('#capture-btn').addEventListener('click', async () => {
    const input = $('#capture-input');
    const text = input.value.trim();
    if (!text) { toast('请输入内容'); return; }
    const note = await captureNote(text);
    input.value = '';
    await refreshInboxList();
    await refreshSidebarStats();
    toast(`已记录：${(note.tags || []).slice(0, 3).join(', ')}`);
  });

  // 整理
  $('#compile-btn').addEventListener('click', async () => {
    const btn = $('#compile-btn');
    btn.textContent = '整理中...';
    btn.disabled = true;
    try {
      const result = await compileTopics();
      await refreshInboxList();
      await refreshTopicsList();
      await refreshSidebarStats();
      if (result.topics.length === 0) toast('暂无足够笔记可整理，多记录几条吧');
      else toast(`已整理 ${result.topics.length} 个话题，${result.merged} 条笔记`);
    } catch (err) { toast('整理失败'); }
    btn.textContent = '自动整理';
    btn.disabled = false;
  });

  // 提取
  $('#query-btn').addEventListener('click', async () => {
    const kw = $('#query-input').value.trim();
    if (!kw) { toast('请输入关键词'); return; }
    const notes = await queryNotes(kw);
    const el = $('#query-results');
    if (notes.length === 0) { el.innerHTML = '<p class="hub-hint">没有找到相关笔记</p>'; return; }
    el.innerHTML = notes.map((n) => `
      <div class="note-item" style="border-left-color:${n.status === 'compiled' ? '#4caf50' : 'var(--accent)'}">
        <div>${escapeHtml(n.body)}</div>
        ${n.topic ? `<div class="note-meta">📌 ${escapeHtml(n.topic)}</div>` : ''}
        <div class="note-tags">${(n.tags || []).map((t) => `<span class="note-tag">#${escapeHtml(t)}</span>`).join('')}</div>
        <div class="note-meta">${formatDate(n.createdAt)}</div>
      </div>`).join('');
  });

  // 分析
  $('#analyze-btn').addEventListener('click', async () => {
    const topic = $('#analyze-topic-select').value;
    if (!topic) { toast('请先选择话题'); return; }
    const notes = await queryNotes(topic);
    if (notes.length === 0) { toast('没有找到相关笔记'); return; }
    const result = await analyzeNotes(notes);
    const el = $('#analyze-results');
    el.innerHTML = `
      <div class="analyze-suggestion">💡 ${escapeHtml(result.suggestion)}</div>
      <p class="hub-hint" style="margin-top:6px">🔑 核心词：${escapeHtml(result.keywords)}</p>
      <div class="analyze-links">
        ${result.links.map((l) => `
          <a class="analyze-link" href="${escapeHtml(l.url)}" target="_blank" rel="noopener" style="--brand:${l.color}">
            <span>${l.emoji}</span>
            <span style="flex:1">${escapeHtml(l.name)}</span>
            <span>↗</span>
          </a>`).join('')}
      </div>`;
  });

  // hub tab 切换
  $('#hub-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.hub-tab');
    if (!tab) return;
    switchHubTab(tab.dataset.tab);
  });

  // 话题点击 → 跳转到提取面板
  $('#topics-list').addEventListener('click', async (e) => {
    const item = e.target.closest('.topic-item');
    if (!item) return;
    const topic = item.dataset.topic;
    $('#query-input').value = topic;
    switchHubTab('query');
    const notes = await queryNotes(topic);
    const el = $('#query-results');
    el.innerHTML = notes.map((n) => `
      <div class="note-item" style="border-left-color:#4caf50">
        <div>${escapeHtml(n.body)}</div>
        <div class="note-tags">${(n.tags || []).map((t) => `<span class="note-tag">#${escapeHtml(t)}</span>`).join('')}</div>
        <div class="note-meta">${formatDate(n.createdAt)}</div>
      </div>`).join('');
  });

  // 侧栏切换
  $('#sidebar-toggle').addEventListener('click', toggleSidebar);
  $('#mobile-sidebar-btn').addEventListener('click', showMobileSidebar);

  // 移动端底栏
  const bnNotes = $('#bn-notes');
  if (bnNotes) bnNotes.addEventListener('click', showMobileSidebar);

  // 窗口尺寸变化时处理响应式
  window.addEventListener('resize', () => {
    const sidebar = $('#sidebar');
    if (window.innerWidth >= 768) {
      sidebar.classList.remove('sidebar--open');
      const overlay = document.querySelector('.sidebar-overlay');
      if (overlay) overlay.remove();
    }
  });
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

async function init() {
  bindEvents();
  await load();
  await refreshSidebarStats();
  await refreshInboxList();
  appReady();
  registerSW();
}

init();
