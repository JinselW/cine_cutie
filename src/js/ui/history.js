import { memoryRequest, recordMemoryMessage, activeMemoryId, detachMemory, retryMemorySave } from '../memory.js';
import { state } from '../state.js';
import { STEPS, dataKeyOf } from '../config.js';
import { escapeHtml } from '../utils.js';
import '../../css/history.css';

const esc = value => escapeHtml(String(value ?? ''));
const labels = { running: '运行中 / 上次执行未结束', completed: '流程已结束', stopped: '已停止', paused: '已暂停', failed: '失败', saved: '已保存' };
const time = value => new Date(value).toLocaleString();

function mediaPaths(value, found = new Set()) {
  if (typeof value === 'string' && /^\/api\/media\/(?:uploads\/)?[\w.%-]+$/.test(value)) found.add(value);
  else if (value && typeof value === 'object') Object.values(value).forEach(v => mediaPaths(v, found));
  return [...found];
}

function mediaHtml(value) {
  return mediaPaths(value).map(url => {
    const link = `<a href="${esc(url)}" target="_blank" rel="noopener">打开素材</a>`;
    if (/\.(mp4|webm|mov)$/i.test(url)) return `<figure><video controls preload="metadata" src="${esc(url)}"></video>${link}</figure>`;
    if (/\.(png|jpg|jpeg|webp)$/i.test(url)) return `<figure><img loading="lazy" src="${esc(url)}" alt="历史生成素材">${link}</figure>`;
    if (/\.(mp3|wav|ogg)$/i.test(url)) return `<figure><audio controls preload="none" src="${esc(url)}"></audio>${link}</figure>`;
    return link;
  }).join('');
}

