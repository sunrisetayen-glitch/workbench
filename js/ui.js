// 纯渲染辅助：构建卡片、平台筛选、详情弹窗、搜索链接卡片的 DOM
import { getPlatform } from './platforms.js';

export function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 单张收藏卡片
export function bookmarkCard(bm) {
  const p = getPlatform(bm.platform);
  const color = p ? p.color : '#888';
  const emoji = p ? p.emoji : '🔖';
  const pname = p ? p.name : '其他';
  const tags = (bm.tags || [])
    .filter(Boolean)
    .map((t) => `<span class="tag">#${escapeHtml(t)}</span>`)
    .join('');
  const thumb = bm.thumb
    ? `<img class="card-thumb" src="${escapeHtml(bm.thumb)}" alt="" loading="lazy" onerror="this.style.display='none'">`
    : `<div class="card-thumb card-thumb--placeholder" style="background:${color}22">${emoji}</div>`;

  const el = document.createElement('article');
  el.className = 'card';
  el.style.setProperty('--brand', color);
  el.dataset.id = bm.id;
  el.innerHTML = `
    ${thumb}
    <div class="card-body">
      <div class="card-platform"><span class="plat-badge" style="background:${color}">${emoji}</span>${escapeHtml(pname)}</div>
      <h3 class="card-title">${escapeHtml(bm.title || bm.url || '未命名')}</h3>
      <div class="card-tags">${tags}</div>
    </div>`;
  el.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('open-bookmark', { detail: bm.id }));
  });
  return el;
}

// 平台筛选条
export function platformChips(platforms, active, onPick) {
  const wrap = document.createElement('div');
  wrap.className = 'chips';
  const mk = (key, label, color, emoji) => {
    const b = document.createElement('button');
    b.className = 'chip' + (active === key ? ' chip--active' : '');
    b.type = 'button';
    b.style.setProperty('--brand', color || '#666');
    b.innerHTML = `${emoji ? emoji + ' ' : ''}${escapeHtml(label)}`;
    b.addEventListener('click', () => onPick(key));
    return b;
  };
  wrap.appendChild(mk('', '全部', '#666', '✦'));
  for (const p of platforms) wrap.appendChild(mk(p.key, p.name, p.color, p.emoji));
  return wrap;
}

// 详情弹窗内容
export function detailModal(bm, similar, searchLinks) {
  const p = getPlatform(bm.platform);
  const color = p ? p.color : '#888';
  const emoji = p ? p.emoji : '🔖';
  const pname = p ? p.name : '其他';
  const tags = (bm.tags || [])
    .filter(Boolean)
    .map((t) => `<span class="tag">#${escapeHtml(t)}</span>`)
    .join('') || '<span class="muted">无标签</span>';

  const similarHtml = similar.length
    ? similar
        .map(
          (s) => `
      <button class="sim-item" data-id="${s.bookmark.id}" type="button">
        <span class="sim-emoji">${getPlatform(s.bookmark.platform)?.emoji || '🔖'}</span>
        <span class="sim-title">${escapeHtml(s.bookmark.title || s.bookmark.url)}</span>
        <span class="sim-score">${Math.round(s.score * 100)}%</span>
      </button>`
        )
        .join('')
    : '<p class="muted">库里还没有相似内容，多收藏一些就会出现～</p>';

  const searchHtml = searchLinks.length
    ? searchLinks
        .map(
          (l) => `
      <a class="search-link" href="${escapeHtml(l.url)}" target="_blank" rel="noopener" style="--brand:${l.color}">
        <span class="sl-emoji">${l.emoji}</span>
        <span class="sl-name">${escapeHtml(l.name)}</span>
        <span class="sl-go">↗</span>
      </a>`
        )
        .join('')
    : '<p class="muted">没有可用的搜索关键词</p>';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" data-id="${escapeHtml(bm.id)}">
      <button class="modal-close" type="button" aria-label="关闭">×</button>
      <div class="modal-head" style="--brand:${color}">
        <span class="plat-badge" style="background:${color}">${emoji}</span>
        <span class="modal-plat">${escapeHtml(pname)}</span>
      </div>
      <h2 class="modal-title">${escapeHtml(bm.title || '未命名')}</h2>
      ${tags ? `<div class="card-tags">${tags}</div>` : ''}
      ${bm.note ? `<p class="modal-note">${escapeHtml(bm.note)}</p>` : ''}
      <div class="modal-actions">
        ${bm.url ? `<a class="btn btn--primary" href="${escapeHtml(bm.url)}" target="_blank" rel="noopener">打开原帖 ↗</a>` : ''}
        <button class="btn btn--ghost" data-act="edit" type="button">编辑</button>
        <button class="btn btn--danger" data-act="delete" type="button">删除</button>
      </div>

      <section class="modal-section">
        <h4>📚 库内相似内容</h4>
        <div class="similar-list">${similarHtml}</div>
      </section>

      <section class="modal-section">
        <h4>🌐 各平台搜索类似内容</h4>
        <div class="search-links">${searchHtml}</div>
      </section>
    </div>`;

  // 关闭交互
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('.modal-close')) {
      closeModal();
    }
    const sim = e.target.closest('.sim-item');
    if (sim) {
      document.dispatchEvent(new CustomEvent('open-bookmark', { detail: sim.dataset.id }));
    }
  });
  return overlay;
}

export function closeModal() {
  const ex = document.querySelector('.modal-overlay');
  if (ex) ex.remove();
}

// 添加/编辑表单弹窗
export function formModal(platforms, initial) {
  const init = initial || {};
  const options = platforms
    .map(
      (p) =>
        `<option value="${p.key}" ${init.platform === p.key ? 'selected' : ''}>${p.emoji} ${escapeHtml(p.name)}</option>`
    )
    .join('');
  const tagsVal = (init.tags || []).join(', ');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal--form" role="dialog" aria-modal="true">
      <button class="modal-close" type="button" aria-label="关闭">×</button>
      <h2 class="modal-title">${init.id ? '编辑收藏' : '添加收藏'}</h2>
      <form id="bm-form" class="bm-form"${init.id ? ` data-id="${escapeHtml(init.id)}"` : ''}>
        <label>链接
          <input name="url" type="url" placeholder="https://..." value="${escapeHtml(init.url || '')}" required>
        </label>
        <label>平台
          <select name="platform">${options}</select>
        </label>
        <label>标题 / 描述
          <input name="title" type="text" placeholder="这条内容讲的是什么" value="${escapeHtml(init.title || '')}">
        </label>
        <label>标签（逗号分隔）
          <input name="tags" type="text" placeholder="选题, 文案, 拍摄技巧" value="${escapeHtml(tagsVal)}">
        </label>
        <label>缩略图 URL（可选）
          <input name="thumb" type="url" placeholder="https://.../img.jpg" value="${escapeHtml(init.thumb || '')}">
        </label>
        <label>笔记 / 灵感
          <textarea name="note" rows="3" placeholder="为什么收藏？能借鉴什么？">${escapeHtml(init.note || '')}</textarea>
        </label>
        <div class="modal-actions">
          <button class="btn btn--primary" type="submit">${init.id ? '保存' : '添加'}</button>
          <button class="btn btn--ghost" type="button" data-act="cancel">取消</button>
        </div>
      </form>
    </div>`;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('.modal-close') || e.target.closest('[data-act="cancel"]')) {
      closeModal();
    }
  });
  return overlay;
}

// 轻提示
let toastTimer = null;
export function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('toast--show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('toast--show'), 2200);
}
