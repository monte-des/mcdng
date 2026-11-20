// Retrieved segments across the whole project, filtered and grouped, with CSV export.

// CSV choices are remembered in this browser between sessions.
const CSV_PREFS_KEY = 'mcdng.csv';
const csvPrefs = { layout: 'segment', delimiter: ',' };
try {
  Object.assign(csvPrefs, JSON.parse(localStorage.getItem(CSV_PREFS_KEY)) ?? {});
} catch {
  // Storage can be unavailable; the defaults stand.
}

function reviewDefaults() {
  // `options`: for each options or tags field, the options ticked in the filter (a document needs one of them).
  return { query: '', term: null, codes: new Set(), match: 'any', subcodes: true, docs: new Set(), options: new Map(), yearFrom: '', yearTo: '', memoOnly: false };
}

const CSV_LAYOUTS = [
  ['segment', 'One row per segment', 'Each coded passage once, with its codes at each level of the hierarchy (level 1, level 2…) and their full paths.'],
  ['code', 'One row per segment and code', 'A passage with two codes takes two rows, each with its own level 1, level 2… Best for filters and pivot tables in Excel, R or Python.'],
  ['matrix', 'Code matrix', 'One row per passage and one column per code: 1 when the passage has the code or one of its subcodes, otherwise 0.'],
];
if (!CSV_LAYOUTS.some(([value]) => value === csvPrefs.layout)) csvPrefs.layout = 'segment';
if (![',', ';'].includes(csvPrefs.delimiter)) csvPrefs.delimiter = ',';

// Level column names: "level_1", or "level_1_theme" when the framework names the level.
function levelHeaders(count) {
  return Array.from({ length: count }, (_, i) => {
    const name = project.framework.levels[i]?.name;
    return name ? `level_${i + 1}_${fileSlug(name).replace(/-/g, '_')}` : `level_${i + 1}`;
  });
}

// Rows for the segments CSV. Every layout starts with the segment's document metadata and page, and ends
// with its text, memo and dates; the code columns between them depend on the layout.
function segmentRows(segments, layout) {
  const fields = project.fields;
  const coded = segments.map(seg => ({ seg, codes: Segs.activeCodes(seg).map(Codes.get) }));
  const depth = Math.max(1, ...coded.flatMap(({ codes }) => codes.map(c => Codes.depth(c) + 1)));
  const levels = levelHeaders(depth);
  const byLevel = lines => levels.map((_, i) => [...new Set(lines.map(line => line[i]?.name).filter(Boolean))].join('; '));
  // Matrix columns: every code used, with its ancestors, in codebook order.
  const columns = layout === 'matrix'
    ? Codes.tree().map(({ code }) => code).filter(code => coded.some(({ codes }) => codes.some(c => Codes.lineage(c).includes(code))))
    : [];

  const header = ['segment_id', 'document', 'authors', 'year', 'title', 'journal', 'volume', 'issue', 'article_pages', 'doi', ...fields.map(f => f.name), 'page'];
  const codeHeader = {
    segment: ['codes', 'code_count', ...levels],
    code: ['code', 'code_path', ...levels, 'code_level', 'analytical_dimension', 'origin'],
    matrix: columns.map(c => Codes.path(c)),
  }[layout];
  const tail = ['text', 'memo', 'created', 'modified'];

  const rows = [];
  for (const { seg, codes } of coded) {
    const doc = Docs.get(seg.docId);
    const head = [seg.id, Docs.citation(doc), doc.authors, doc.year, doc.title, doc.journal, doc.volume, doc.issue, doc.articlePages, doc.doi, ...fields.map(f => Fields.text(doc, f)), Segs.pageLabel(seg).replace(/^pp?\. /, '')];
    const end = [seg.text, seg.memo, seg.created, seg.modified];
    if (layout === 'code') {
      for (const code of codes) {
        const line = Codes.lineage(code);
        rows.push([...head, code.name, Codes.path(code), ...levels.map((_, i) => line[i]?.name ?? ''), line.length,
          Codes.dimensionName(code.dimensionId), ORIGIN_LABELS[code.origin] ?? '', ...end]);
      }
    } else if (layout === 'matrix') {
      const covered = new Set(codes.flatMap(c => Codes.lineage(c)));
      rows.push([...head, ...columns.map(c => (covered.has(c) ? 1 : 0)), ...end]);
    } else {
      rows.push([...head, codes.map(c => Codes.path(c)).join('; '), codes.length, ...byLevel(codes.map(c => Codes.lineage(c))), ...end]);
    }
  }
  return { header: [...header, ...codeHeader, ...tail], rows };
}