export function initHistory() {
  const button = document.createElement('button');
  button.className = 'icon-btn';
  button.id = 'historyBtn';
  button.textContent = '🕘';
  button.title = '创作历史 / History';
  button.setAttribute('aria-label', button.title);
  document.querySelector('.header-controls').prepend(button);
  const notice = document.createElement('button');
  notice.className = 'memory-notice hidden';
  notice.onclick = () => retryMemorySave();
  document.querySelector('#app').prepend(notice);
  const dialog = document.createElement('dialog');
  dialog.className = 'history-dialog';
  dialog.setAttribute('aria-label', '创作历史');
  dialog.innerHTML = `<header><h2>创作历史</h2><button class="action-btn" data-close>关闭</button></header>
    <p class="history-note">自动保存创作输入、修订反馈、工作流结果和生成素材引用。记录存于本机服务，所有访问此服务的用户共享。</p>
    <div class="history-tools"><input type="search" placeholder="搜索标题、故事或工作流内容" aria-label="搜索历史"><button class="action-btn" data-refresh>刷新</button></div>
    <p role="status" class="history-status"></p><div class="history-layout"><nav aria-label="历史记录列表"></nav><article><p>选择一条记录查看。</p></article></div>`;
  document.body.append(dialog);
  const list = dialog.querySelector('nav');
  const detail = dialog.querySelector('article');
  const status = dialog.querySelector('[role=status]');
  let selected = null;
  let requestNumber = 0;
  let detailNumber = 0;
  const report = error => { status.textContent = error.message; };

  async function refresh() {
    const number = ++requestNumber;
    status.textContent = '读取中…';
    try {
      const records = await memoryRequest(`?q=${encodeURIComponent(dialog.querySelector('input').value)}`);
      if (number !== requestNumber) return;
      status.textContent = `${records.length} 条记录`;
      list.innerHTML = records.length ? records.map(r => `<button class="history-card ${r.id === selected ? 'selected' : ''}" data-id="${esc(r.id)}"><strong>${esc(r.title)}</strong><span>${esc(time(r.createdAt))}</span><span>${esc(labels[r.status] || r.status)} · ${r.steps}/6 步有结果</span></button>`).join('') : '<p>暂无记录。开始一次创作后会自动保存。</p>';
    } catch (error) { report(error); }
  }

  async function openRecord(id) {
    const number = ++detailNumber;
    try {
      const record = await memoryRequest(`/${id}`);
      if (number !== detailNumber) return;
      selected = id;
      const snap = record.snapshot || {};
      detail.innerHTML = `<h3>${esc(record.title)}</h3><p class="history-note">${esc(time(record.createdAt))} · ${esc(labels[snap.status] || snap.status)}</p>
        <div class="history-tools"><button class="action-btn" data-rename>重命名</button><button class="action-btn" data-export>导出 JSON</button><button class="action-btn rose" data-delete>删除记录</button></div>
        <h4>创作输入</h4><p class="history-text">${esc(snap.input?.userInput || '通过提示词文件创作')}</p>
        <details><summary>创作参数与提示词文件</summary><pre>${esc(JSON.stringify(snap.input, null, 2))}</pre></details>
        ${STEPS.map(step => {
          const data = snap.data?.[dataKeyOf(step)];
          if (!data) return '';
          return `<details open><summary>${esc(step.icon)} ${esc(step.label)}</summary><div class="history-media">${mediaHtml(data)}</div><pre>${esc(JSON.stringify(data, null, 2))}</pre></details>`;
        }).join('')}
        <details><summary>会话与 Agent 消息 (${snap.messages?.length || 0})</summary>${(snap.messages || []).map(m => `<p class="history-text"><small>${esc(time(m.at))} · ${esc(m.role)} ${esc(m.stepId || '')}</small><br>${esc(m.text)}</p>`).join('')}</details>
        <details><summary>完整工作流快照、版本与尝试记录</summary><pre>${esc(JSON.stringify({ configuration: snap.configuration, entities: snap.entities, artifacts: snap.artifacts, checkpoint: snap.checkpoint, runState: snap.runState }, null, 2))}</pre></details>`;
      detail.querySelector('[data-export]').onclick = () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a'); a.href = url; a.download = `cine-cutie-${id}.json`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
      detail.querySelector('[data-rename]').onclick = async () => {
        const title = prompt('新的记录名称', record.title);
        if (!title?.trim()) return;
        try { await memoryRequest(`/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }); await openRecord(id); await refresh(); } catch (error) { report(error); }
      };
      detail.querySelector('[data-delete]').onclick = async () => {
        if (activeMemoryId() === id && ['running', 'paused'].includes(snap.status)) {
          status.textContent = '请先停止当前创作，再删除这条记录。'; return;
        }
        if (!confirm(`删除“${record.title}”？会话和工作流记录将永久删除，磁盘上的媒体文件会保留。`)) return;
        try {
          await memoryRequest(`/${id}`, { method: 'DELETE' }); detachMemory(id);
          selected = null; ++detailNumber; detail.innerHTML = '<p>记录已删除，媒体文件已保留。</p>'; await refresh();
        } catch (error) { report(error); }
      };
      list.querySelectorAll('[data-id]').forEach(b => b.classList.toggle('selected', b.dataset.id === id));
    } catch (error) { report(error); }
  }

  list.onclick = e => { const item = e.target.closest('[data-id]'); if (item) openRecord(item.dataset.id); };
  button.onclick = () => { dialog.showModal(); refresh(); };
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  dialog.addEventListener('close', () => detail.querySelectorAll('video,audio').forEach(m => m.pause()));
  dialog.querySelector('[data-refresh]').onclick = () => { refresh(); if (selected) openRecord(selected); };
  let searchTimer;
  dialog.querySelector('input').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(refresh, 250); };
  window.addEventListener('memory-status', e => {
    notice.textContent = e.detail.error ? `${e.detail.error}。点击重试保存` : '';
    notice.classList.toggle('hidden', !e.detail.error);
    if (dialog.open) refresh();
  });
  window.addEventListener('agent-memory-message', e => {
    const text = document.createElement('div'); text.innerHTML = e.detail.text;
    recordMemoryMessage('agent', text.textContent, STEPS[state.currentStep]?.id);
  });
}
