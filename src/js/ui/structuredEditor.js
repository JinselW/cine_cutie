import { el } from '../utils.js';
import { t } from '../i18n.js';

// Keys that identify a record or a generated asset. They are shown read-only so a
// manual edit can never orphan a media reference or break downstream provenance.
const READONLY_KEYS = new Set([
  'id', 'shot_id', 'status', 'episode', 'version', 'itemLineage',
]);

// Field names whose values are generated assets rather than authored text.
const READONLY_SUFFIX = /(Path|Url|Id)$/i;

const MAX_TEXTLINE = 120;

function labelFor(pathLast) {
  const known = {
    title: 'ui.edit.title',
    logline: 'ui.edit.logline',
    name: 'ui.edit.name',
    desc: 'ui.edit.desc',
    appearance: 'ui.edit.appearance',
    design: 'ui.edit.design',
    visualTag: 'ui.edit.visualTag',
    summary: 'ui.edit.summary',
    description: 'ui.edit.description',
    type: 'ui.edit.type',
    camera: 'ui.edit.camera',
    duration: 'ui.edit.duration',
    prompt: 'ui.edit.prompt',
    characters: 'ui.edit.characters',
    settings: 'ui.edit.settings',
    episodes: 'ui.edit.episodes',
    segments: 'ui.edit.segments',
    shots: 'ui.edit.shots',
    palette: 'ui.edit.palette',
  };
  return known[pathLast] ? t(known[pathLast]) : String(pathLast);
}

function isReadonlyKey(key) {
  return READONLY_KEYS.has(key) || READONLY_SUFFIX.test(key);
}

