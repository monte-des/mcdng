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
    this.listenForTouch();

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
      // A tap on a touch screen leaves no selection: the text under the finger counts, as a click's caret does.
      const sel = selectionIn(this.reader.root) ?? this.pointIn(event.clientX, event.clientY);
      if (!sel) return;
      const rect = sel.rect.width || sel.rect.height ? sel.rect : new DOMRect(event.clientX, event.clientY, 0, 0);
      if (sel.collapsed) return this.openAt(sel.start, rect);
      const [start, end] = trimRange(this.content.text, Math.min(sel.start, sel.end), Math.max(sel.start, sel.end));
      if (end > start) this.codeSelection(start, end, rect);
    });
  }

  hide() {
    super.hide();
    this.codeButton.hidden = true;
  }

  // A collapsed selection at a point of the reader, or null outside its text.
  pointIn(x, y) {
    const caret = caretAt(x, y);
    if (!caret || !this.reader.root.contains(caret.node)) return null;
    const offset = offsetAtPoint(this.reader.root, caret.node, caret.offset);
    return { start: offset, end: offset, collapsed: true, rect: new DOMRect(x, y, 0, 0) };
  }

  // Touch screens. The Apple Pencil works as a highlighter: drawing over text selects it and opens the editor,
  // a tap opens the segment under it. A finger scrolls; a long press selects text as usual, and a Code button
  // next to the selection codes it.
  listenForTouch() {
    const host = this.readerHost;
    // Safari scrolls and starts its own selection on any touch; for the Pencil only, it is stopped here.
    host.addEventListener('touchstart', event => {
      if ([...event.touches].some(t => t.touchType === 'stylus')) event.preventDefault();
    }, { passive: false });
    host.addEventListener('pointerdown', event => this.penDown(event));
    host.addEventListener('pointermove', event => this.penMove(event));
    host.addEventListener('pointerup', event => this.penUp(event));
    host.addEventListener('pointercancel', () => this.penEnd());
    this.codeButton = h('button', {
      type: 'button', class: 'btn primary small code-float', text: 'Code selection', hidden: true,
      onpointerdown: event => event.preventDefault(),
      onclick: () => this.codeTouchSelection(),
    });
    document.body.append(this.codeButton);
    document.addEventListener('selectionchange', debounce(() => this.offerCodeButton(), 250));
  }

  penDown(event) {
    if (event.pointerType !== 'pen' || event.button !== 0 || !this.reader || event.target.closest('.bar, button')) return;
    const start = caretAt(event.clientX, event.clientY);
    if (!start || !this.reader.root.contains(start.node)) return;
    event.preventDefault();
    this.pen = { start, x: event.clientX, y: event.clientY, moved: false };
    // Moves keep coming here when the Pencil leaves the reader; a pointer the browser no longer tracks is skipped.
    try {
      this.readerHost.setPointerCapture(event.pointerId);
    } catch {}
    event.target.closest('.text-layer')?.classList.add('selecting');
  }

  penMove(event) {
    const pen = this.pen;
    if (!pen || event.pointerType !== 'pen') return;
    if (!pen.moved && Math.hypot(event.clientX - pen.x, event.clientY - pen.y) < 6) return;
    pen.moved = true;
    // Near the top or bottom edge, the reader scrolls so a selection can run across pages.
    const box = this.readerHost.getBoundingClientRect();
    if (event.clientY > box.bottom - 48) this.readerHost.scrollTop += 14;
    else if (event.clientY < box.top + 48) this.readerHost.scrollTop -= 14;
    const end = caretAt(event.clientX, event.clientY);
    if (end && this.reader.root.contains(end.node)) getSelection().setBaseAndExtent(pen.start.node, pen.start.offset, end.node, end.offset);
  }

  penUp(event) {
    const pen = this.pen;
    if (!pen || event.pointerType !== 'pen') return;
    this.penEnd();
    if (!pen.moved) {
      const point = this.pointIn(event.clientX, event.clientY);
      if (point) this.openAt(point.start, point.rect);
      return;
    }
    const sel = selectionIn(this.reader.root);
    if (!sel || sel.collapsed) return;
    const [start, end] = trimRange(this.content.text, Math.min(sel.start, sel.end), Math.max(sel.start, sel.end));
    if (end > start) this.codeSelection(start, end, sel.rect);
  }

  penEnd() {
    this.pen = null;
    this.reader?.root.querySelectorAll('.selecting').forEach(el => el.classList.remove('selecting'));
  }

  // Shown under a selection made with a finger, while the editor is closed.
  offerCodeButton() {
    const sel = touchFirst() && this.visible && this.reader && !this.pen && !Editor.el ? selectionIn(this.reader.root) : null;
    this.codeButton.hidden = !sel || sel.collapsed;
    if (this.codeButton.hidden) return;
    // Below the selection: Safari's own menu sits above it.
    placeFloating(this.codeButton, new DOMRect(sel.rect.left, sel.rect.bottom + 28, 0, 0));
  }

  codeTouchSelection() {
    this.codeButton.hidden = true;
    const sel = this.reader && selectionIn(this.reader.root);
    if (!sel || sel.collapsed) return;
    const [start, end] = trimRange(this.content.text, Math.min(sel.start, sel.end), Math.max(sel.start, sel.end));
    if (end > start) this.codeSelection(start, end, sel.rect);
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
