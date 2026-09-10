import { $, escapeHtml } from '../utils.js';
import { state } from '../state.js';
import { STEPS, dataKeyOf } from '../config.js';
import { setMascot } from './render.js';
import { t } from '../i18n.js';
import { getExecutionLog, getTotalTokens, getAverageQuality } from '../observability.js';
import { getConfig as getDashScopeConfig } from '../providers/image.js';
import { bindImageLightbox } from './lightbox.js';
import { mountEditor } from './structuredEditor.js';

// UI modules are also imported transitively by pure Node tests; defer browser-only setup there.
if (typeof document !== 'undefined') bindImageLightbox();

let currentViewRerender = null;

function rememberView(renderer) {
  currentViewRerender = renderer;
}

export function rerenderCurrentView() {
  if (!currentViewRerender) return false;
  currentViewRerender();
  return true;
}

function mediaUrl(p) {
  if (!p) return '';
  if (/^(?:https?:|data:|blob:)/i.test(p)) return p;
  return p.startsWith('/api/media/') ? p : '/api/media/' + p;
}

function feedbackPanel(stepId, approveKey = 'ui.approve', edit = null) {
  return `
    <div class="feedback-area" style="width:100%">
      <textarea id="feedbackInput" placeholder="${t('ui.feedbackPlaceholder')}"></textarea>
      <div class="feedback-hint">${t('ui.feedbackHint')}</div>
      <div class="action-row" style="margin-top:10px">
        <button class="action-btn primary" id="approveBtn">${t(approveKey)}</button>
        <button class="action-btn rose" id="reviseBtn">${t('ui.revise')}</button>
        ${edit ? `<button class="action-btn" id="editBtn">${t('ui.editDirectly')}</button>` : ''}
      </div>
    </div>
  `;
}

// Switches the step view into an editable form. Save commits a manual revision via
// applyManualEdit (which invalidates any downstream step that consumed the old
// version) then re-renders the step read view. Cancel restores the read view.
function bindEdit(stepId, data, onAdvance) {
  const editBtn = $('#editBtn');
  if (!editBtn) return;
  editBtn.addEventListener('click', () => {
    const step = STEPS.find(s => s.id === stepId);
    const renderFn = {
      script: renderScript,
      characterDesign: renderCharacterDesign,
      storyboard: renderStoryboard,
      referenceImages: renderReferenceImages,
      videoGeneration: renderVideoGeneration,
      postProduction: renderPostProduction,
    }[stepId];
    const title = step ? t(step.labelKey) : '';
    mountEditor($('#stepContent'), data, {
      title,
      onSave: async (edited) => {
        const res = await window.__applyManualEdit(stepId, edited);
        if (!res) {
          alert(t('ui.editInvalid'));
          return;
        }
        setMascot('happy');
        renderFn(state.data[dataKeyOf(step)], onAdvance);
      },
      onCancel: () => renderFn(state.data[dataKeyOf(step)] ?? data, onAdvance),
    });
  });
}

let _autoAdvanceTimer = null;
let _pendingAdvance = null;

function autoAdvance(delay, callback) {
  cancelAutoAdvance();
  const actions = $('#actionRow');
  if (actions) {
    actions.innerHTML = `<button class="action-btn primary" id="autoNextBtn">${t('ui.nextStep')}</button>`;
    const btn = $('#autoNextBtn');
    if (btn) btn.style.display = 'none';
  }
  _autoAdvanceTimer = setTimeout(() => {
    _autoAdvanceTimer = null;
    callback();
  }, delay);
}

export function scheduleAutoAdvance(delay, callback) {
  autoAdvance(delay, callback);
}

export function cancelAutoAdvance() {
  if (_autoAdvanceTimer != null) {
    clearTimeout(_autoAdvanceTimer);
    _autoAdvanceTimer = null;
  }
}

export function setPendingAdvance(fn) {
  _pendingAdvance = fn;
}

export function getPendingAdvance() {
  return _pendingAdvance;
}

export function clearPendingAdvance() {
  _pendingAdvance = null;
}

function bindFeedback(stepId, approveCallback, edit = null) {
  const approveBtn = $('#approveBtn');
  const reviseBtn = $('#reviseBtn');
  if (approveBtn) approveBtn.addEventListener('click', () => {
    if (typeof window.__approveStep === 'function') window.__approveStep(stepId, approveCallback);
    else approveCallback();
  });
  if (reviseBtn) reviseBtn.addEventListener('click', () => {
    const feedback = $('#feedbackInput')?.value.trim();
    if (!feedback) { alert(t('ui.alertFeedback')); return; }
    window.__reviseStep(stepId, feedback);
  });
  if (edit) bindEdit(stepId, edit.data, edit.onAdvance);
}