function isEditableLeaf(value) {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

// Renders an editable form for `data` into `host`. Edits are written straight back
// into a working clone; on Save the clone is handed to onSave. Cancel discards it
// and re-renders the read view via onCancel.
export function mountEditor(host, data, { onSave, onCancel, title } = {}) {
  const work = structuredClone(data);
  const root = el('div', { className: 'edit-form' });
  host.innerHTML = '';
  host.appendChild(root);

  function paint() {
    const body = el('div', { className: 'edit-body' });
    body.appendChild(renderValue(work, []));
    root.innerHTML = '';
    root.appendChild(formatField(title, body));

    const actions = el('div', { className: 'action-row' });
    const saveBtn = el('button', {
      className: 'action-btn primary', onclick: () => onSave(structuredClone(work)),
    }, t('ui.saveEdits'));
    const cancelBtn = el('button', {
      className: 'action-btn', onclick: () => onCancel?.(),
    }, t('ui.cancelEdit'));
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    root.appendChild(actions);
  }

  function pathGet(base, path) {
    let cur = base;
    for (const seg of path) {
      if (cur == null) return undefined;
      cur = cur[seg];
    }
    return cur;
  }

  function pathSet(base, path, value) {
    if (path.length === 0) return;
    let cur = base;
    for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]];
    cur[path[path.length - 1]] = value;
  }

  function repeatTemplate(item) {
    // Allow adding a new item modelled on the last one so the shape matches.
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const tpl = {};
      for (const [k, v] of Object.entries(item)) tpl[k] = Array.isArray(v) ? [] : (isEditableLeaf(v) ? (typeof v === 'number' ? 0 : '') : {});
      return tpl;
    }
    return '';
  }

  function renderValue(value, path) {
    if (Array.isArray(value)) return renderArray(value, path);
    if (value != null && typeof value === 'object') return renderObject(value, path);
    return renderLeaf(value, path);
  }

  function renderObject(obj, path) {
    const fieldset = el('div', { className: 'edit-group' });
    for (const [key, val] of Object.entries(obj)) {
      if (isReadonlyKey(key)) {
        const ro = el('div', { className: 'edit-readonly' });
        ro.appendChild(el('span', { className: 'edit-label' }, labelFor(key)));
        ro.appendChild(el('div', { className: 'edit-ro-value' }, formatReadonly(val)));
        fieldset.appendChild(ro);
        continue;
      }
      if (isEditableLeaf(val)) {
        fieldset.appendChild(renderLeaf(val, [...path, key]));
      } else if (Array.isArray(val)) {
        fieldset.appendChild(renderArray(val, [...path, key]));
      } else if (val != null && typeof val === 'object') {
        fieldset.appendChild(renderObject(val, [...path, key]));
      }
    }
    return fieldset;
  }

  function renderArray(arr, path) {
    const wrap = el('div', { className: 'edit-array' });
    const label = labelFor(path[path.length - 1]);
    wrap.appendChild(el('div', { className: 'edit-array-label' }, `${label}`));
    const list = el('div', { className: 'edit-array-items' });
    const itemLabel = path.length > 0 ? label : '';
    arr.forEach((item, i) => {
      const card = el('div', { className: 'edit-card' });
      const primer = isEditableLeaf(item) ? `${itemLabel} ${i + 1}` : `${label} ${i + 1}`;
      card.appendChild(el('div', { className: 'edit-card-title' }, primer));
      if (isEditableLeaf(item)) {
        // A primitive array (e.g. a palette of hex colours) holds bare values, so
        // render the item itself as an editable leaf and apply the parent's label.
        card.appendChild(renderLeaf(item, [...path, i], itemLabel || label));
      } else {
        card.appendChild(renderValue(item, [...path, i]));
      }
      const remove = el('button', {
        className: 'edit-remove', onclick: () => { arr.splice(i, 1); paint(); },
      }, '✕');
      card.appendChild(remove);
      list.appendChild(card);
    });
    wrap.appendChild(list);
    wrap.appendChild(el('button', {
      className: 'edit-add', onclick: () => {
        const tpl = repeatTemplate(arr[arr.length - 1]);
        if (tpl && typeof tpl === 'object' && !Array.isArray(tpl)) arr.push(tpl);
        else if (typeof tpl === 'string') arr.push('');
        paint();
      },
    }, `+ ${label}`));
    return wrap;
  }

  function renderLeaf(value, path, overrideLabel = null) {
    const wrap = el('div', { className: 'edit-field' });
    const label = overrideLabel != null ? overrideLabel : labelFor(path[path.length - 1]);
    wrap.appendChild(el('label', { className: 'edit-label' }, label));
    const isLong = typeof value === 'string' && value.length > MAX_TEXTLINE;
    if (isLong) {
      const ta = el('textarea', {
        className: 'edit-input', rows: 4,
        oninput: (e) => pathSet(work, path, e.target.value),
      });
      ta.value = value ?? '';
      wrap.appendChild(ta);
    } else if (typeof value === 'number') {
      const num = el('input', {
        className: 'edit-input', type: 'number', step: 'any',
        oninput: (e) => pathSet(work, path, e.target.value === '' ? value : Number(e.target.value)),
      });
      num.value = value ?? '';
      wrap.appendChild(num);
    } else if (typeof value === 'boolean') {
      const cb = el('input', {
        className: 'edit-check', type: 'checkbox',
        onchange: (e) => pathSet(work, path, e.target.checked),
      });
      cb.checked = !!value;
      wrap.appendChild(cb);
    } else {
      const input = el('input', {
        className: 'edit-input', type: 'text',
        oninput: (e) => pathSet(work, path, e.target.value),
      });
      input.value = value ?? '';
      wrap.appendChild(input);
    }
    return wrap;
  }

  function formatField(title, body) {
    const block = el('div', { className: 'result-card' });
    if (title) block.appendChild(el('h3', {}, title));
    block.appendChild(body);
    return block;
  }

  // el() builds text nodes, so the value is auto-escaped by the DOM. Returning it
  // raw here is intentional.
  function formatReadonly(value) {
    if (value == null || value === '') return '—';
    return String(value);
  }

  paint();
  return {
    getValue: () => structuredClone(work),
  };
}
