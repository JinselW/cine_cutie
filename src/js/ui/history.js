import { memoryRequest, recordMemoryMessage, activeMemoryId, detachMemory, retryMemorySave } from '../memory.js';
import { state } from '../state.js';
import { STEPS, dataKeyOf } from '../config.js';
import { escapeHtml } from '../utils.js';
import { t } from '../i18n.js';
import '../../css/history.css';

const esc = value => escapeHtml(String(value ?? ''));
const getStatusLabel = status => {
  const map = {
    running: t('history.statusRunning'),
    completed: t('history.statusCompleted'),
    stopped: t('history.statusStopped'),
    paused: t('history.statusPaused'),
    failed: t('history.statusFailed'),
    saved: t('history.statusSaved'),
  };
  return map[status] || status;
};
const time = value => new Date(value).toLocaleString(state.lang === 'zh' ? 'zh-CN' : 'en-US');

function mediaPaths(value, found = new Set()) {
  if (typeof value === 'string' && /^\/api\/media\/(?:uploads\/)?[\w.%-]+$/.test(value)) found.add(value);
  else if (value && typeof value === 'object') Object.values(value).forEach(v => mediaPaths(v, found));
  return [...found];
}

function mediaHtml(value) {
  return mediaPaths(value).map(url => {
    const link = `<a href="${esc(url)}" target="_blank" rel="noopener">${t('history.openMedia')}</a>`;
    if (/\.(mp4|webm|mov)$/i.test(url)) return `<figure><video controls preload="metadata" src="${esc(url)}"></video>${link}</figure>`;
    if (/\.(png|jpg|jpeg|webp)$/i.test(url)) return `<figure><img loading="lazy" src="${esc(url)}" alt="${t('history.generatedMedia')}">${link}</figure>`;
    if (/\.(mp3|wav|ogg)$/i.test(url)) return `<figure><audio controls preload="none" src="${esc(url)}"></audio>${link}</figure>`;
    return link;
  }).join('');
}

