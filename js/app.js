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

// iOS 触觉反馈（轻震动）
function haptic(style = 'light') {
  try {
    if (navigator.vibrate) navigator.vibrate(style === 'medium' ? 10 : 4);
  } catch (_) { /* noop */ }
}

// 标记应用就绪：隐藏骨架屏
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

// 从文本中提取关键词作为建议标签
function suggestTags(text) {
  if (!text || text.length < 2) return [];
  // 用 Intl.Segmenter 分词，取出现频率最高的有意义词
  const seg =
    typeof Intl !== 'undefined' &&
    typeof Intl.Segmenter === 'function' &&
    (() => {
      try {
        return new Intl.Segmenter('zh', { granularity: 'word' });
      } catch (_) {
        return null;
      }
    })();
  const freq = new Map();
  const t = text.toLowerCase();
  if (seg) {
    for (const { segment, isWordLike } of seg.segment(t)) {
      if (isWordLike && segment.length >= 2 && segment.length <= 8) {
        freq.set(segment, (freq.get(segment) || 0) + 1);
      }
    }
  } else {
    // 回退：英文单词 + 中文 2-3 字词组
    const en = t.match(/[a-z]{3,}/g) || [];
    for (const w of en) freq.set(w, (freq.get(w) || 0) + 1);
    const cn = t.match(/[\u4e00-\u9fff]/g) || [];
    for (let i = 0; i < cn.length - 1; i++) {
      const bigram = cn[i] + cn[i + 1];
      freq.set(bigram, (freq.get(bigram) || 0) + 1);
    }
  }
  // 过滤常见停用词和无意义词
  const stop = new Set([
    '一个', '这个', '那个', '可以', '什么', '怎么', '如何', '为什么',
    '但是', '而且', '所以', '因为', '已经', '还是', '或者', '没有',
    '他们', '我们', '自己', '就是', '这样', '那样', '一样', '一下',
    '真的', '太', '很', '都', '也', '不', '了', '吗', '呢', '吧',
    '啊', '哦', '嗯', '在', '的', '是', '有', '和', '我', '你',
    '他', '她', '它', '这', '那', '看', '说', '来', '去', '到',
  ]);
  const sorted = [...freq.entries()]
    .filter(([w]) => !stop.has(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([w]) => w);
  return sorted;
}

// 清理剪贴板中多余的装饰文字（平台分享前缀等）
function cleanClipboardText(raw) {
  return raw
    .replace(/^(小红书|抖音|快手|微博|知乎|B站|bilibili|豆瓣|YouTube|Twitter|Instagram|TikTok)\s*[｜|\-—·:：\s]\s*/i, '')
    .replace(/[\n\r]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// 尝试读取剪贴板链接，自动识别平台、提取标题、建议标签
async function openFormWithClipboard() {
  closeModal();
  let prefill = {};
  try {
    const raw = await navigator.clipboard.readText();
    if (!raw) {
      document.body.appendChild(formModal(PLATFORMS, {}));
      return;
    }
    const urlMatch = raw.match(/https?:\/\/[^\s]+/);
    if (urlMatch) {
      const url = urlMatch[0];
      const platform = detectPlatform(url);
      // 去掉 URL 后剩下的就是标题/描述文字
      let rest = raw.replace(url, '').trim();
      rest = cleanClipboardText(rest);
      const tags = suggestTags(rest);
      prefill = { url, platform, title: rest, tags };
      const pname = platform ? getPlatform(platform)?.name : '';
      const detail = [pname, rest ? '标题' : '', tags.length ? `${tags.length}个标签` : '']
        .filter(Boolean)
        .join(' + ');
      toast(detail ? `已识别：${detail}` : `已识别链接：${pname || '未知平台'}`);
    }
  } catch (_) {
    // 剪贴板不可读（如 http 环境），静默回退到空白表单
  }
  document.body.appendChild(formModal(PLATFORMS, prefill));
}

// ---- 事件绑定 ----
function bindEvents() {
  // 打开详情
  document.addEventListener('open-bookmark', (e) => { haptic(); openDetail(e.detail); });

  // 添加按钮：读取剪贴板并弹出表单
  $('#add-btn').addEventListener('click', () => { haptic('medium'); openFormWithClipboard(); });
  // 底部导航栏的添加按钮
  const navAdd = $('#add-btn-nav');
  if (navAdd) navAdd.addEventListener('click', () => { haptic('medium'); openFormWithClipboard(); });

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
    haptic();
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
  appReady();
  registerSW();
}

init();