async function chooseCsvOptions(title, { layouts }) {
  const radios = (name, options, current) => h('div', { class: 'radio-group', role: 'radiogroup' }, options.map(([value, label, hint]) => h('label', { class: 'radio' },
    h('input', { type: 'radio', name, value, checked: value === current }),
    h('span', null, h('span', { class: 'radio-label', text: label }), hint && h('span', { class: 'field-hint', text: hint })))));
  const body = h('div', { class: 'form' },
    layouts && h('fieldset', { class: 'fieldset' }, h('legend', { text: 'Rows' }), radios('layout', CSV_LAYOUTS, csvPrefs.layout)),
    h('fieldset', { class: 'fieldset' }, h('legend', { text: 'Separator' }), radios('delimiter', [
      [',', 'Comma', 'Standard CSV.'],
      [';', 'Semicolon', 'Opens directly in Excel with Italian or other European settings.'],
    ], csvPrefs.delimiter)));
  const result = await Dialog.open({
    title,
    body,
    buttons: [
      { label: 'Cancel', result: null },
      { label: 'Download CSV', kind: 'primary', submit: true, value: () => ({
        layout: body.querySelector('input[name=layout]:checked')?.value ?? csvPrefs.layout,
        delimiter: body.querySelector('input[name=delimiter]:checked').value,
      }) },
    ],
  });
  if (result) {
    Object.assign(csvPrefs, result);
    try {
      localStorage.setItem(CSV_PREFS_KEY, JSON.stringify(csvPrefs));
    } catch {
      // Not remembered this time; nothing else depends on it.
    }
  }
  return result;
}

