// The coding workspace: one document in a reader, codes and segments in the sidebar.

class CodingView extends View {
  constructor() {
    super('coding', ['documents', 'codes', 'segments']);
    this.doc = null;
    this.content = null;
    this.reader = null;
    this.pending = null;
    this.mode = 'pages';
    this.zoom = 'fit';
    this.hiddenCodes = new Set();
    this.sideTab = 'codes';
    this.segmentFilter = null;
    this.openToken = 0;
    this.ready = null;
    this.refocus = null;

    this.picker = h('select', { class: 'input doc-picker', 'aria-label': 'Document', onchange: () => this.open(this.picker.value) });
    this.modeSwitch = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Reading view' });
    this.zoomSelect = zoomControl(zoom => {
      this.zoom = zoom;
      this.reader?.setZoom(zoom);
    });
    this.toolbar = h('div', { class: 'coding-toolbar' }, this.picker, h('span', { class: 'spacer' }), this.modeSwitch, this.zoomSelect);

    this.readerHost = h('div', { class: 'reader-host', tabIndex: -1 });
    this.readerHost.addEventListener('mouseup', event => this.onPointerUp(event));

    this.tabs = h('div', { class: 'side-tabs', role: 'tablist' });
    this.sideBody = h('div', { class: 'side-body' });
    this.side = h('aside', { class: 'coding-side', 'aria-label': 'Codes and segments' }, this.tabs, this.sideBody);
    this.main = h('div', { class: 'coding-main' }, this.toolbar, this.readerHost);
    this.el.append(this.main, this.side);

    bus.on('project', () => this.closeDocument());
  }

  update(topics) {
    if (topics.has('all') || topics.has('documents')) {
      this.renderPicker();
      if (this.doc && !Docs.get(this.doc.id)) this.closeDocument();
      if (!this.doc) {
        const first = Docs.sorted()[0];
        if (first) this.open(first.id);
        else this.renderEmpty();
      }
    }
    if (topics.has('codes') || topics.has('segments')) this.reader?.refresh();
    this.renderSide();
  }

  renderPicker() {
    this.picker.replaceChildren(...Docs.sorted().map(d => h('option', {
      value: d.id,
      text: `${Docs.citation(d)}  ${truncate(d.title, 70)}`,
      selected: d.id === this.doc?.id,
    })));
    this.toolbar.hidden = !project.documents.length;
  }

  renderEmpty() {
    this.readerHost.replaceChildren(emptyState(
      'Import documents to start coding',
      'Your papers appear here once they are in the project.',
      h('button', { type: 'button', class: 'btn primary', text: 'Go to Documents', onclick: () => App.go('documents') })));
  }

  renderModeSwitch() {
    const isPdf = !!this.content?.pages;
    this.modeSwitch.hidden = !isPdf;
    this.zoomSelect.hidden = !isPdf || this.mode !== 'pages';
    this.zoomSelect.value = String(this.zoom);
    this.modeSwitch.replaceChildren(...[['pages', 'Pages'], ['text', 'Text']].map(([mode, label]) => h('button', {
      type: 'button',
      class: this.mode === mode ? 'active' : '',
      'aria-pressed': String(this.mode === mode),
      text: label,
      onclick: () => this.setMode(mode),
    })));
  }

  context() {
    const view = this;
    return {
      doc: this.doc,
      content: this.content,
      get pending() { return view.pending; },
      highlights: () => this.highlights(),
      onBarClick: (id, rect) => this.edit(Segs.get(id), rect),
    };
  }

  highlights() {
    return Segs.forDoc(this.doc.id)
      .map(seg => ({ id: seg.id, start: seg.start, end: seg.end, codes: Segs.activeCodes(seg).filter(c => !this.hiddenCodes.has(c)) }))
      .filter(item => item.codes.length);
  }

  async open(docId, { segmentId, offset } = {}) {
    Editor.close();
    if (docId !== this.doc?.id || !this.ready) this.ready = this.load(docId);
    const loaded = await this.ready;
    if (!loaded || this.doc?.id !== docId) return;
    if (segmentId) this.reader.reveal(Segs.get(segmentId));
    else if (offset != null) this.reader.reveal({ start: offset, end: offset + 1 }, { flash: false });
  }

