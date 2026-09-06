import { $, escapeHtml } from '../utils.js';
import { state } from '../state.js';
import { STEPS } from '../config.js';
import { setMascot } from './render.js';
import { t } from '../i18n.js';
import { getExecutionLog, getTotalTokens, getAverageQuality } from '../observability.js';

function mediaUrl(p) {
  if (!p) return '';
  return p.startsWith('/api/media/') ? p : '/api/media/' + p;
}

function feedbackPanel(stepId, approveKey = 'ui.approve') {
  return `
    <div class="feedback-area" style="width:100%">
      <textarea id="feedbackInput" placeholder="${t('ui.feedbackPlaceholder')}"></textarea>
      <div class="feedback-hint">${t('ui.feedbackHint')}</div>
      <div class="action-row" style="margin-top:10px">
        <button class="action-btn primary" id="approveBtn">${t(approveKey)}</button>
        <button class="action-btn rose" id="reviseBtn">${t('ui.revise')}</button>
      </div>
    </div>
  `;
}

let _autoAdvanceTimer = null;

function autoAdvance(delay, callback) {
  const actions = $('#actionRow');
  if (actions) {
    actions.innerHTML = `<button class="action-btn primary" id="autoNextBtn">${t('ui.nextStep')}</button>`;
    const btn = $('#autoNextBtn');
    if (btn) btn.style.display = 'none';
  }
  _autoAdvanceTimer = setTimeout(callback, delay);
}

export function cancelAutoAdvance() {
  if (_autoAdvanceTimer != null) {
    clearTimeout(_autoAdvanceTimer);
    _autoAdvanceTimer = null;
  }
}

function bindFeedback(stepId, approveCallback) {
  const approveBtn = $('#approveBtn');
  const reviseBtn = $('#reviseBtn');
  if (approveBtn) approveBtn.addEventListener('click', approveCallback);
  if (reviseBtn) reviseBtn.addEventListener('click', () => {
    const feedback = $('#feedbackInput')?.value.trim();
    if (!feedback) { alert(t('ui.alertFeedback')); return; }
    window.__reviseStep(stepId, feedback);
  });
}

export function renderScript(data, onAdvance, readOnly = false) {
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
    if (state.mode === 'interactive') {
      $('#actionRow').innerHTML = feedbackPanel('script', 'ui.approveScript');
      bindFeedback('script', onAdvance);
    } else {
      autoAdvance(2000, onAdvance);
    }
  }
  setMascot('happy');
}

export function renderCharacterDesign(data, onAdvance, readOnly = false) {
  const el = $('#stepContent');
  const { isConfigured: dsConfigured } = getDashScopeStatus();

  const charCards = (data.characters || []).map(c => {
    const hasSheet = !!c.sheetPath;
    const sheet = c.sheetPath || c.imagePath;
    const caption = hasSheet ? t('ui.charDesignSheet') : (sheet ? t('ui.charDesignFront') : '');
    return `
    <div class="char-card">
      <div class="char-name">${escapeHtml(c.name)}</div>
      ${sheet
        ? `<img src="${mediaUrl(sheet)}" alt="${escapeHtml(c.name)}" style="width:100%;aspect-ratio:16/9;object-fit:contain;background:var(--bg2);border-radius:var(--radius-xs);margin:8px 0">`
        : `<div style="width:100%;aspect-ratio:16/9;background:var(--bg3);border-radius:var(--radius-xs);display:flex;align-items:center;justify-content:center;margin:8px 0;color:var(--cream3);font-size:0.75rem">${t('ui.charDesignNoImage')}</div>`}
      ${caption ? `<div style="font-size:0.7rem;color:var(--gold);margin-bottom:8px">${caption}</div>` : ''}
      <div class="char-desc" style="max-height:6em;overflow:auto">${escapeHtml(c.design || c.desc)}</div>
    </div>
  `;
  }).join('');

  const settingCards = (data.settings || []).map(s => `
    <div style="text-align:center">
      ${s.imagePath
        ? `<img src="${mediaUrl(s.imagePath)}" alt="${escapeHtml(s.name)}" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:var(--radius-xs);margin-bottom:8px">`
        : `<div style="width:100%;aspect-ratio:16/9;background:var(--bg3);border-radius:var(--radius-xs);display:flex;align-items:center;justify-content:center;color:var(--cream3);font-size:0.75rem">${t('ui.charDesignNoImage')}</div>`}
      <div style="font-size:0.85rem;color:var(--cream);font-weight:600">${escapeHtml(s.name)}</div>
      <div class="char-desc" style="max-height:6em;overflow:auto;text-align:left">${escapeHtml(s.design || s.desc)}</div>
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
    if (state.mode === 'interactive') {
      $('#actionRow').innerHTML = feedbackPanel('characterDesign', 'ui.approveCharacterDesign');
      bindFeedback('characterDesign', onAdvance);
    } else {
      autoAdvance(2000, onAdvance);
    }
  }
  setMascot('happy');
}