// Read-only view of a segment in its document, so the text around it can be read without leaving Review.
class SegmentPreview {
  constructor({ onClose }) {
    this.onClose = onClose;
    this.mode = 'text';
    this.zoom = 'fit';
    this.seg = null;
    this.reader = null;
    this.token = 0;
    this.heading = h('div', { class: 'preview-heading' });
    this.modeSwitch = h('div', { class: 'segmented small', role: 'group', 'aria-label': 'Reading view' });
    this.zoomSelect = zoomControl(zoom => {
      this.zoom = zoom;
      this.reader?.setZoom(zoom);
    });
    this.host = h('div', { class: 'reader-host preview-host' });
    this.el = h('aside', { class: 'preview', hidden: true, 'aria-label': 'Document preview' },
      h('header', { class: 'preview-head' },
        this.heading,
        h('div', { class: 'preview-tools' },
          this.modeSwitch,
          this.zoomSelect,
          h('button', { type: 'button', class: 'btn small', text: 'Open in Coding', onclick: () => App.openSegment(this.seg.docId, this.seg.id) }),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close preview', text: '×', onclick: () => this.close() }))),
      this.host);
  }

  async show(seg) {
    const sameDoc = this.reader && this.seg?.docId === seg.docId;
    this.seg = seg;
    this.el.hidden = false;
    this.renderHeading();
    if (sameDoc) {
      this.reader.refresh();
      this.reader.reveal(seg);
      return;
    }
    await this.load();
  }

  async load() {
    const token = ++this.token;
    this.reader?.destroy();
    this.reader = null;
    this.host.replaceChildren(h('p', { class: 'loading', text: 'Opening document…' }));
    const doc = Docs.get(this.seg.docId);
    try {
      const content = await Contents.get(doc.id);
      if (token !== this.token) return;
      const ctx = {
        doc,
        content,
        pending: null,
        highlights: () => [{ id: this.seg.id, start: this.seg.start, end: this.seg.end, codes: Segs.activeCodes(this.seg) }],
        onBarClick: (id, rect) => Editor.open({ anchor: rect, segment: Segs.get(id) }),
      };
      const reader = content.pages && this.mode === 'pages' ? new PageReader(ctx, this.zoom) : new TextReader(ctx);
      this.reader = reader;
      this.renderModeSwitch(!!content.pages);
      await reader.mount(this.host);
      if (token !== this.token) return;
      reader.reveal(this.seg);
    } catch (err) {
      if (token !== this.token) return;
      this.reader = null;
      this.host.replaceChildren(emptyState('This document could not be opened', err.message));
    }
  }

  renderHeading() {
    const doc = Docs.get(this.seg.docId);
    this.heading.replaceChildren(
      h('p', { class: 'preview-title', text: doc.title }),
      h('p', { class: 'preview-meta', text: [Docs.byline(doc), Segs.pageLabel(this.seg)].filter(Boolean).join(', ') }));
  }

  renderModeSwitch(isPdf) {
    this.modeSwitch.hidden = !isPdf;
    this.zoomSelect.hidden = !isPdf || this.mode !== 'pages';
    this.zoomSelect.value = String(this.zoom);
    this.modeSwitch.replaceChildren(...[['pages', 'Pages'], ['text', 'Text']].map(([mode, label]) => h('button', {
      type: 'button', text: label,
      class: this.mode === mode ? 'active' : '',
      'aria-pressed': String(this.mode === mode),
      onclick: () => {
        if (mode === this.mode) return;
        this.mode = mode;
        this.load();
      },
    })));
  }

  // Keeps the preview in step with edits made elsewhere; closes it if the segment is gone or hidden.
  sync() {
    if (!this.seg) return;
    const seg = Segs.get(this.seg.id);
    if (!seg || !Segs.visible(seg) || !Docs.get(seg.docId)) return this.close();
    this.seg = seg;
    this.renderHeading();
    this.reader?.refresh();
  }

  close() {
    if (!this.seg) return;
    this.token++;
    this.reader?.destroy();
    this.reader = null;
    this.seg = null;
    this.el.hidden = true;
    this.host.replaceChildren();
    this.onClose();
  }
}

// The text with every occurrence of a term wrapped in <mark>.
function markTerm(text, term) {
  const parts = [];
  let last = 0;
  for (const [start, end] of Analysis.ranges(text, term)) {
    parts.push(text.slice(last, start), h('mark', { class: 'term', text: text.slice(start, end) }));
    last = end;
  }
  parts.push(text.slice(last));
  return parts;
}

function fileSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
}

class ReviewView extends View {
  constructor() {
    super('review', ['documents', 'codes', 'segments', 'fields', 'keywords']);
    this.filters = reviewDefaults();
    this.groupBy = 'code';
    this.filterPanel = h('aside', { class: 'review-filters', 'aria-label': 'Filters' });
    this.summary = h('p', { class: 'view-count' });
    this.results = h('div', { class: 'review-results' });
    this.preview = new SegmentPreview({ onClose: () => this.markActive() });
    this.groupSelect = h('select', {
      class: 'input', 'aria-label': 'Group segments by',
      onchange: () => {
        this.groupBy = this.groupSelect.value;
        this.renderResults();
      },
    }, [['code', 'Group by code'], ['document', 'Group by document'], ['none', 'No grouping']].map(([value, text]) => h('option', { value, text })));
    this.el.append(
      this.filterPanel,
      h('div', { class: 'review-main' },
        h('header', { class: 'view-header' },
          h('h1', { class: 'view-title', text: 'Review' }),
          this.summary,
          h('span', { class: 'spacer' }),
          this.groupSelect,
          h('button', { type: 'button', class: 'btn', text: 'Export CSV', onclick: () => this.export() })),
        h('div', { class: 'review-body' }, this.results, this.preview.el)));
    this.searchLater = debounce(() => this.renderResults(), 200);
    this.el.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !Editor.el && !document.querySelector('dialog[open]')) this.preview.close();
    });
    bus.on('project', () => {
      this.filters = reviewDefaults();
      this.preview.close();
    });
  }

  update() {
    this.renderFilters();
    this.renderResults();
    this.preview.sync();
  }

  showPreview(seg) {
    this.preview.show(seg);
    this.markActive();
  }

  markActive() {
    const id = this.preview.seg?.id;
    for (const card of this.results.querySelectorAll('.card')) card.classList.toggle('active', card.dataset.seg === id);
  }

  // Filters the review on one code; used by the codebook.
  showCode(id) {
    this.filters = reviewDefaults();
    this.filters.codes.add(id);
    this.invalidate('filters');
  }

  // Filters the review on a keyword from Insights, optionally within one code.
  showTerm(term, codeId, subcodes) {
    this.filters = reviewDefaults();
    this.filters.term = term;
    if (codeId) this.filters.codes.add(codeId);
    this.filters.subcodes = subcodes;
    this.invalidate('filters');
  }

  isFiltered() {
    const f = this.filters;
    return !!(f.query || f.term || f.codes.size || f.docs.size || this.optionFilters().length || f.yearFrom || f.yearTo || f.memoOnly);
  }

  // The options filters in use, as [field, Set of option ids], for fields that still exist.
  optionFilters() {
    const out = [];
    for (const [id, set] of this.filters.options) {
      const field = Fields.get(id);
      const live = new Set(field?.options.filter(o => set.has(o.id)).map(o => o.id));
      if (live.size) out.push([field, live]);
    }
    return out;
  }

  filtered() {
    const f = this.filters;
    const optionFilters = this.optionFilters();
    const query = f.query.trim().toLowerCase();
    const groups = [...f.codes].filter(id => Codes.isActive(id)).map(id => (f.subcodes ? new Set([id, ...Codes.descendants(id)]) : new Set([id])));
    const order = new Map(Docs.sorted().map((d, i) => [d.id, i]));
    return project.segments.filter(seg => {
      const codes = Segs.activeCodes(seg);
      if (!codes.length) return false;
      if (groups.length) {
        const has = group => codes.some(c => group.has(c));
        if (f.match === 'all' ? !groups.every(has) : !groups.some(has)) return false;
      }
      if (f.docs.size && !f.docs.has(seg.docId)) return false;
      if (optionFilters.length) {
        const doc = Docs.get(seg.docId);
        if (!optionFilters.every(([field, set]) => Fields.chosen(doc, field).some(o => set.has(o.id)))) return false;
      }
      if (f.yearFrom || f.yearTo) {
        const year = parseInt(Docs.get(seg.docId).year, 10);
        if (Number.isNaN(year) || (f.yearFrom && year < Number(f.yearFrom)) || (f.yearTo && year > Number(f.yearTo))) return false;
      }
      if (f.memoOnly && !seg.memo) return false;
      if (f.term && !Analysis.contains(seg, f.term)) return false;
      if (query && !`${seg.text}\n${seg.memo}`.toLowerCase().includes(query)) return false;
      return true;
    }).sort((a, b) => order.get(a.docId) - order.get(b.docId) || a.start - b.start);
  }

  renderFilters() {
    const f = this.filters;
    const totals = Segs.countByCode();
    const docTotals = new Map();
    for (const seg of project.segments) if (Segs.visible(seg)) docTotals.set(seg.docId, (docTotals.get(seg.docId) ?? 0) + 1);
    const changed = () => {
      this.renderResults();
      reset.hidden = !this.isFiltered();
    };
    const check = (set, id, label, count, color) => h('label', { class: 'check' },
      h('input', {
        type: 'checkbox', checked: set.has(id),
        onchange: event => {
          if (event.target.checked) set.add(id); else set.delete(id);
          changed();
        },
      }),
      color && swatch(color),
      h('span', { class: 'check-label', text: label }),
      h('span', { class: 'count', text: count || '' }));

    const match = h('div', { class: 'segmented small', role: 'group', 'aria-label': 'Match codes' }, [['any', 'Any'], ['all', 'All']].map(([value, text]) => h('button', {
      type: 'button', text,
      class: f.match === value ? 'active' : '',
      'aria-pressed': String(f.match === value),
      title: value === 'any' ? 'Segments with at least one of the selected codes' : 'Segments with every selected code',
      onclick: () => {
        f.match = value;
        match.querySelectorAll('button').forEach(b => {
          b.classList.toggle('active', b.textContent.toLowerCase() === value);
          b.setAttribute('aria-pressed', String(b.textContent.toLowerCase() === value));
        });
        changed();
      },
    })));
    const year = key => h('input', {
      class: 'input', type: 'number', inputMode: 'numeric', value: f[key], placeholder: key === 'yearFrom' ? 'From' : 'To',
      'aria-label': key === 'yearFrom' ? 'Year from' : 'Year to',
      oninput: event => {
        f[key] = event.target.value.trim();
        changed();
      },
    });
    const reset = h('button', {
      type: 'button', class: 'btn subtle', text: 'Clear filters', hidden: !this.isFiltered(),
      onclick: () => {
        this.filters = reviewDefaults();
        this.renderFilters();
        this.renderResults();
      },
    });
    const tree = Codes.tree();

    const term = f.term && h('div', { class: 'filter-chip' },
      h('span', { class: 'chip' },
        h('span', { class: 'chip-label', text: `${f.term.kind === 'phrases' ? 'Phrase' : 'Keyword'}: ${f.term.label}` }),
        h('button', {
          type: 'button', class: 'chip-remove', 'aria-label': 'Remove keyword filter', text: '×',
          onclick: () => {
            f.term = null;
            this.renderFilters();
            this.renderResults();
          },
        })));

    this.filterPanel.replaceChildren();
    append(this.filterPanel, [
      term,
      h('input', {
        class: 'input', type: 'search', placeholder: 'Search text and memos', 'aria-label': 'Search text and memos', value: f.query,
        oninput: event => {
          f.query = event.target.value;
          reset.hidden = !this.isFiltered();
          this.searchLater();
        },
      }),
      h('section', { class: 'filter-section' },
        h('div', { class: 'filter-head' }, h('h2', { class: 'filter-title', text: 'Codes' }), match),
        h('label', { class: 'check plain' },
          h('input', { type: 'checkbox', checked: f.subcodes, onchange: event => { f.subcodes = event.target.checked; changed(); } }),
          h('span', { class: 'check-label', text: 'Include subcodes' })),
        tree.length
          ? h('div', { class: 'check-list' }, tree.map(({ code, depth }) => {
            const row = check(f.codes, code.id, code.name, totals.get(code.id), code.color);
            row.style.paddingLeft = `${depth * 14}px`;
            return row;
          }))
          : h('p', { class: 'muted small', text: 'No codes yet.' })),
      h('section', { class: 'filter-section' },
        h('h2', { class: 'filter-title', text: 'Documents' }),
        project.documents.length
          ? h('div', { class: 'check-list' }, Docs.sorted().map(d => check(f.docs, d.id, Docs.citation(d), docTotals.get(d.id))))
          : h('p', { class: 'muted small', text: 'No documents yet.' })),
      project.fields.filter(Fields.isList).filter(field => field.options.length).map(field => {
        if (!f.options.has(field.id)) f.options.set(field.id, new Set());
        const counts = new Map();
        for (const seg of project.segments) {
          if (!Segs.visible(seg)) continue;
          for (const o of Fields.chosen(Docs.get(seg.docId), field)) counts.set(o.id, (counts.get(o.id) ?? 0) + 1);
        }
        return h('section', { class: 'filter-section' },
          h('h2', { class: 'filter-title', text: field.name }),
          h('div', { class: 'check-list' }, field.options.map(o => check(f.options.get(field.id), o.id, o.name, counts.get(o.id), o.color))));
      }),
      h('section', { class: 'filter-section' },
        h('h2', { class: 'filter-title', text: 'Publication year' }),
        h('div', { class: 'year-range' }, year('yearFrom'), year('yearTo'))),
      h('label', { class: 'check plain' },
        h('input', { type: 'checkbox', checked: f.memoOnly, onchange: event => { f.memoOnly = event.target.checked; changed(); } }),
        h('span', { class: 'check-label', text: 'Only segments with a memo' })),
      reset]);
  }

  renderResults() {
    const segments = this.filtered();
    const docCount = new Set(segments.map(s => s.docId)).size;
    this.summary.textContent = `${plural(segments.length, 'segment')} from ${plural(docCount, 'document')}`;

    if (!segments.length) {
      const anything = project.segments.some(Segs.visible);
      this.results.replaceChildren(anything
        ? emptyState('No segments match these filters', 'Change or clear the filters to see more.')
        : emptyState('Nothing coded yet', 'Coded segments from every document collect here.', h('button', { type: 'button', class: 'btn primary', text: 'Start coding', onclick: () => App.go('coding') })));
      return;
    }

    let groups;
    if (this.groupBy === 'code') {
      const f = this.filters;
      const chosen = [...f.codes].filter(id => Codes.isActive(id));
      const allowed = chosen.length ? new Set(chosen.flatMap(id => (f.subcodes ? [id, ...Codes.descendants(id)] : [id]))) : null;
      groups = Codes.tree()
        .filter(({ code }) => !allowed || allowed.has(code.id))
        .map(({ code }) => ({
          head: h('div', { class: 'group-head' }, swatch(code.color), h('h2', { class: 'group-title', text: Codes.path(code) })),
          items: segments.filter(s => s.codes.includes(code.id)),
        }));
    } else if (this.groupBy === 'document') {
      groups = [...new Set(segments.map(s => s.docId))].map(id => {
        const doc = Docs.get(id);
        return {
          head: h('div', { class: 'group-head' }, h('h2', { class: 'group-title', text: Docs.citation(doc) }), h('span', { class: 'group-sub', text: doc.title })),
          items: segments.filter(s => s.docId === id),
        };
      });
    } else {
      groups = [{ head: null, items: segments }];
    }

    this.results.replaceChildren(...groups.filter(g => g.items.length).map(g => h('section', { class: 'group' },
      g.head && append(g.head, [h('span', { class: 'count', text: g.items.length })]),
      g.items.map(seg => this.card(seg)))));
    this.markActive();
  }

  // Clicking a card previews the segment in its document; selecting text inside it to copy does not.
  card(seg) {
    const doc = Docs.get(seg.docId);
    const codes = Segs.activeCodes(seg);
    const open = event => {
      if (event.target.closest('button') || getSelection().toString()) return;
      this.showPreview(seg);
    };
    return h('article', {
      class: 'card', tabIndex: 0, dataset: { seg: seg.id },
      'aria-label': `Preview segment from ${Docs.citation(doc)}`,
      onclick: open,
      onkeydown: event => { if (event.key === 'Enter' && event.target === event.currentTarget) this.showPreview(seg); },
    },
    stripes(codes),
    h('div', { class: 'card-main' },
      h('blockquote', { class: 'quote' }, this.filters.term ? markTerm(seg.text, this.filters.term) : seg.text),
      seg.memo && h('p', { class: 'card-memo', text: seg.memo }),
      h('div', { class: 'card-source' },
        h('p', { class: 'card-authors', text: [Docs.byline(doc), Segs.pageLabel(seg)].filter(Boolean).join(', ') }),
        h('p', { class: 'card-title', text: doc.title })),
      h('div', { class: 'chips' }, codes.map(id => codeChip(id)))),
    h('div', { class: 'card-actions' },
      h('button', { type: 'button', class: 'btn subtle small', text: 'Open', title: 'Open in Coding', onclick: () => App.openSegment(seg.docId, seg.id) }),
      h('button', { type: 'button', class: 'btn subtle small', text: 'Edit', onclick: event => Editor.open({ anchor: event.currentTarget.getBoundingClientRect(), segment: seg }) })));
  }

  async export() {
    const segments = this.filtered();
    if (!segments.length) return Toast.show('There are no segments to export.');
    const options = await chooseCsvOptions(this.isFiltered() ? `Export ${plural(segments.length, 'filtered segment')}` : `Export ${plural(segments.length, 'segment')}`, { layouts: true });
    if (!options) return;
    const { header, rows } = segmentRows(segments, options.layout);
    const suffix = { segment: 'segments', code: 'segments-by-code', matrix: 'segments-code-matrix' }[options.layout];
    download(`${fileSlug(project.name)}-${suffix}-${today()}.csv`, toCSV(header, rows, options.delimiter), 'text/csv;charset=utf-8');
  }
}