  async load(docId) {
    const token = ++this.openToken;
    this.reader?.destroy();
    this.reader = null;
    this.doc = Docs.get(docId);
    this.content = null;
    this.segmentFilter = null;
    this.renderPicker();
    this.renderSide();
    this.readerHost.replaceChildren(h('p', { class: 'loading', text: 'Opening document…' }));
    try {
      const content = await Contents.get(docId);
      if (token !== this.openToken) return false;
      this.content = content;
      this.reader = content.pages && this.mode === 'pages' ? new PageReader(this.context(), this.zoom) : new TextReader(this.context());
      this.renderModeSwitch();
      await this.reader.mount(this.readerHost);
    } catch (err) {
      if (token !== this.openToken) return false;
      this.reader?.destroy();
      this.reader = null;
      this.readerHost.replaceChildren(emptyState('This document could not be opened', err.message));
      return false;
    }
    if (token !== this.openToken) return false;
    this.renderSide();
    return true;
  }

  closeDocument() {
    Editor.close();
    this.openToken++;
    this.ready = null;
    this.reader?.destroy();
    this.reader = null;
    this.doc = null;
    this.content = null;
  }

  // Switching views keeps the passage at the top of the reader in sight.
  async setMode(mode) {
    if (mode === this.mode || !this.doc) return;
    const offset = this.visibleOffset();
    this.mode = mode;
    const docId = this.doc.id;
    this.closeDocument();
    await this.open(docId, { offset });
  }

  // Offset of the first line of text near the top of the reader; with two columns, the left one wins.
  visibleOffset() {
    const box = this.readerHost.getBoundingClientRect();
    for (let y = box.top + 16; y < box.top + box.height / 2; y += 12) {
      const hits = [];
      for (let x = box.left + 20; x < box.right - 20; x += 24) {
        const el = document.elementFromPoint(x, y)?.closest('[data-s]');
        if (el && this.readerHost.contains(el)) hits.push(Number(el.dataset.s));
      }
      if (hits.length) return Math.min(...hits);
    }
    return null;
  }

  onPointerUp(event) {
    if (event.button !== 0 || !this.reader || event.target.closest('.bar')) return;
    setTimeout(() => {
      const sel = selectionIn(this.reader.root);
      if (!sel) return;
      const rect = sel.rect.width || sel.rect.height ? sel.rect : new DOMRect(event.clientX, event.clientY, 0, 0);
      if (sel.collapsed) return this.openAt(sel.start, rect);
      const [start, end] = trimRange(this.content.text, Math.min(sel.start, sel.end), Math.max(sel.start, sel.end));
      if (end > start) this.codeSelection(start, end, rect);
    });
  }

  codeSelection(start, end, rect) {
    this.pending = { start, end };
    this.reader.setPending();
    Editor.open({
      anchor: rect,
      doc: this.doc,
      content: this.content,
      range: { start, end },
      onClose: () => {
        this.pending = null;
        this.reader?.setPending();
        getSelection().removeAllRanges();
      },
    });
  }

  // A click inside coded text opens that segment, or a choice when several overlap.
  openAt(offset, rect) {
    const hits = this.highlights().filter(item => item.start <= offset && offset < item.end).map(item => Segs.get(item.id));
    if (hits.length === 1) this.edit(hits[0], rect);
    else if (hits.length > 1) Editor.open({ anchor: rect, choices: hits });
  }

  edit(segment, rect) {
    Editor.open({ anchor: rect, segment });
  }

  // Sidebar

  renderSide() {
    const tabs = [['codes', 'Codes'], ['segments', 'Segments']];
    this.tabs.replaceChildren(...tabs.map(([key, label]) => h('button', {
      type: 'button', role: 'tab',
      class: this.sideTab === key ? 'active' : '',
      'aria-selected': String(this.sideTab === key),
      text: label,
      onclick: () => {
        this.sideTab = key;
        this.renderSide();
      },
    })));
    this.sideBody.replaceChildren(this.sideTab === 'codes' ? this.renderCodes() : this.renderSegments());
    if (this.refocus) {
      this.sideBody.querySelector(this.refocus)?.focus();
      this.refocus = null;
    }
  }

