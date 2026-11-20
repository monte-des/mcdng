// Floating editor for one segment. Opened with one of:
//   { anchor, doc, content, range }  code a new selection
//   { anchor, segment }              edit an existing segment
//   { anchor, choices }              several segments overlap the click: pick one first
// onClose runs whenever the editor closes, saved or not.

const Editor = {
  el: null,
  state: null,

  open(options) {
    this.close();
    this.state = { ...options, query: '', active: 0 };
    this.el = h('div', { class: 'popover editor', role: 'dialog', 'aria-label': 'Code segment' });
    this.el.addEventListener('keydown', event => this.onKey(event));
    document.body.append(this.el);
    if (options.choices) this.renderChoices();
    else this.renderForm();
    placeFloating(this.el, options.anchor);
    // pointerdown rather than mousedown: the Apple Pencil, which draws without mouse events, closes it too.
    document.addEventListener('pointerdown', this.onOutside, true);
  },

  close() {
    if (!this.el) return;
    document.removeEventListener('pointerdown', this.onOutside, true);
    this.el.remove();
    this.el = null;
    const { onClose } = this.state;
    this.state = null;
    onClose?.();
  },

  onOutside(event) {
    if (Editor.el && !Editor.el.contains(event.target) && !event.target.closest('dialog')) Editor.close();
  },

  renderChoices() {
    const { choices } = this.state;
    this.el.replaceChildren(
      h('p', { class: 'popover-title', text: `${plural(choices.length, 'segment')} here` }),
      h('div', { class: 'choice-list' }, choices.map(seg => h('button', {
        type: 'button',
        class: 'choice',
        onclick: () => {
          this.state.choices = null;
          this.state.segment = seg;
          this.renderForm();
          placeFloating(this.el, this.state.anchor);
        },
      }, stripes(Segs.activeCodes(seg)), h('span', { class: 'choice-text', text: truncate(seg.text, 120) })))));
    this.el.querySelector('.choice').focus();
  },

  renderForm() {
    const { segment, content, range } = this.state;
    const editing = !!segment;
    this.state.selected = editing ? Segs.activeCodes(segment) : [];
    const quote = editing ? segment.text : content.text.slice(range.start, range.end);

    this.search = h('input', {
      class: 'input',
      placeholder: 'Find or create a code',
      'aria-label': 'Find or create a code',
      oninput: () => {
        this.state.query = this.search.value;
        this.state.active = 0;
        this.renderOptions();
      },
    });
    this.chips = h('div', { class: 'chips' });
    this.list = h('div', { class: 'option-list', role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': 'Codes' });
    this.memo = h('textarea', { class: 'input memo', rows: 2, placeholder: 'Memo', 'aria-label': 'Memo', value: editing ? segment.memo : '' });
    this.saveButton = h('button', { type: 'button', class: 'btn primary', text: editing ? 'Save' : 'Code segment', onclick: () => this.save() });

    this.el.replaceChildren(
      h('blockquote', { class: 'popover-quote', text: truncate(quote.replace(/\s+/g, ' '), 220) }),
      this.chips,
      this.search,
      this.list,
      this.memo,
      h('div', { class: 'popover-actions' },
        editing && h('button', { type: 'button', class: 'btn subtle danger-text', text: 'Delete segment', onclick: () => this.remove() }),
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn subtle', text: 'Cancel', onclick: () => this.close() }),
        this.saveButton));
    this.renderChips();
    this.renderOptions();
    // On a touch screen focus would bring up the keyboard over the list of codes, which is tapped instead.
    if (!touchFirst()) this.search.focus();
  },

  options() {
    const query = this.state.query.trim();
    const key = query.toLowerCase();
    const rows = Codes.tree()
      .filter(({ code }) => !key || Codes.path(code).toLowerCase().includes(key))
      .map(({ code, depth }) => ({ type: 'code', code, depth: key ? 0 : depth }));
    if (query && !Codes.nameTaken(query)) rows.unshift({ type: 'create', name: query });
    return rows;
  },

  renderOptions() {
    const options = this.options();
    this.state.options = options;
    this.state.active = Math.min(this.state.active, Math.max(0, options.length - 1));
    this.list.replaceChildren(...options.map((option, i) => {
      const active = i === this.state.active;
      if (option.type === 'create') {
        return h('div', { class: `option create${active ? ' active' : ''}`, role: 'option', onclick: () => this.choose(i) },
          h('span', { class: 'option-plus', text: '+' }),
          h('span', { text: `Create “${option.name}”` }));
      }
      const selected = this.state.selected.includes(option.code.id);
      return h('div', {
        class: `option${active ? ' active' : ''}${selected ? ' selected' : ''}`,
        role: 'option',
        'aria-selected': String(selected),
        style: { paddingLeft: `${10 + option.depth * 14}px` },
        onclick: () => this.choose(i),
      },
      swatch(option.code.color),
      h('span', { class: 'option-label', text: this.state.query.trim() ? Codes.path(option.code) : option.code.name }),
      h('span', { class: 'option-check', 'aria-hidden': 'true', text: selected ? '✓' : '' }));
    }));
    if (!options.length) this.list.append(h('p', { class: 'option-empty', text: 'No codes yet. Type a name to create one.' }));
    this.list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
    this.saveButton.disabled = !this.state.selected.length;
  },

  renderChips() {
    this.chips.replaceChildren(...this.state.selected.map(id => codeChip(id, () => this.toggle(id))));
    this.chips.hidden = !this.state.selected.length;
  },

  toggle(id) {
    const { selected } = this.state;
    this.state.selected = selected.includes(id) ? selected.filter(x => x !== id) : Codes.ordered([...selected, id]);
    this.renderChips();
    this.renderOptions();
  },

  choose(i) {
    const option = this.state.options[i];
    if (!option) return;
    this.state.active = i;
    if (option.type === 'create') {
      const code = Actions.createCode({ name: option.name, origin: 'inductive' });
      this.search.value = this.state.query = '';
      this.toggle(code.id);
    } else {
      this.toggle(option.code.id);
    }
    if (!touchFirst()) this.search.focus();
  },

  onKey(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.save();
    } else if (event.target === this.search && this.state.options) {
      const count = this.state.options.length;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        this.state.active = (this.state.active + (event.key === 'ArrowDown' ? 1 : count - 1)) % Math.max(count, 1);
        this.renderOptions();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        this.choose(this.state.active);
      }
    }
  },

  save() {
    const { segment, doc, content, range, selected } = this.state;
    if (!selected.length) return;
    const memo = this.memo.value.trim();
    // Archived codes are not offered in the editor but stay on the segment so restoring them brings it back.
    if (segment) Actions.updateSegment(segment.id, { codes: [...selected, ...segment.codes.filter(id => !Codes.isActive(id))], memo });
    else Actions.createSegment({ doc, content, start: range.start, end: range.end, codes: selected, memo });
    this.close();
  },

  async remove() {
    const { segment } = this.state;
    this.close();
    const ok = await Dialog.confirm('Delete segment', `“${truncate(segment.text, 140)}” will be removed with its codes and memo.`, { confirmLabel: 'Delete segment', danger: true });
    if (ok) Actions.deleteSegment(segment.id);
  },
};