export function renderStoryboard(data, onAdvance, readOnly = false) {
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
    if (state.mode === 'interactive') {
      $('#actionRow').innerHTML = feedbackPanel('storyboard', 'ui.approveStoryboard');
      bindFeedback('storyboard', onAdvance);
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
  const el = $('#stepContent');
  const { isConfigured: dsConfigured } = getDashScopeStatus();

  const roleLabel = role => t(FRAME_ROLE_KEYS[role] || 'ui.frameFirst');
  const isChained = data?.mode === 'firstLastFrame';

  const frameThumb = (imagePath, alt, status) => (imagePath
    ? `<img src="${mediaUrl(imagePath)}" alt="${escapeHtml(alt)}" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:var(--radius-xs);margin-bottom:4px">`
    : `<div style="width:100%;aspect-ratio:16/9;background:var(--bg3);border-radius:var(--radius-xs);display:flex;align-items:center;justify-content:center;color:var(--cream3);font-size:0.7rem;margin-bottom:4px">${status === 'pending' ? t('ui.refImagesPending') : '—'}</div>`);

  const shots = (data.shots || []).map(sh => `
    <div style="text-align:center">
      ${frameThumb(sh.imagePath, sh.shot_id, sh.status)}
      <div style="display:flex;justify-content:space-between;gap:6px;font-size:0.7rem;color:var(--cream3)">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(sh.shot_id)}</span>
        <span style="color:var(--gold);white-space:nowrap">${roleLabel(sh.role)}</span>
      </div>
      ${isChained ? `<div style="font-size:0.68rem;color:var(--cream3);margin-top:2px;line-height:1.4">
        ${t('ui.refImagesLastFrameFrom')} <span style="color:var(--gold)">${sh.lastFrameFrom === 'generated'
          ? t('ui.refImagesLastFrameGenerated')
          : escapeHtml(t('ui.refImagesLastFrameReuse', { shot: sh.lastFrameFrom || '—' }))}</span>
      </div>` : ''}
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
  const el = $('#stepContent');
  const { isConfigured: dsConfigured } = getDashScopeStatus();

  const clips = (data.clips || []).map(clip => `
    <div style="text-align:center">
      ${clip.videoPath && clip.status === 'complete'
        ? `<video src="${mediaUrl(clip.videoPath)}" controls style="width:100%;aspect-ratio:16/9;border-radius:var(--radius-xs);margin-bottom:4px;background:#000"></video>`
        : `<div style="width:100%;aspect-ratio:16/9;background:var(--bg3);border-radius:var(--radius-xs);display:flex;align-items:center;justify-content:center;color:var(--cream3);font-size:0.7rem;margin-bottom:4px">${clip.status === 'pending' ? t('ui.videoGenPending') : '—'}</div>`}
      <div style="font-size:0.7rem;color:var(--cream3)">${escapeHtml(clip.shot_id)}</div>
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
  const el = $('#stepContent');
  const { isConfigured: dsConfigured } = getDashScopeStatus();

  const hasVideo = data.finalVideo && data.status === 'complete';

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
        : `<div style="color:var(--cream3);font-size:0.85rem;text-align:center;padding:40px 0">${data.status === 'no-clips' ? 'No video clips available' : data.status === 'failed' ? 'Render failed' : '—'}</div>`}
    </div>
    ${readOnly ? '' : '<div class="action-row" id="actionRow"></div>'}
  `;

  if (!readOnly) {
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
  try {
    const saved = localStorage.getItem('cine-cutie-dashscope');
    if (saved) {
      const cfg = JSON.parse(saved);
      return { isConfigured: !!cfg.apiKey };
    }
  } catch {}
  return { isConfigured: false };
}

export function renderExecutionLog() {
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
    const fallbackBadge = entry.fallbackUsed ? '<span class="log-badge fallback">FALLBACK</span>' : '';

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
  const el = $('#stepContent');
  const title = state.data.script?.title || 'Your Film';
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
      title: d.script?.title || 'Untitled',
      genre: d.script?.genre || 'Unknown',
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