  docCounts() {
    const counts = new Map();
    if (!this.doc) return counts;
    for (const seg of Segs.forDoc(this.doc.id)) for (const id of Segs.activeCodes(seg)) counts.set(id, (counts.get(id) ?? 0) + 1);
    return counts;
  }

  renderCodes() {
    const counts = this.docCounts();
    const input = h('input', {
      class: 'input', placeholder: 'New code', 'aria-label': 'New code name',
      onkeydown: event => {
        if (event.key !== 'Enter' || !input.value.trim()) return;
        if (Codes.nameTaken(input.value)) return Toast.error(`A code named “${input.value.trim()}” already exists.`);
        this.refocus = '.side-codes > .input';
        Actions.createCode({ name: input.value, origin: 'inductive' });
      },
    });
    const tree = Codes.tree();
    const rows = tree.map(({ code, depth }) => {
      const hidden = this.hiddenCodes.has(code.id);
      return h('div', { class: `code-row${hidden ? ' is-hidden' : ''}`, style: { paddingLeft: `${8 + depth * 16}px` } },
        h('button', {
          type: 'button', class: 'visibility',
          'aria-label': `${hidden ? 'Show' : 'Hide'} highlights for ${code.name}`,
          'aria-pressed': String(!hidden),
          title: hidden ? 'Show highlights' : 'Hide highlights',
          style: { '--code': code.color },
          onclick: () => {
            if (hidden) this.hiddenCodes.delete(code.id); else this.hiddenCodes.add(code.id);
            this.reader?.refresh();
            this.renderSide();
          },
        }),
        h('button', {
          type: 'button', class: 'code-name', text: code.name, title: `Show segments coded ${code.name}`,
          onclick: () => {
            this.segmentFilter = code.id;
            this.sideTab = 'segments';
            this.renderSide();
          },
        }),
        h('span', { class: 'count', text: counts.get(code.id) ?? '' }));
    });
    return h('div', { class: 'side-codes' },
      input,
      this.hiddenCodes.size > 0 && h('button', {
        type: 'button', class: 'btn subtle small', text: 'Show all highlights',
        onclick: () => {
          this.hiddenCodes.clear();
          this.reader?.refresh();
          this.renderSide();
        },
      }),
      rows.length ? h('div', { class: 'code-tree' }, rows) : h('p', { class: 'muted small', text: 'Create codes here, while coding, or in the Codebook.' }));
  }

  renderSegments() {
    if (!this.doc) return h('p', { class: 'muted small', text: 'No document open.' });
    const filter = this.segmentFilter && Codes.isActive(this.segmentFilter) ? this.segmentFilter : null;
    const segments = Segs.forDoc(this.doc.id).filter(s => Segs.visible(s) && (!filter || s.codes.includes(filter)));
    return h('div', { class: 'side-segments' },
      filter && h('div', { class: 'filter-chip' },
        h('span', { class: 'muted small', text: 'Coded' }),
        codeChip(filter, () => {
          this.segmentFilter = null;
          this.renderSide();
        })),
      segments.length ? segments.map(seg => h('div', { class: 'seg-item' },
        stripes(Segs.activeCodes(seg)),
        h('button', {
          type: 'button', class: 'seg-text',
          onclick: () => this.reader?.reveal(seg),
        }, h('span', { class: 'seg-quote', text: seg.text }),
        h('span', { class: 'seg-meta', text: [Segs.pageLabel(seg), seg.memo && 'memo'].filter(Boolean).join(', ') })),
        h('button', {
          type: 'button', class: 'icon-btn small', text: 'Edit', 'aria-label': 'Edit segment',
          onclick: event => this.edit(seg, event.currentTarget.getBoundingClientRect()),
        })))
        : h('p', { class: 'muted small', text: filter ? 'No segments with this code in this document.' : 'Select text in the document to code it.' }));
  }
}