export function initHistory() {
  const button = document.createElement('button');
  button.className = 'icon-btn';
  button.id = 'historyBtn';
  button.textContent = '🕘';
  button.title = t('history.title');
  button.setAttribute('aria-label', button.title);
  document.querySelector('.header-controls').prepend(button);
  const notice = document.createElement('button');
  notice.className = 'memory-notice hidden';
  notice.onclick = () => retryMemorySave();
  document.querySelector('#app').prepend(notice);
  const dialog = document.createElement('dialog');
  dialog.className = 'history-dialog';
  dialog.setAttribute('aria-label', t('history.title'));
  dialog.innerHTML = `<header><h2>${t('history.title')}</h2><button class="action-btn" data-close>${t('history.close')}</button></header>
    <p class="history-note">${t('history.note')}</p>
    <div class="history-tools"><input type="search" placeholder="${t('history.search')}" aria-label="${t('history.search')}"><button class="action-btn" data-refresh>${t('history.refresh')}</button></div>
    <p role="status" class="history-status"></p><div class="history-layout"><nav aria-label="${t('history.title')}"></nav><article><p>${t('history.selectRecord')}</p></article></div>`;
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
    status.textContent = t('history.reading');
    try {
      const records = await memoryRequest(`?q=${encodeURIComponent(dialog.querySelector('input').value)}`);
      if (number !== requestNumber) return;
      status.textContent = t('history.recordsCount', { count: records.length });
      list.innerHTML = records.length ? records.map(r => `<button class="history-card ${r.id === selected ? 'selected' : ''}" data-id="${esc(r.id)}"><strong>${esc(r.title)}</strong><span>${esc(time(r.createdAt))}</span><span>${esc(getStatusLabel(r.status))} · ${t('history.stepsWithResults', { steps: r.steps })}</span></button>`).join('') : `<p>${t('history.noRecords')}</p>`;
    } catch (error) { report(error); }
  }

  async function openRecord(id) {
    const number = ++detailNumber;
    try {
      const record = await memoryRequest(`/${id}`);
      if (number !== detailNumber) return;
      selected = id;
      const snap = record.snapshot || {};
      detail.innerHTML = `<h3>${esc(record.title)}</h3><p class="history-note">${esc(time(record.createdAt))} · ${esc(getStatusLabel(snap.status))}</p>
        <div class="history-tools"><button class="action-btn" data-rename>${t('history.rename')}</button><button class="action-btn" data-export>${t('history.export')}</button><button class="action-btn rose" data-delete>${t('history.delete')}</button></div>
        <h4>${t('history.userInput')}</h4><p class="history-text">${esc(snap.input?.userInput || t('history.fromPrompt'))}</p>
        <details><summary>${t('history.paramsAndPrompt')}</summary><pre>${esc(JSON.stringify(snap.input, null, 2))}</pre></details>
        ${STEPS.map(step => {
          const data = snap.data?.[dataKeyOf(step)];
          if (!data) return '';
          return `<details open><summary>${esc(step.icon)} ${esc(t(step.labelKey))}</summary><div class="history-media">${mediaHtml(data)}</div><pre>${esc(JSON.stringify(data, null, 2))}</pre></details>`;
        }).join('')}
        <details><summary>${t('history.sessionMessages', { count: snap.messages?.length || 0 })}</summary>${(snap.messages || []).map(m => `<p class="history-text"><small>${esc(time(m.at))} · ${esc(m.role)} ${esc(m.stepId || '')}</small><br>${esc(m.text)}</p>`).join('')}</details>
        <details><summary>${t('history.fullSnapshot')}</summary><pre>${esc(JSON.stringify({ configuration: snap.configuration, entities: snap.entities, acceptedByStep: snap.acceptedByStep, artifacts: snap.artifacts, checkpoint: snap.checkpoint, runState: snap.runState }, null, 2))}</pre></details>`;
      detail.querySelector('[data-export]').onclick = () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
        const a = document.createElement('a'); a.href = url; a.download = `cine-cutie-${id}.json`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
      detail.querySelector('[data-rename]').onclick = async () => {
        const title = prompt(t('history.newName'), record.title);
        if (!title?.trim()) return;
        try { await memoryRequest(`/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }); await openRecord(id); await refresh(); } catch (error) { report(error); }
      };
      detail.querySelector('[data-delete]').onclick = async () => {
        if (activeMemoryId() === id && ['running', 'paused'].includes(snap.status)) {
          status.textContent = t('history.stopFirst'); return;
        }
        if (!confirm(t('history.confirmDelete', { title: record.title }))) return;
        try {
          await memoryRequest(`/${id}`, { method: 'DELETE' }); detachMemory(id);
          selected = null; ++detailNumber; detail.innerHTML = `<p>${t('history.deleted')}</p>`; await refresh();
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
  window.addEventListener('languagechange', async () => {
    button.title = t('history.title');
    button.setAttribute('aria-label', button.title);
    dialog.setAttribute('aria-label', t('history.title'));
    dialog.querySelector('header h2').textContent = t('history.title');
    dialog.querySelector('[data-close]').textContent = t('history.close');
    dialog.querySelector(':scope > .history-note').textContent = t('history.note');
    const search = dialog.querySelector('input[type=search]');
    search.placeholder = t('history.search');
    search.setAttribute('aria-label', t('history.search'));
    dialog.querySelector('[data-refresh]').textContent = t('history.refresh');
    if (!dialog.open) return;
    await refresh();
    if (selected) await openRecord(selected);
    else detail.innerHTML = `<p>${t('history.selectRecord')}</p>`;
  });
  window.addEventListener('memory-status', e => {
    notice.textContent = e.detail.error ? t('history.retrySave', { error: e.detail.error }) : '';
    notice.classList.toggle('hidden', !e.detail.error);
    if (dialog.open) refresh();
  });
  window.addEventListener('agent-memory-message', e => {
    const text = document.createElement('div'); text.innerHTML = e.detail.text;
    recordMemoryMessage('agent', text.textContent, STEPS[state.currentStep]?.id);
  });
}