let _regenBusy = false;
async function handleRegenCharacterImage(btn) {
  if (_regenBusy) return;
  _regenBusy = true;
  const buttons = Array.from(document.querySelectorAll('#stepContent [data-regen-id]'));
  const regenHtml = `↻ ${escapeHtml(t('ui.regenerateImage'))}`;
  const kind = btn.dataset.regenKind;
  const id = btn.dataset.regenId;
  buttons.forEach(b => { b.disabled = true; });
  btn.innerHTML = escapeHtml(t('ui.regenerating'));
  const restore = () => buttons.forEach(b => { b.disabled = false; b.innerHTML = regenHtml; });
  try {
    const res = await window.__regenerateDesignItem({ kind, id });
    if (!res?.ok) { restore(); alert(`${t('ui.regenerateFailed')}${res?.error ? ` (${res.error})` : ''}`); }
  } catch (error) {
    restore();
    alert(error?.message || t('ui.regenerateFailed'));
  } finally {
    _regenBusy = false;
  }
}

export function renderScript(data, onAdvance, readOnly = false) {
  rememberView(() => renderScript(data, onAdvance, readOnly));
  const el = $('#stepContent');
  const chars = (data.characters || []).map(c => `
    <div class="char-card">
      <div class="char-name">${escapeHtml(c.name)}</div>
      <div class="char-desc">${escapeHtml(c.desc)}</div>
      <div style="font-size:0.75rem;color:var(--cream3);margin-top:4px;font-style:italic">${escapeHtml(c.appearance || '')}</div>
    </div>
  `).join('');

  const settings = (data.settings || []).map(s => `
    <div style="background:var(--bg3);border-radius:var(--radius-xs);padding:12px">
      <div style="font-size:0.85rem;color:var(--cream);font-weight:600">${escapeHtml(s.name)}</div>
      <div style="font-size:0.78rem;color:var(--cream3);margin-top:4px">${escapeHtml(s.desc)}</div>
    </div>
  `).join('');

  const episodes = (data.episodes || []).map(ep => `
    <div style="background:var(--bg3);border-radius:var(--radius-xs);padding:12px;margin-bottom:8px">
      <div style="font-size:0.85rem;color:var(--gold);font-weight:700">${escapeHtml(ep.title)}</div>
      <div style="font-size:0.78rem;color:var(--cream2);margin-top:4px">${escapeHtml(ep.summary)}</div>
      <div style="margin-top:8px">
        ${(ep.segments || []).map(seg => `
          <div style="font-size:0.75rem;color:var(--cream3);padding:2px 0">
            <span style="color:var(--cream2)">${escapeHtml(seg.title)}</span> — ${escapeHtml(seg.description)}
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  el.innerHTML = `
    <div class="result-card">
      <h3>${t('ui.scriptTitle', { title: escapeHtml(data.title) })}</h3>
      <div style="color:var(--cream2);font-size:0.85rem;margin-bottom:12px;font-style:italic">${escapeHtml(data.logline)}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        <div style="background:var(--bg3);border-radius:var(--radius-xs);padding:12px">
          <div style="font-size:0.75rem;color:var(--gold);font-weight:700;margin-bottom:4px">${t('ui.scriptCharacters')}</div>
          ${chars || '<div style="color:var(--cream3);font-size:0.8rem">—</div>'}
        </div>
        <div style="background:var(--bg3);border-radius:var(--radius-xs);padding:12px">
          <div style="font-size:0.75rem;color:var(--gold);font-weight:700;margin-bottom:4px">${t('ui.scriptSettings')}</div>
          ${settings || '<div style="color:var(--cream3);font-size:0.8rem">—</div>'}
        </div>
      </div>
      <div>
        <div style="font-size:0.75rem;color:var(--gold);font-weight:700;margin-bottom:8px">${t('ui.scriptEpisodes')}</div>
        ${episodes}
      </div>
    </div>
    ${readOnly ? '' : '<div class="action-row" id="actionRow"></div>'}
  `;

  if (!readOnly) {
    setPendingAdvance(onAdvance);
    if (state.mode === 'interactive') {
      const edit = { data, onAdvance };
      $('#actionRow').innerHTML = feedbackPanel('script', 'ui.approveScript', edit);
      bindFeedback('script', onAdvance, edit);
    } else {
      autoAdvance(2000, onAdvance);
    }
  }
  setMascot('happy');
}

export function renderCharacterDesign(data, onAdvance, readOnly = false) {
  rememberView(() => renderCharacterDesign(data, onAdvance, readOnly));
  const el = $('#stepContent');
  const { isConfigured: dsConfigured } = getDashScopeStatus();
  const showRegen = !readOnly && state.mode === 'interactive' && dsConfigured;
  const regenBtn = (kind, id) => showRegen
    ? `<button type="button" class="card-regen-btn" data-regen-kind="${kind}" data-regen-id="${escapeHtml(id)}" title="${escapeHtml(t('ui.regenerateImage'))}">↻ ${escapeHtml(t('ui.regenerateImage'))}</button>`
    : '';

  const charCards = (data.characters || []).map(c => {
    const hasSheet = !!c.sheetPath;
    const sheet = c.sheetPath || c.imagePath;
    const caption = hasSheet ? t('ui.charDesignSheet') : (sheet ? t('ui.charDesignFront') : '');
    return `
    <div class="char-card">
      <div class="char-name">${escapeHtml(c.name)}</div>
      ${sheet
        ? `<img src="${mediaUrl(sheet)}" alt="${escapeHtml(c.name)}" class="media-thumb" data-src="${mediaUrl(sheet)}" style="width:100%;aspect-ratio:16/9;object-fit:contain;background:var(--bg2);border-radius:var(--radius-xs);margin:8px 0">`
        : `<div style="width:100%;aspect-ratio:16/9;background:var(--bg3);border-radius:var(--radius-xs);display:flex;align-items:center;justify-content:center;margin:8px 0;color:var(--cream3);font-size:0.75rem">${t('ui.charDesignNoImage')}</div>`}
      ${caption ? `<div style="font-size:0.7rem;color:var(--gold);margin-bottom:8px">${caption}</div>` : ''}
      <div class="char-desc" style="max-height:6em;overflow:auto">${escapeHtml(c.design || c.desc)}</div>
      ${regenBtn('character', c.id)}
    </div>
  `;
  }).join('');

  const settingCards = (data.settings || []).map(s => `
    <div style="text-align:center">
      ${s.imagePath
        ? `<img src="${mediaUrl(s.imagePath)}" alt="${escapeHtml(s.name)}" class="media-thumb" data-src="${mediaUrl(s.imagePath)}" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:var(--radius-xs);margin-bottom:8px">`
        : `<div style="width:100%;aspect-ratio:16/9;background:var(--bg3);border-radius:var(--radius-xs);display:flex;align-items:center;justify-content:center;color:var(--cream3);font-size:0.75rem">${t('ui.charDesignNoImage')}</div>`}
      <div style="font-size:0.85rem;color:var(--cream);font-weight:600">${escapeHtml(s.name)}</div>
      <div class="char-desc" style="max-height:6em;overflow:auto;text-align:left">${escapeHtml(s.design || s.desc)}</div>
      ${regenBtn('setting', s.id)}
    </div>
  `).join('');

  el.innerHTML = `
    <div class="result-card">
      <h3>🎨 ${t('ui.charDesignTitle')}</h3>
      ${!dsConfigured ? `<div style="background:var(--bg3);border-radius:var(--radius-xs);padding:12px;margin-bottom:16px;color:var(--gold);font-size:0.85rem">${t('ui.charDesignConfigNeeded')}</div>` : ''}
      <div style="font-size:0.75rem;color:var(--gold);font-weight:700;margin-bottom:8px">${t('ui.charDesignCharacters')}</div>
      <div class="char-grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${charCards}</div>
    </div>
    <div class="result-card">
      <h3>${t('ui.charDesignSettings')}</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px">${settingCards}</div>
    </div>
    ${readOnly ? '' : '<div class="action-row" id="actionRow"></div>'}
  `;

  if (!readOnly) {
    setPendingAdvance(onAdvance);
    if (state.mode === 'interactive') {
      const edit = { data, onAdvance };
      $('#actionRow').innerHTML = feedbackPanel('characterDesign', 'ui.approveCharacterDesign', edit);
      bindFeedback('characterDesign', onAdvance, edit);
      el.querySelectorAll('[data-regen-id]').forEach(btn => {
        btn.addEventListener('click', () => handleRegenCharacterImage(btn));
      });
    } else {
      autoAdvance(2000, onAdvance);
    }
  }
  setMascot('happy');
}

export function renderStoryboard(data, onAdvance, readOnly = false) {
  rememberView(() => renderStoryboard(data, onAdvance, readOnly));
  const el = $('#stepContent');

  const episodes = (data.episodes || []).map(ep => {
    const shots = (ep.segments || []).flatMap((seg, si) =>
      (seg.shots || []).map((sh, shi) => `
        <div style="background:var(--bg3);border-radius:var(--radius-xs);padding:10px">
          <div style="font-size:0.75rem;color:var(--gold);font-weight:700">${t('ui.storyboardShot', { num: si + 1 })}</div>
          <div style="font-size:0.8rem;color:var(--cream);margin-top:4px">${escapeHtml(sh.description)}</div>
          <div style="font-size:0.7rem;color:var(--cream3);margin-top:4px">${escapeHtml(sh.type)} · ${escapeHtml(sh.camera)} · ${t('ui.storyboardDuration', { seconds: sh.duration })}</div>
        </div>
      `)
    ).join('');

    return `
      <div class="result-card">
        <h3>${t('ui.storyboardEpisode', { num: ep.episode })}</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">${shots}</div>
      </div>
    `;
  }).join('');

  el.innerHTML = `
    <div style="margin-bottom:8px;font-size:0.85rem;color:var(--cream2)">${t('ui.storyboardTitle')}</div>
    ${episodes}
    ${readOnly ? '' : '<div class="action-row" id="actionRow"></div>'}
  `;

  if (!readOnly) {
    setPendingAdvance(onAdvance);
    if (state.mode === 'interactive') {
      const edit = { data, onAdvance };
      $('#actionRow').innerHTML = feedbackPanel('storyboard', 'ui.approveStoryboard', edit);
      bindFeedback('storyboard', onAdvance, edit);
    } else {
      autoAdvance(2000, onAdvance);
    }
  }
  setMascot('happy');
}

const FRAME_ROLE_KEYS = {
  first_frame: 'ui.frameFirst',
  last_frame: 'ui.frameLast',
  reference_image: 'ui.frameReference',
};

export function renderReferenceImages(data, onAdvance, readOnly = false) {
  rememberView(() => renderReferenceImages(data, onAdvance, readOnly));
  const el = $('#stepContent');
  const { isConfigured: dsConfigured } = getDashScopeStatus();

  const roleLabel = role => t(FRAME_ROLE_KEYS[role] || 'ui.frameFirst');

  const frameThumb = (imagePath, alt, status) => (imagePath
    ? `<img src="${mediaUrl(imagePath)}" alt="${escapeHtml(alt)}" class="media-thumb" data-src="${mediaUrl(imagePath)}" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:var(--radius-xs);margin-bottom:4px">`
    : `<div style="width:100%;aspect-ratio:16/9;background:var(--bg3);border-radius:var(--radius-xs);display:flex;align-items:center;justify-content:center;color:var(--cream3);font-size:0.7rem;margin-bottom:4px">${status === 'pending' ? t('ui.refImagesPending') : '—'}</div>`);

  const shots = (data.shots || []).map(sh => `
    <div style="text-align:center">
      <div style="display:grid;grid-template-columns:${sh.lastFramePath || sh.lastFrameUrl ? '1fr 1fr' : '1fr'};gap:6px">
        <div>
          ${frameThumb(sh.imagePath || sh.imageUrl, `${sh.shot_id} ${roleLabel(sh.role)}`, sh.status)}
          <div style="font-size:0.66rem;color:var(--cream3)">${roleLabel(sh.role)}</div>
        </div>
        ${sh.lastFramePath || sh.lastFrameUrl ? `<div>
          ${frameThumb(sh.lastFramePath || sh.lastFrameUrl, `${sh.shot_id} ${t('ui.frameLast')}`, sh.status)}
          <div style="font-size:0.66rem;color:var(--cream3)">${t('ui.frameLast')}</div>
        </div>` : ''}
      </div>
      <div style="display:flex;justify-content:space-between;gap:6px;font-size:0.7rem;color:var(--cream3)">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(sh.shot_id)}</span>
        <span style="color:var(--gold);white-space:nowrap">${t('settings.videoMode.' + (sh.videoMode || 'firstFrame'))}</span>
      </div>
      ${sh.videoModeReason ? `<div title="${escapeHtml(sh.videoModeReason)}" style="font-size:0.66rem;color:var(--cream3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(sh.videoModeReason)}</div>` : ''}
    </div>
  `).join('');

  const extras = (data.extraFrames || []).length ? `
    <div style="margin-top:18px">
      <div style="font-size:0.8rem;color:var(--gold);margin-bottom:8px">${t('ui.refImagesExtraFrames')}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">
        ${data.extraFrames.map(fr => `
          <div style="text-align:center">
            ${frameThumb(fr.imagePath, fr.id, fr.status)}
            <div style="font-size:0.7rem;color:var(--cream3)">${roleLabel(fr.role)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  el.innerHTML = `
    <div class="result-card">
      <h3>🖼️ ${t('ui.refImagesTitle')}</h3>
      ${data?.mode ? `<div style="font-size:0.8rem;color:var(--cream3);margin-bottom:12px">${t('ui.refImagesModeLabel')} <span style="color:var(--gold)">${escapeHtml(t('settings.videoMode.' + data.mode))}</span></div>` : ''}
      ${!dsConfigured ? `<div style="background:var(--bg3);border-radius:var(--radius-xs);padding:12px;margin-bottom:16px;color:var(--gold);font-size:0.85rem">${t('ui.refImagesConfigNeeded')}</div>` : ''}
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">${shots}</div>
      ${extras}
    </div>
    ${readOnly ? '' : '<div class="action-row" id="actionRow"></div>'}
  `;

  if (!readOnly) {
    setPendingAdvance(onAdvance);
    if (state.mode === 'interactive') {
      $('#actionRow').innerHTML = feedbackPanel('referenceImages', 'ui.approveReferenceImages');
      bindFeedback('referenceImages', onAdvance);
    } else {
      autoAdvance(2000, onAdvance);
    }
  }
  setMascot('happy');
}

export function renderVideoGeneration(data, onAdvance, readOnly = false) {
  rememberView(() => renderVideoGeneration(data, onAdvance, readOnly));
  const el = $('#stepContent');
  const { isConfigured: dsConfigured } = getDashScopeStatus();

  const clips = (data.clips || []).map(clip => `
    <div style="text-align:center">
      ${clip.videoPath && clip.status === 'complete'
        ? `<video src="${mediaUrl(clip.videoPath)}" controls style="width:100%;aspect-ratio:16/9;border-radius:var(--radius-xs);margin-bottom:4px;background:#000"></video>`
        : `<div style="width:100%;aspect-ratio:16/9;background:var(--bg3);border-radius:var(--radius-xs);display:flex;align-items:center;justify-content:center;color:var(--cream3);font-size:0.7rem;margin-bottom:4px">${clip.status === 'pending' ? t('ui.videoGenPending') : '—'}</div>`}
      <div style="display:flex;justify-content:space-between;gap:6px;font-size:0.7rem;color:var(--cream3)">
        <span>${escapeHtml(clip.shot_id)}</span>
        <span style="color:var(--gold)">${t('settings.videoMode.' + (clip.videoMode || 'firstFrame'))}</span>
      </div>
    </div>
  `).join('');

  el.innerHTML = `
    <div class="result-card">
      <h3>🎥 ${t('ui.videoGenTitle')}</h3>
      ${data?.mode ? `<div style="font-size:0.8rem;color:var(--cream3);margin-bottom:12px">${t('settings.videoModeLabel')}: <span style="color:var(--gold)">${escapeHtml(t('settings.videoMode.' + data.mode))}</span></div>` : ''}
      ${!dsConfigured ? `<div style="background:var(--bg3);border-radius:var(--radius-xs);padding:12px;margin-bottom:16px;color:var(--gold);font-size:0.85rem">${t('ui.videoGenConfigNeeded')}</div>` : ''}
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px">${clips}</div>
    </div>
    ${readOnly ? '' : '<div class="action-row" id="actionRow"></div>'}
  `;

  if (!readOnly) {
    setPendingAdvance(onAdvance);
    if (state.mode === 'interactive') {
      $('#actionRow').innerHTML = feedbackPanel('videoGeneration', 'ui.approveVideoGeneration');
      bindFeedback('videoGeneration', onAdvance);
    } else {
      autoAdvance(2000, onAdvance);
    }
  }
  setMascot('happy');
}

export function renderPostProduction(data, onAdvance, readOnly = false) {
  rememberView(() => renderPostProduction(data, onAdvance, readOnly));
  const el = $('#stepContent');
  const { isConfigured: dsConfigured } = getDashScopeStatus();

  const hasVideo = data.finalVideo && data.status === 'complete';
  const qc = data.qcBaseline;
  const checks = Array.isArray(qc?.deliveryChecks) ? qc.deliveryChecks : [];
  const formatQcValue = value => {
    if (value == null) return '';
    if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
    if (typeof value === 'object') return Object.entries(value)
      .filter(([, item]) => item != null)
      .map(([key, item]) => `${key}: ${typeof item === 'number' ? Math.round(item * 100) / 100 : item}`)
      .join(' · ');
    return String(value);
  };
  const qcReport = qc?.deliveryVerdict ? `
    <section class="delivery-qc delivery-qc-${String(qc.deliveryVerdict).toLowerCase()}">
      <div class="delivery-qc-head">
        <div><span class="delivery-qc-icon">${qc.deliveryVerdict === 'PASS' ? '✓' : qc.deliveryVerdict === 'FAIL' ? '!' : '△'}</span>
          <strong>${t('deliveryQC.title')}</strong></div>
        <span class="delivery-qc-verdict">${escapeHtml(t('deliveryQC.verdict.' + qc.deliveryVerdict))}</span>
      </div>
      ${checks.length ? `<div class="delivery-qc-grid">${checks.map(item => `
        <div class="delivery-qc-check delivery-qc-check-${String(item.status).toLowerCase()}">
          <span class="delivery-qc-check-mark">${item.status === 'PASS' ? '✓' : item.status === 'FAIL' ? '×' : '!'}</span>
          <div><strong>${escapeHtml(t('deliveryQC.check.' + item.id))}</strong>
            <small>${escapeHtml(item.message || '')}${item.actual != null ? ` · ${escapeHtml(formatQcValue(item.actual))}` : ''}</small>
          </div>
        </div>`).join('')}</div>` : `<p class="delivery-qc-legacy">${t('deliveryQC.legacy')}</p>`}
      ${qc.repairPlan ? `<div class="delivery-qc-repair"><strong>${t('deliveryQC.repair')}</strong> ${escapeHtml(t('steps.' + qc.repairPlan.targetStep + '.label'))} — ${escapeHtml(qc.repairPlan.reason || '')}</div>` : ''}
    </section>` : '';
  const compliance = data.complianceReport;
  const complianceReport = compliance ? `
    <section class="delivery-qc delivery-qc-${String(compliance.verdict || 'CONDITIONAL_PASS').toLowerCase()}">
      <div class="delivery-qc-head">
        <div><span class="delivery-qc-icon">⚖</span> <strong>${t('complianceReport.title')}</strong></div>
        <span class="delivery-qc-verdict">${escapeHtml(t('deliveryQC.verdict.' + compliance.verdict))}</span>
      </div>
      <div class="delivery-qc-grid">${(compliance.checks || []).map(check => `
        <div class="delivery-qc-check"><span class="delivery-qc-check-mark">${check.verdict === 'PASS' ? '✓' : check.verdict === 'FAIL' ? '×' : '!'}</span>
          <div><strong>${escapeHtml(check.name)}</strong><small>${escapeHtml(check.status)}${check.visual?.scope?.sampledFrames != null ? ` · ${escapeHtml(String(check.visual.scope.sampledFrames))} frames` : ''}</small>
            ${check.visual?.checks?.length ? `<small>${escapeHtml(check.visual.checks.map(item => `${item.checker?.name || item.id}: ${item.status}${item.reason ? ` (${item.reason})` : ''}`).join(' · '))}</small>` : ''}
            ${(check.issues || []).length ? `<small>${escapeHtml(check.issues.join('；'))}</small>` : ''}</div>
        </div>`).join('')}</div>
      <p class="delivery-qc-legacy">${escapeHtml(t('complianceReport.summary', {
        findings: compliance.summary?.findingCount || 0,
        blocks: compliance.summary?.blockingFindings || 0,
      }))}</p>
      ${(compliance.recommendations || []).length ? `<div class="delivery-qc-repair"><strong>${t('complianceReport.review')}</strong> ${escapeHtml(compliance.recommendations.join('；'))}</div>` : ''}
      ${(compliance.sourceRights || []).length ? `<details><summary>${escapeHtml(t('complianceReport.sourceRights'))}</summary><div class="delivery-qc-grid">${compliance.sourceRights.map(asset => `<div class="delivery-qc-check"><span class="delivery-qc-check-mark">${asset.status === 'DECLARED' ? '✓' : '!'}</span><div><strong>${escapeHtml(asset.name || asset.kind)}</strong><small>${escapeHtml(`${asset.status} · source: ${asset.source || 'unknown'} · license: ${asset.license || 'unknown'}`)}</small></div></div>`).join('')}</div></details>` : ''}
      ${compliance.sha256 ? `<small title="${escapeHtml(compliance.sha256)}">SHA-256: ${escapeHtml(compliance.sha256.slice(0, 16))}…</small>` : ''}
    </section>` : '';

  const soundPlan = data.soundPlan;
  const audioResult = data.audioResult;
  const soundPlanReport = soundPlan?.shots?.length ? `
    <section class="delivery-qc delivery-qc-pass">
      <div class="delivery-qc-head">
        <div><span class="delivery-qc-icon">♪</span> <strong>${t('soundPlan.title')}</strong></div>
        <span class="delivery-qc-verdict">${audioResult ? `${audioResult.success || 0}/${audioResult.total || 0} ${t('soundPlan.generated')}` : t('soundPlan.noAudio')}</span>
      </div>
      <div class="delivery-qc-grid">${soundPlan.shots.map((shot, i) => {
        const hasText = shot.dialogue || shot.narratorText;
        const hasSfx = shot.ambiencePrompt || (shot.soundEffects && shot.soundEffects.length);
        return `<div class="delivery-qc-check delivery-qc-check-pass">
          <span class="delivery-qc-check-mark">${hasText || hasSfx ? '✓' : '—'}</span>
          <div><strong>${escapeHtml(shot.shotId || `shot_${i}`)}</strong>
            <small>${hasText ? `${shot.speakerId ? t('soundPlan.dialogue') : t('soundPlan.narration')}: ${escapeHtml((shot.dialogue || shot.narratorText || '').slice(0, 60))}` : ''}${hasSfx ? ` · ${t('soundPlan.ambience')}: ${escapeHtml((shot.ambiencePrompt || '').slice(0, 40))}` : ''}</small>
            <small>${shot.musicMood ? `${t('soundPlan.music')}: ${escapeHtml(shot.musicMood)}` : ''} · ${shot.duration || '?'}s</small>
          </div>
        </div>`;
      }).join('')}</div>
    </section>` : '';

  el.innerHTML = `
    <div class="result-card">
      <h3>🎬 ${t('ui.postProdTitle')}</h3>
      ${!dsConfigured
        ? `<div style="background:var(--bg3);border-radius:var(--radius-xs);padding:12px;margin-bottom:16px;color:var(--gold);font-size:0.85rem">${t('ui.postProdConfigNeeded')}</div>`
        : ''}
      ${hasVideo
        ? `<div style="text-align:center">
            <video src="${mediaUrl(data.finalVideo)}" controls style="width:100%;max-width:800px;border-radius:var(--radius-xs);margin-bottom:16px;background:#000"></video>
            <a href="${mediaUrl(data.finalVideo)}" download class="action-btn primary">${t('ui.postProdDownload')}</a>
          </div>`
        : `<div style="color:var(--cream3);font-size:0.85rem;text-align:center;padding:40px 0">${data.status === 'no-clips' ? t('ui.postProdNoClips') : data.status === 'failed' ? t('ui.postProdFailed') : '—'}</div>`}
      ${qcReport}
      ${complianceReport}
      ${soundPlanReport}
    </div>
    ${readOnly ? '' : '<div class="action-row" id="actionRow"></div>'}
  `;

  if (!readOnly) {
    setPendingAdvance(onAdvance);
    if (state.mode === 'interactive') {
      $('#actionRow').innerHTML = feedbackPanel('postProduction', 'ui.approvePostProduction');
      bindFeedback('postProduction', onAdvance);
    } else {
      autoAdvance(2000, onAdvance);
    }
  }
  setMascot('happy');
}

function getDashScopeStatus() {
  const cfg = getDashScopeConfig();
  return { isConfigured: !!cfg.apiKey };
}

export function renderExecutionLog() {
  rememberView(() => renderExecutionLog());
  const el = $('#stepContent');
  const log = getExecutionLog();
  const totalTokens = getTotalTokens();
  const avgQuality = getAverageQuality();

  let rows = '';
  log.forEach(entry => {
    const step = STEPS.find(s => s.id === entry.stepId);
    const label = step ? t(step.labelKey) : entry.stepId;
    const scoreDisplay = entry.qualityScore != null
      ? `<span style="color:${entry.qualityScore >= 8 ? '#00e5a0' : entry.qualityScore >= 7 ? 'var(--gold)' : 'var(--rose)'}">${entry.qualityScore.toFixed(1)}</span>`
      : '—';
    const tokensTotal = entry.tokens.prompt + entry.tokens.completion;
    const tokensDisplay = tokensTotal > 0 ? tokensTotal.toLocaleString() : '—';
    const retryDisplay = entry.retryCount > 0 ? entry.retryCount : '—';
    const fallbackBadge = entry.fallbackUsed ? `<span class="log-badge fallback">${t('log.fallback').toUpperCase()}</span>` : '';

    rows += `
      <tr>
        <td>${step?.icon || ''} ${escapeHtml(label)}</td>
        <td>${escapeHtml(entry.agentName)}</td>
        <td>${entry.duration}s</td>
        <td>${tokensDisplay}</td>
        <td>${scoreDisplay}</td>
        <td>${retryDisplay}</td>
        <td>${fallbackBadge || '—'}</td>
      </tr>
    `;
  });

  const totalTokensAll = totalTokens.prompt + totalTokens.completion;
  const qualityDisplay = avgQuality != null ? avgQuality.toFixed(1) + '/10' : '—';

  el.innerHTML = `
    <div class="result-card">
      <h3>📊 ${t('log.title')}</h3>
      <div class="log-summary">
        <div class="log-stat">
          <div class="log-stat-value">${log.length}</div>
          <div class="log-stat-label">${t('log.stepsCompleted')}</div>
        </div>
        <div class="log-stat">
          <div class="log-stat-value">${totalTokensAll > 0 ? totalTokensAll.toLocaleString() : '—'}</div>
          <div class="log-stat-label">${t('log.totalTokens')}</div>
        </div>
        <div class="log-stat">
          <div class="log-stat-value">${qualityDisplay}</div>
          <div class="log-stat-label">${t('log.avgQuality')}</div>
        </div>
        <div class="log-stat">
          <div class="log-stat-value">${log.reduce((s, e) => s + e.duration, 0).toFixed(1)}s</div>
          <div class="log-stat-label">${t('log.totalDuration')}</div>
        </div>
      </div>
      <table class="log-table">
        <thead>
          <tr>
            <th>${t('log.step')}</th>
            <th>${t('log.agent')}</th>
            <th>${t('log.duration')}</th>
            <th>${t('log.tokens')}</th>
            <th>${t('log.quality')}</th>
            <th>${t('log.retries')}</th>
            <th>${t('log.fallback')}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="action-row" id="actionRow">
      <button class="action-btn primary" id="backBtn">${t('log.back')}</button>
    </div>
  `;

  $('#backBtn').addEventListener('click', () => {
    if (state.currentStep >= STEPS.length) {
      showCompletion();
    } else {
      renderPostProduction(state.data.finalVideo || {}, () => {});
    }
  });
}

export function showCompletion() {
  rememberView(() => showCompletion());
  const el = $('#stepContent');
  const title = state.data.script?.title || t('ui.defaultFilmTitle');
  const finalVideo = state.data.finalVideo;
  const hasVideo = finalVideo?.finalVideo && finalVideo?.status === 'complete';

  el.innerHTML = `
    <div class="completion">
      <div class="big-icon">🎉</div>
      <h2>${escapeHtml(title)}</h2>
      <p>${t('ui.filmComplete')}</p>
      ${hasVideo ? `<video src="${mediaUrl(finalVideo.finalVideo)}" controls style="width:100%;max-width:800px;border-radius:var(--radius-xs);margin:16px auto;background:#000"></video>` : ''}
      <div style="margin-top:24px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="action-btn primary" onclick="location.reload()">${t('ui.createAnother')}</button>
        <button class="action-btn" id="exportBtn">${t('ui.exportProject')}</button>
        <button class="action-btn" id="logBtn">📊 ${t('log.viewLog')}</button>
        ${hasVideo ? `<a href="${mediaUrl(finalVideo.finalVideo)}" download class="action-btn">${t('ui.postProdDownload')}</a>` : ''}
      </div>
    </div>
  `;
  setMascot('happy');

  $('#exportBtn').addEventListener('click', () => {
    const d = state.data;
    const exportData = {
      title: d.script?.title || t('ui.untitled'),
      genre: d.script?.genre || t('ui.unknown'),
      characters: d.script?.characters || [],
      settings: d.script?.settings || [],
      episodes: d.script?.episodes || [],
      storyboard: d.storyboard || null,
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${exportData.title.replace(/\s+/g, '_')}_project.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $('#logBtn').addEventListener('click', () => {
    renderExecutionLog();
  });
}
