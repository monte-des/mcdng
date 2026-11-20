// Shared interface pieces: dialogs, toasts, floating panels, code chips.

const Dialog = {
  // Opens a modal built from `body` and resolves with the value returned by the chosen button's handler.
  // `wide` is true for the widest dialog (comparisons) or 'medium' for forms with rows of controls.
  open({ title, body, buttons, initialFocus, wide = false }) {
    return new Promise(resolve => {
      const dialog = h('dialog', { class: wide === 'medium' ? 'dialog medium' : wide ? 'dialog wide' : 'dialog' });
      const finish = value => {
        dialog.close();
        dialog.remove();
        resolve(value);
      };
      const actions = buttons.map(b => h('button', {
        type: b.submit ? 'submit' : 'button',
        class: `btn ${b.kind ?? ''}`,
        text: b.label,
        onclick: event => {
          event.preventDefault();
          const value = b.value ? b.value() : b.result;
          if (value !== undefined) finish(value);
        },
      }));
      dialog.append(h('form', { method: 'dialog', class: 'dialog-form' },
        h('h2', { class: 'dialog-title', text: title }),
        h('div', { class: 'dialog-body' }, body),
        h('div', { class: 'dialog-actions' }, actions)));
      dialog.addEventListener('cancel', event => {
        event.preventDefault();
        finish(null);
      });
      document.body.append(dialog);
      dialog.showModal();
      (initialFocus ?? actions.at(-1)).focus();
    });
  },

  async confirm(title, message, { confirmLabel = 'Confirm', danger = false } = {}) {
    const result = await this.open({
      title,
      body: h('p', { text: message }),
      buttons: [
        { label: 'Cancel', result: false },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', result: true, submit: true },
      ],
    });
    return result === true;
  },

  async alert(title, message) {
    await this.open({ title, body: h('p', { text: message }), buttons: [{ label: 'OK', kind: 'primary', result: true, submit: true }] });
  },

  async prompt(title, label, value = '', confirmLabel = 'Save') {
    const input = h('input', { class: 'input', value, required: true });
    const result = await this.open({
      title,
      body: h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), input),
      buttons: [
        { label: 'Cancel', result: null },
        { label: confirmLabel, kind: 'primary', submit: true, value: () => (input.value.trim() ? input.value.trim() : undefined) },
      ],
      initialFocus: input,
    });
    return result || null;
  },

  async select(title, message, options, confirmLabel) {
    const select = h('select', { class: 'input' }, options.map(o => h('option', { value: o.value, text: o.label })));
    return this.open({
      title,
      body: [h('p', { text: message }), select],
      buttons: [
        { label: 'Cancel', result: null },
        { label: confirmLabel, kind: 'primary', submit: true, value: () => select.value },
      ],
      initialFocus: select,
    });
  },
};

const Toast = {
  host: null,

  show(message, { kind = 'info', timeout = 4000 } = {}) {
    this.host ??= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
    const el = h('div', { class: `toast toast-${kind}`, text: message });
    this.host.append(el);
    const remove = () => el.remove();
    if (timeout) setTimeout(remove, timeout);
    return { update: text => { el.textContent = text; }, close: remove };
  },

  error(message) {
    return this.show(message, { kind: 'error', timeout: 8000 });
  },
};

// Places a fixed panel next to an anchor rectangle, flipping above it when there is no room below.
function placeFloating(el, rect) {
  const margin = 8;
  const { width, height } = el.getBoundingClientRect();
  let top = rect.bottom + margin;
  if (top + height > innerHeight - margin) top = rect.top - height - margin;
  top = Math.max(margin, Math.min(top, innerHeight - height - margin));
  const left = Math.min(Math.max(margin, rect.left), innerWidth - width - margin);
  el.style.top = `${Math.round(top)}px`;
  el.style.left = `${Math.round(left)}px`;
}

function swatch(color) {
  return h('span', { class: 'swatch', style: { background: color } });
}

function codeChip(id, onRemove) {
  const code = Codes.get(id);
  return h('span', { class: 'chip', title: Codes.path(code) },
    swatch(code.color),
    h('span', { class: 'chip-label', text: code.name }),
    onRemove && h('button', { type: 'button', class: 'chip-remove', 'aria-label': `Remove ${code.name}`, text: '×', onclick: onRemove }));
}

// Vertical coding stripes: one per code, the visual signature used in readers, lists and cards.
function stripes(codeIds) {
  return h('span', { class: 'stripes', 'aria-hidden': 'true' },
    codeIds.map(id => h('span', { class: 'stripe', style: { background: Codes.get(id).color } })));
}

function emptyState(title, text, action) {
  return h('div', { class: 'empty' },
    h('p', { class: 'empty-title', text: title }),
    text && h('p', { class: 'empty-text', text }),
    action);
}

function field(label, control, hint) {
  return h('label', { class: 'field' },
    h('span', { class: 'field-label', text: label }),
    control,
    hint && h('span', { class: 'field-hint' }, hint));
}
