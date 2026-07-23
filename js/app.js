// 应用入口：状态管理、事件绑定、筛选/搜索、渲染编排
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
} from './ui.js';

const state = {
  all: [],
  filterPlatform: '',
  query: '',
};

const $ = (sel) => document.querySelector(sel);

async function load() {
  state.all = await getAllBookmarks();
  render();
}

function filtered() {
  const q = state.query.trim().toLowerCase();
  return state.all.filter((bm) => {
    if (state.filterPlatform && bm.platform !== state.filterPlatform) return false;
    if (!q) return true;
    const hay = [bm.title, bm.url, (bm.tags || []).join(' '), bm.note]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

function render() {
  // 平台筛选条
  const chipsHost = $('#chips');
  chipsHost.innerHTML = '';
  chipsHost.appendChild(
    platformChips(PLATFORMS, state.filterPlatform, (key) => {
      state.filterPlatform = key;
      render();
    })
  );

  // 标签云（取出现最多的若干标签）
  renderTagCloud();

  // 网格
  const grid = $('#grid');
  grid.innerHTML = '';
  const list = filtered();
  $('#count').textContent = `${list.length} / ${state.all.length}`;
  if (list.length === 0) {
    grid.innerHTML = `<div class="empty">${
      state.all.length === 0
        ? '还没有收藏，点右下角 ➕ 添加第一条灵感吧'
        : '没有匹配的内容，换个筛选试试'
    }</div>`;
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
    for (const t of bm.tags || []) {
      const k = t.toLowerCase();
      freq.set(k, (freq.get(k) || 0) + 1);
    }
  }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16);
  host.innerHTML = top.length
    ? top
        .map(
          ([t]) =>
            `<button class="cloud-tag" type="button" data-tag="${t}">#${t}</button>`
        )
        .join('')
    : '<span class="muted">收藏后打标签，这里会出现标签云</span>';
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

// 尝试读取剪贴板链接，自动识别平台预填表单
async function openFormWithClipboard() {
  closeModal();
  let prefill = {};
  try {
    const text = await navigator.clipboard.readText();
    const urlMatch = text.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      const url = urlMatch[0];
      const platform = detectPlatform(url);
      prefill = { url, platform };
      toast(`已识别链接：${platform ? getPlatform(platform)?.name || '' : '未知平台'}`);
    }
  } catch (_) {
    // 剪贴板不可读（如 http 环境），静默回退到空白表单
  }
  document.body.appendChild(formModal(PLATFORMS, prefill));
}

// ---- 事件绑定 ----
function bindEvents() {
  // 打开详情
  document.addEventListener('open-bookmark', (e) => openDetail(e.detail));

  // 添加按钮：读取剪贴板并弹出表单
  $('#add-btn').addEventListener('click', () => openFormWithClipboard());

  // 搜索框
  let qTimer = null;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    const v = e.target.value;
    qTimer = setTimeout(() => {
      state.query = v;
      render();
    }, 200);
  });

  // 标签云点击
  $('#tagcloud').addEventListener('click', (e) => {
    const btn = e.target.closest('.cloud-tag');
    if (!btn) return;
    const tag = btn.dataset.tag;
    $('#search').value = tag;
    state.query = tag;
    render();
  });

  // 表单提交（添加/编辑）
  document.addEventListener('submit', async (e) => {
    if (e.target.id !== 'bm-form') return;
    e.preventDefault();
    const fd = new FormData(e.target);
    const url = fd.get('url').trim();
    let platform = fd.get('platform');
    if (!platform) platform = detectPlatform(url);
    const tags = fd
      .get('tags')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const record = {
      id: e.target.dataset.id || undefined,
      url,
      platform,
      title: fd.get('title').trim(),
      tags,
      note: fd.get('note').trim(),
      thumb: fd.get('thumb').trim(),
    };
    await putBookmark(record);
    closeModal();
    await load();
    toast('已保存');
  });

  // 详情弹窗内的编辑/删除
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

  // 导出
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

  // 导入
  $('#import-btn').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const n = await importJSON(text);
      await load();
      toast(`已导入 ${n} 条`);
    } catch (err) {
      toast('导入失败：' + err.message);
    }
    e.target.value = '';
  });
}

// 注册 Service Worker
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

async function init() {
  bindEvents();
  await load();
  registerSW();
}

init();
