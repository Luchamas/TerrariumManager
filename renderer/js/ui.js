// Small DOM helpers shared by every view.

// h('button', { class: 'btn', onclick }, 'Save') -> <button class="btn">Save</button>
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  applyAttrs(el, attrs);
  el.append(...flatten(children));
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  applyAttrs(el, attrs);
  el.append(...flatten(children));
  return el;
}

function applyAttrs(el, attrs) {
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key in el && !(el instanceof SVGElement) && key !== 'list') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
}

function flatten(children) {
  return children.flat(Infinity).filter((c) => c != null && c !== false).map((c) => (c instanceof Node ? c : String(c)));
}

// ---- toast ------------------------------------------------------------------

let toastTimer;
export function toast(message, kind = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 6000 : 3000);
}

// IPC errors arrive as "Error invoking remote method 'x': Error: message".
export function errorText(err) {
  return String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

export function showError(err) {
  console.error(err);
  toast(errorText(err), 'error');
}

// ---- dialogs ------------------------------------------------------------------

// Opens a <dialog> built by `build(close)` and removes it once closed.
export function openDialog(className, build) {
  const dialog = h('dialog', { class: className });
  const close = (value) => dialog.close(value ?? '');
  dialog.append(...flatten([build(close, dialog)]));
  // Clicking the backdrop closes the dialog.
  dialog.addEventListener('mousedown', (e) => {
    if (e.target === dialog) dialog.dataset.backdropDown = '1';
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && dialog.dataset.backdropDown) close();
    delete dialog.dataset.backdropDown;
  });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

export function confirmDialog({ title, message, confirmLabel, danger = false }) {
  return new Promise((resolve) => {
    const dialog = openDialog('modal modal-small', (close) =>
      h('form', { method: 'dialog', class: 'modal-body' },
        h('h2', { class: 'modal-title' }, title),
        h('p', { class: 'modal-text' }, message),
        h('div', { class: 'modal-actions' },
          h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => close('cancel') }, 'Cancelar'),
          h('button', { type: 'submit', value: 'ok', class: danger ? 'btn btn-danger' : 'btn btn-primary', autofocus: true }, confirmLabel),
        ),
      ),
    );
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'));
  });
}

// ---- form fields ----------------------------------------------------------------

// The form control itself, whether given directly or inside a wrapper like a money field.
const controlOf = (el) => (el.matches('input, select, textarea') ? el : el.querySelector('input, select, textarea'));

let fieldId = 0;
export function field(label, control, hint) {
  const input = controlOf(control);
  const id = input.id || `f${++fieldId}`;
  input.id = id;
  return h('div', { class: 'field' },
    h('label', { for: id }, label),
    control,
    hint ? h('small', { class: 'field-hint' }, hint) : null,
  );
}

export function setFieldError(control, message) {
  const input = controlOf(control);
  const wrap = input.closest('.field');
  wrap.querySelector('.field-error')?.remove();
  input.removeAttribute('aria-invalid');
  if (message) {
    input.setAttribute('aria-invalid', 'true');
    wrap.append(h('small', { class: 'field-error' }, message));
  }
}

export function debounce(fn, ms = 150) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
