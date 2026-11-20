// The codebook: code definitions, the methodological framework, a research journal and the history.
// Nothing here is ever deleted. Codes and journal entries are archived; every saved change is kept in project.log.

const ORIGIN_LABELS = { deductive: 'Deductive', inductive: 'Inductive' };

const APPROACHES = [
  ['inductive', 'Inductive', 'Codes emerge from the data.'],
  ['deductive', 'Deductive', 'Codes come from theory or an existing framework.'],
  ['hybrid', 'Hybrid', 'A starting framework, refined with codes that emerge from the data.'],
];

const JOURNAL_CATEGORIES = { decision: 'Decision', method: 'Methodological note', memo: 'Analytic memo', issue: 'Open issue' };

const CODE_EDITABLE = ['name', 'color', 'parentId', 'origin', 'dimensionId', 'definition', 'inclusion', 'exclusion', 'example', 'notes'];

const FIELD_LABELS = {
  code: {
    name: 'Name', color: 'Color', parentId: 'Parent code', origin: 'Origin', dimensionId: 'Analytical dimension',
    definition: 'Definition', inclusion: 'When to use', exclusion: 'When not to use', example: 'Example', notes: 'Notes',
    archived: 'Status', mergedInto: 'Merged into',
  },
  framework: {
    questions: 'Research questions', approach: 'Coding approach', rationale: 'Rationale', unit: 'Unit of analysis',
    levels: 'Coding levels', dimensions: 'Analytical dimensions', notes: 'Notes',
  },
  journal: { category: 'Category', title: 'Title', body: 'Text', archived: 'Status' },
};

// History rendering

function describeEvent(event) {
  const name = `“${event.label}”`;
  return {
    'code:create': `Created code ${name}`,
    'code:update': `Edited code ${name}`,
    'code:archive': `Archived code ${name}`,
    'code:restore': `Restored code ${name}`,
    'code:merge': `Merged code ${name}`,
    'framework:update': 'Updated the framework',
    'journal:create': `Added journal entry ${name}`,
    'journal:update': `Edited journal entry ${name}`,
    'journal:archive': `Archived journal entry ${name}`,
    'journal:restore': `Restored journal entry ${name}`,
    'document:import': `Imported ${name}`,
    'document:remove': `Removed ${name}`,
  }[`${event.kind}:${event.action}`] ?? `${event.kind} ${event.action}`;
}

function historyValue(key, value) {
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return '';
  switch (key) {
    case 'parentId':
    case 'mergedInto': return Codes.get(value)?.name ?? 'Unknown code';
    case 'dimensionId': return Codes.dimensionName(value) || 'A dimension no longer in the framework';
    case 'origin': return ORIGIN_LABELS[value] ?? value;
    case 'approach': return APPROACHES.find(a => a[0] === value)?.[1] ?? value;
    case 'archived': return value ? 'Archived' : 'Active';
    case 'category': return JOURNAL_CATEGORIES[value] ?? value;
    case 'levels': return value.map((l, i) => `Level ${i + 1}: ${l.name}${l.description ? `. ${l.description}` : ''}`).join('\n');
    case 'dimensions': return value.map(d => `${d.name}${d.description ? `. ${d.description}` : ''}`).join('\n');
    default: return String(value);
  }
}

function historyDiff(event) {
  const labels = FIELD_LABELS[event.kind];
  if (!labels || !event.after) return null;
  const rows = Object.keys(labels)
    .filter(key => !sameJSON(event.before?.[key] ?? null, event.after[key] ?? null))
    .filter(key => event.before || historyValue(key, event.after[key]))
    .map(key => {
      const before = event.before ? historyValue(key, event.before[key]) : null;
      const after = historyValue(key, event.after[key]);
      return h('div', { class: 'diff-row' },
        h('dt', { text: labels[key] }),
        h('dd', null,
          before != null && h('del', { class: before ? '' : 'is-empty', text: before || 'Empty' }),
          h('ins', { class: after ? '' : 'is-empty', text: after || 'Empty' })));
    });
  return rows.length ? h('dl', { class: 'diff' }, rows) : null;
}

function historyList(events, emptyText) {
  if (!events.length) return h('p', { class: 'muted small', text: emptyText });
  return h('ol', { class: 'history' }, [...events].reverse().map(event => {
    const diff = historyDiff(event);
    const summary = [
      h('span', { class: 'history-what', text: describeEvent(event) }),
      h('time', { class: 'history-when', dateTime: event.ts, text: fmtDate(event.ts) }),
      event.note && h('span', { class: 'history-note', text: event.note }),
    ];
    return h('li', { class: 'history-item' }, diff
      ? h('details', null, h('summary', null, summary), diff)
      : h('div', { class: 'history-plain' }, summary));
  }));
}

function eventsFor(kind, ref) {
  return project.log.filter(e => e.kind === kind && (ref == null || e.ref === ref));
}

// Editable list of { id, name, description }, used for coding levels and analytical dimensions.
function listEditor(items, { addLabel, namePlaceholder, blockRemove, onChange }) {
  const host = h('div', { class: 'list-editor' });
  const render = () => {
    host.replaceChildren(
      ...items.map((item, i) => {
        const blocked = blockRemove?.(item);
        return h('div', { class: 'list-row' },
          h('input', { class: 'input', value: item.name, placeholder: namePlaceholder(i), 'aria-label': namePlaceholder(i), oninput: e => { item.name = e.target.value; onChange(); } }),
          h('input', { class: 'input', value: item.description, placeholder: 'Description', 'aria-label': 'Description', oninput: e => { item.description = e.target.value; onChange(); } }),
          h('button', {
            type: 'button', class: 'icon-btn', text: '×', disabled: !!blocked, title: blocked || 'Remove',
            'aria-label': `Remove ${item.name || 'item'}`,
            onclick: () => {
              items.splice(i, 1);
              render();
              onChange();
            },
          }));
      }),
      h('button', {
        type: 'button', class: 'btn subtle small', text: addLabel,
        onclick: () => {
          items.push({ id: uid(), name: '', description: '' });
          render();
          onChange();
          host.querySelectorAll('.list-row')[items.length - 1]?.querySelector('input').focus();
        },
      }));
  };
  render();
  return host;
}

function blankCode(defaults = {}) {
  const approach = project.framework.approach;
  return {
    name: '', color: Codes.nextColor(), parentId: null,
    origin: approach === 'inductive' ? 'inductive' : approach ? 'deductive' : '',
    dimensionId: null, definition: '', inclusion: '', exclusion: '', example: '', notes: '',
    ...defaults,
  };
}

class CodebookView extends View {
  constructor() {
    super('codebook', ['codes', 'segments', 'framework', 'journal', 'log']);
    this.tab = 'codes';
    this.codeId = null;
    this.draft = null;
    this.codeQuery = '';
    this.showArchived = false;
    this.frameworkDraft = null;
    this.showArchivedEntries = false;
    this.editingEntry = null;
    this.historyKind = 'all';
    this.tabs = h('nav', { class: 'segmented', 'aria-label': 'Codebook sections' });
    this.insights = new InsightsView();
    this.body = h('div', { class: 'codebook-body' });
    this.el.append(h('header', { class: 'view-header' }, h('h1', { class: 'view-title', text: 'Codebook' }), this.tabs), this.body);
    bus.on('project', () => {
      this.codeId = null;
      this.draft = null;
      this.frameworkDraft = null;
      this.editingEntry = null;
    });
  }

  update(topics) {
    this.renderTabs();
    const fresh = this.body.dataset.tab !== this.tab;
    this.body.dataset.tab = this.tab;
    // Insights is a view of its own, kept up to date by its own topics while it is shown here.
    if (this.tab === 'insights') {
      if (fresh) this.body.replaceChildren(this.insights.el);
      this.insights.show();
      return;
    }
    this.insights.hide();
    if (this.tab === 'codes') this.renderCodes(fresh);
    else if (this.tab === 'framework') this.renderFramework(fresh || topics.has('all'));
    else if (this.tab === 'journal') this.renderJournal(fresh);
    else this.renderHistory();
  }

  async switchTab(tab) {
    if (tab === this.tab || !await this.leaveDirty()) return;
    this.tab = tab;
    this.update(new Set());
  }

  // Unsaved code or framework edits are confirmed before they are dropped.
  async leaveDirty() {
    const dirty = (this.tab === 'codes' && this.codeDirty()) || (this.tab === 'framework' && this.frameworkDirty());
    if (!dirty) return true;
    const ok = await Dialog.confirm('Discard changes', 'Your unsaved changes will be lost.', { confirmLabel: 'Discard changes', danger: true });
    if (ok) {
      this.draft = null;
      this.frameworkDraft = null;
    }
    return ok;
  }

  show() {
    super.show();
    if (this.tab === 'insights') this.insights.show();
  }

  hide() {
    super.hide();
    this.insights.hide();
  }

  renderTabs() {
    this.tabs.replaceChildren(...[['codes', 'Codes'], ['framework', 'Framework'], ['journal', 'Journal'], ['history', 'History'], ['insights', 'Insights']].map(([key, label]) => h('button', {
      type: 'button', text: label,
      class: this.tab === key ? 'active' : '',
      'aria-pressed': String(this.tab === key),
      onclick: () => this.switchTab(key),
    })));
  }

  // Codes

  codeOriginal() {
    if (this.codeId === 'new') return blankCode(this.draftDefaults);
    const code = Codes.get(this.codeId);
    return code ? pick(code, CODE_EDITABLE) : null;
  }

  codeDirty() {
    return !!this.draft && !sameJSON(this.draft, this.codeOriginal());
  }

  async selectCode(id, defaults) {
    if (id === this.codeId && !defaults) return;
    if (!await this.leaveDirty()) return;
    this.codeId = id;
    this.draftDefaults = defaults;
    this.draft = null;
    this.renderCodes(true);
  }

  renderCodes(fresh) {
    if (fresh || !this.codeListEl) {
      this.codeListEl = h('div', { class: 'cb-list' });
      this.codeDetailEl = h('div', { class: 'cb-detail' });
      this.body.replaceChildren(h('div', { class: 'cb-codes' }, this.codeListEl, this.codeDetailEl));
    }
    if (this.codeId && this.codeId !== 'new' && !Codes.get(this.codeId)) this.codeId = null;
    this.renderCodeList();
    if (fresh || !this.codeDirty()) this.renderCodeDetail();
  }

  renderCodeList() {
    const counts = Segs.countByCode();
    const query = this.codeQuery.trim().toLowerCase();
    const rows = Codes.tree(this.showArchived)
      .filter(({ code }) => !query || `${code.name} ${code.definition}`.toLowerCase().includes(query))
      .map(({ code, depth }) => h('button', {
        type: 'button',
        class: `cb-code${code.id === this.codeId ? ' active' : ''}${code.archived ? ' archived' : ''}`,
        style: { paddingLeft: `${10 + (query ? 0 : depth) * 16}px` },
        onclick: () => this.selectCode(code.id),
      }, swatch(code.color), h('span', { class: 'cb-code-name', text: code.name }),
      code.archived && h('span', { class: 'tag', text: code.mergedInto ? 'Merged' : 'Archived' }),
      h('span', { class: 'count', text: counts.get(code.id) ?? '' })));

    const search = h('input', {
      class: 'input', type: 'search', placeholder: 'Search codes', 'aria-label': 'Search codes', value: this.codeQuery,
      oninput: event => {
        this.codeQuery = event.target.value;
        this.renderCodeList();
        this.codeListEl.querySelector('input[type=search]').focus();
      },
    });
    this.codeListEl.replaceChildren(
      h('div', { class: 'cb-list-tools' },
        search,
        h('button', { type: 'button', class: 'btn primary', text: 'New code', onclick: () => this.selectCode('new', {}) })),
      h('div', { class: 'cb-tree' }, rows.length ? rows : h('p', { class: 'muted small', text: project.codes.length ? 'No codes match.' : 'No codes yet.' })),
      h('div', { class: 'cb-list-foot' },
        h('label', { class: 'check plain' },
          h('input', { type: 'checkbox', checked: this.showArchived, onchange: event => { this.showArchived = event.target.checked; this.renderCodeList(); } }),
          h('span', { class: 'check-label', text: 'Show archived codes' })),
        h('button', { type: 'button', class: 'btn subtle small', text: 'Export codebook CSV', onclick: () => this.exportCodes() })));
    const input = this.codeListEl.querySelector('input[type=search]');
    if (query) input.setSelectionRange(input.value.length, input.value.length);
  }

  renderCodeDetail() {
    const original = this.codeOriginal();
    if (!original) {
      this.draft = null;
      this.codeDetailEl.replaceChildren(emptyState(
        project.codes.length ? 'Choose a code to see its definition' : 'Define your first code',
        'A good codebook entry says what the code means, when to apply it and when not to.',
        h('button', { type: 'button', class: 'btn primary', text: 'New code', onclick: () => this.selectCode('new', {}) })));
      return;
    }
    const isNew = this.codeId === 'new';
    const code = isNew ? null : Codes.get(this.codeId);
    this.draft ??= structuredClone(original);
    const draft = this.draft;
    const excluded = isNew ? new Set() : new Set([code.id, ...Codes.descendants(code.id)]);

    const error = h('p', { class: 'field-error', role: 'alert' });
    const level = h('span', { class: 'muted small' });
    const save = h('button', { type: 'button', class: 'btn primary', text: isNew ? 'Create code' : 'Save changes', onclick: () => this.saveCode() });
    const discard = h('button', {
      type: 'button', class: 'btn subtle', text: isNew ? 'Cancel' : 'Discard changes',
      onclick: () => {
        this.draft = null;
        if (isNew) this.codeId = null;
        this.renderCodes(true);
      },
    });
    const sync = () => {
      const name = draft.name.trim();
      const problem = !name ? 'Give the code a name.' : Codes.nameTaken(name, code?.id) ? 'Another active code already has this name.' : '';
      error.textContent = name || !isNew ? problem : '';
      save.disabled = !!problem || !this.codeDirty();
      discard.hidden = !isNew && !this.codeDirty();
      const parent = Codes.get(draft.parentId);
      level.textContent = Codes.level({ parentId: parent?.id ?? null });
      // Levels name the depths of the tree; a code reaches level 2 by having a parent, so the first codes
      // must be level 1 ones.
      const next = project.framework.levels[1]?.name;
      if (isNew && parentOptions.length === 1 && next) level.textContent += `. Codes for level 2 (${next}) go under a level 1 code: save this one first, then use New subcode.`;
      swatchEl.style.background = draft.color;
    };
    const bind = (key, el, read = e => e.target.value) => {
      el.addEventListener('input', event => {
        draft[key] = read(event);
        sync();
      });
      return el;
    };
    const text = (key, rows) => bind(key, h(rows ? 'textarea' : 'input', { class: 'input', value: draft[key] ?? '', rows }));
    // Id fields store null when empty; origin stores an empty string, matching blankCode().
    const select = (key, options) => bind(key,
      h('select', { class: 'input' }, options.map(([value, label]) => h('option', { value: value ?? '', text: label, selected: (draft[key] ?? '') === (value ?? '') }))),
      e => (key === 'origin' ? e.target.value : e.target.value || null));
    const swatchEl = swatch(draft.color);

    const parentOptions = [[null, 'None, top-level code'], ...Codes.tree()
      .filter(({ code: c }) => !excluded.has(c.id))
      .map(({ code: c, depth }) => [c.id, `${'\u2003'.repeat(depth)}${c.name}`])];
    const dimensions = project.framework.dimensions.filter(d => d.name.trim() || d.id === draft.dimensionId);

    const nodes = [
      h('div', { class: 'detail-head' },
        swatchEl,
        h('h2', { class: 'detail-title', text: isNew ? 'New code' : code.name }),
        code?.archived && h('span', { class: 'tag', text: code.mergedInto ? `Merged into ${Codes.get(code.mergedInto)?.name}` : 'Archived' })),
      h('div', { class: 'form' },
        h('div', { class: 'form-row name-row' },
          field('Name', text('name')),
          field('Color', bind('color', h('input', { class: 'color-input', type: 'color', value: draft.color })))),
        error,
        h('div', { class: 'form-row' },
          field('Parent code', select('parentId', parentOptions), level),
          field('Origin', select('origin', [['', 'Not set'], ['deductive', 'Deductive, from theory'], ['inductive', 'Inductive, from the data']]))),
        field('Analytical dimension', select('dimensionId', [[null, 'None'], ...dimensions.map(d => [d.id, d.name || 'Unnamed dimension'])]),
          dimensions.length ? null : 'Add analytical dimensions in the Framework section.'),
        field('Definition', text('definition', 3), 'What the code means in this study.'),
        h('div', { class: 'form-row' },
          field('When to use', text('inclusion', 3)),
          field('When not to use', text('exclusion', 3))),
        field('Example', text('example', 2), 'A typical passage, paraphrased or quoted.'),
        field('Notes', text('notes', 2))),
      h('div', { class: 'form-actions' }, save, discard),
    ];

    if (!isNew) {
      const count = project.segments.filter(s => s.codes.includes(code.id)).length;
      nodes.push(
        h('div', { class: 'secondary-actions' },
          !code.archived && h('button', {
            type: 'button', class: 'btn subtle', text: `Review ${plural(count, 'segment')}`, disabled: !count,
            onclick: () => {
              App.views.review.showCode(code.id);
              App.go('review');
            },
          }),
          !code.archived && h('button', { type: 'button', class: 'btn subtle', text: 'New subcode', onclick: () => this.selectCode('new', { parentId: code.id }) }),
          !code.archived && h('button', { type: 'button', class: 'btn subtle', text: 'Merge into another code', onclick: () => this.mergeCode(code) }),
          code.archived
            ? h('button', { type: 'button', class: 'btn subtle', text: 'Restore code', onclick: () => this.restoreCode(code) })
            : h('button', { type: 'button', class: 'btn subtle danger-text', text: 'Archive code', onclick: () => this.archiveCode(code) })),
        h('section', { class: 'cb-history' },
          h('h3', { class: 'section-title', text: 'History' }),
          historyList(eventsFor('code', code.id), 'No recorded changes.')));
    }

    this.codeDetailEl.replaceChildren(...nodes);
    sync();
    if (isNew) this.codeDetailEl.querySelector('input').focus();
  }

  saveCode() {
    const fields = { ...this.draft, name: this.draft.name.trim() };
    if (this.codeId === 'new') {
      const code = Actions.createCode(fields);
      this.codeId = code.id;
    } else {
      Actions.updateCode(this.codeId, fields);
    }
    this.draft = null;
    this.renderCodes(true);
    Toast.show('Code saved.');
  }

  async guardDirty() {
    if (!this.codeDirty()) return true;
    await Dialog.alert('Unsaved changes', 'Save or discard your changes to this code first.');
    return false;
  }

  async mergeCode(code) {
    if (!await this.guardDirty()) return;
    const excluded = new Set([code.id, ...Codes.descendants(code.id)]);
    const targets = Codes.tree().filter(({ code: c }) => !excluded.has(c.id));
    if (!targets.length) return Dialog.alert('Merge code', 'There is no other code to merge into.');
    const count = project.segments.filter(s => s.codes.includes(code.id)).length;
    const targetId = await Dialog.select('Merge code',
      `The ${plural(count, 'segment')} coded “${code.name}” will be coded with the code you choose, and “${code.name}” will be archived. Its subcodes move under the chosen code.`,
      targets.map(({ code: c }) => ({ value: c.id, label: Codes.path(c) })), 'Merge');
    if (!targetId) return;
    Actions.mergeCode(code.id, targetId);
    this.codeId = targetId;
    this.draft = null;
    this.renderCodes(true);
  }

  async archiveCode(code) {
    if (!await this.guardDirty()) return;
    if (Codes.activeChildren(code.id).length) {
      return Dialog.alert('Archive code', `“${code.name}” has subcodes. Archive them or move them under another code first.`);
    }
    const hidden = project.segments.filter(s => s.codes.includes(code.id) && Segs.activeCodes(s).length === 1).length;
    const ok = await Dialog.confirm('Archive code',
      `“${code.name}” will no longer be offered for coding. ${hidden ? `${plural(hidden, 'segment')} coded only with it will be hidden until you restore the code. ` : ''}Nothing is deleted.`,
      { confirmLabel: 'Archive code' });
    if (!ok) return;
    this.draft = null;
    Actions.archiveCode(code.id);
  }

  restoreCode(code) {
    if (Codes.nameTaken(code.name, code.id)) {
      return Dialog.alert('Restore code', `An active code is already named “${code.name}”. Rename one of them first.`);
    }
    this.draft = null;
    Actions.restoreCode(code.id);
  }

  async exportCodes() {
    const options = await chooseCsvOptions('Export codebook', { layouts: false });
    if (!options) return;
    const counts = Segs.countByCode();
    const header = ['code', 'code_path', 'level', 'parent', 'color', 'origin', 'analytical_dimension', 'definition', 'when_to_use', 'when_not_to_use', 'example', 'notes', 'segments', 'status', 'created', 'modified'];
    const rows = Codes.tree(true).map(({ code }) => [
      code.name, Codes.path(code), Codes.depth(code) + 1, Codes.get(code.parentId)?.name ?? '', code.color,
      ORIGIN_LABELS[code.origin] ?? '', Codes.dimensionName(code.dimensionId), code.definition, code.inclusion, code.exclusion,
      code.example, code.notes, counts.get(code.id) ?? 0, code.archived ? 'archived' : 'active', code.created, code.modified,
    ]);
    download(`${fileSlug(project.name)}-codebook-${today()}.csv`, toCSV(header, rows, options.delimiter), 'text/csv;charset=utf-8');
  }

  // Framework

  frameworkBody() {
    const { modified: _modified, ...body } = project.framework;
    return body;
  }

  frameworkDirty() {
    return !!this.frameworkDraft && !sameJSON(this.frameworkDraft, this.frameworkBody());
  }

  renderFramework(fresh) {
    if (!fresh && this.frameworkDirty()) {
      this.frameworkHistory?.replaceChildren(historyList(eventsFor('framework'), 'The framework has not been saved yet.'));
      return;
    }
    const draft = this.frameworkDraft = structuredClone(this.frameworkBody());
    const save = h('button', { type: 'button', class: 'btn primary', text: 'Save framework', onclick: () => this.saveFramework() });
    const discard = h('button', {
      type: 'button', class: 'btn subtle', text: 'Discard changes',
      onclick: () => {
        this.frameworkDraft = null;
        this.renderFramework(true);
      },
    });
    const sync = () => {
      save.disabled = !this.frameworkDirty();
      discard.hidden = !this.frameworkDirty();
    };
    const text = (key, rows) => h(rows ? 'textarea' : 'input', { class: 'input', rows, value: draft[key], oninput: e => { draft[key] = e.target.value; sync(); } });
    const usage = new Map();
    for (const code of project.codes) if (code.dimensionId) usage.set(code.dimensionId, (usage.get(code.dimensionId) ?? 0) + 1);

    this.frameworkHistory = h('div');
    this.body.replaceChildren(h('div', { class: 'cb-framework' },
      h('div', { class: 'form wide' },
        field('Research questions', text('questions', 4)),
        h('fieldset', { class: 'fieldset' },
          h('legend', { text: 'Coding approach' }),
          h('div', { class: 'approach-group', role: 'radiogroup' }, APPROACHES.map(([value, label, hint]) => h('label', { class: 'approach' },
            h('input', { type: 'radio', name: 'approach', value, checked: draft.approach === value, onchange: () => { draft.approach = value; sync(); } }),
            h('span', { class: 'approach-label', text: label }),
            h('span', { class: 'approach-hint', text: hint }))))),
        field('Rationale for the approach', text('rationale', 3)),
        field('Unit of analysis', text('unit'), 'For example: sentence, paragraph or meaning unit.'),
        h('fieldset', { class: 'fieldset' },
          h('legend', { text: 'Coding levels' }),
          h('p', { class: 'field-hint', text: 'Level 1 names top-level codes, level 2 their subcodes, and so on. The names appear next to every code.' }),
          listEditor(draft.levels, { addLabel: 'Add level', namePlaceholder: i => `Level ${i + 1} name, for example ${['Theme', 'Category', 'Code'][i] ?? 'Subcode'}`, onChange: sync })),
        h('fieldset', { class: 'fieldset' },
          h('legend', { text: 'Analytical dimensions' }),
          h('p', { class: 'field-hint', text: 'The lenses you code through. Each code can be assigned to one dimension.' }),
          listEditor(draft.dimensions, {
            addLabel: 'Add dimension',
            namePlaceholder: () => 'Dimension name',
            blockRemove: d => (usage.get(d.id) ? `Used by ${plural(usage.get(d.id), 'code')}` : null),
            onChange: sync,
          })),
        field('Notes', text('notes', 4)),
        h('div', { class: 'form-actions' }, save, discard,
          project.framework.modified && h('span', { class: 'muted small', text: `Last saved ${fmtDate(project.framework.modified)}` }))),
      h('section', { class: 'cb-history' },
        h('h3', { class: 'section-title', text: 'History' }),
        this.frameworkHistory)));
    this.frameworkHistory.replaceChildren(historyList(eventsFor('framework'), 'The framework has not been saved yet.'));
    sync();
  }

  saveFramework() {
    const draft = this.frameworkDraft;
    draft.levels = draft.levels.filter(l => l.name.trim() || l.description.trim());
    draft.dimensions = draft.dimensions.filter(d => d.name.trim() || d.description.trim() || project.codes.some(c => c.dimensionId === d.id));
    for (const list of [draft.levels, draft.dimensions]) for (const item of list) {
      item.name = item.name.trim();
      item.description = item.description.trim();
    }
    this.frameworkDraft = null;
    if (Actions.saveFramework(draft)) Toast.show('Framework saved.');
    this.renderFramework(true);
  }

  // Journal

  renderJournal(fresh) {
    if (fresh || !this.journalList) {
      const category = h('select', { class: 'input', 'aria-label': 'Category' }, Object.entries(JOURNAL_CATEGORIES).map(([value, text]) => h('option', { value, text })));
      const title = h('input', { class: 'input', placeholder: 'Title', 'aria-label': 'Title' });
      const body = h('textarea', { class: 'input', rows: 4, placeholder: 'What did you decide, notice or question?', 'aria-label': 'Entry text' });
      const add = () => {
        if (!title.value.trim() && !body.value.trim()) return;
        Actions.addJournal({ category: category.value, title: title.value.trim() || truncate(body.value.trim(), 60), body: body.value });
        title.value = '';
        body.value = '';
      };
      this.journalList = h('div', { class: 'journal-list' });
      this.body.replaceChildren(h('div', { class: 'cb-journal' },
        h('div', { class: 'journal-new' },
          h('div', { class: 'form-row' }, category, title),
          body,
          h('div', { class: 'form-actions' },
            h('button', { type: 'button', class: 'btn primary', text: 'Add entry', onclick: add }),
            h('label', { class: 'check plain' },
              h('input', { type: 'checkbox', checked: this.showArchivedEntries, onchange: e => { this.showArchivedEntries = e.target.checked; this.renderJournalList(); } }),
              h('span', { class: 'check-label', text: 'Show archived entries' })))),
        this.journalList));
    }
    if (!this.journalList.contains(document.activeElement)) this.renderJournalList();
  }

  renderJournalList() {
    const entries = project.journal.filter(e => this.showArchivedEntries || !e.archived).sort((a, b) => b.created.localeCompare(a.created));
    if (!entries.length) {
      this.journalList.replaceChildren(emptyState('No journal entries yet', 'Record coding decisions, methodological choices and open questions as you go. Edits keep every earlier version.'));
      return;
    }
    this.journalList.replaceChildren(...entries.map(entry => (entry.id === this.editingEntry ? this.entryForm(entry) : this.entryCard(entry))));
  }

  entryCard(entry) {
    const versions = eventsFor('journal', entry.id).filter(e => e.action === 'update');
    return h('article', { class: `entry${entry.archived ? ' archived' : ''}` },
      h('header', { class: 'entry-head' },
        h('span', { class: 'tag', text: JOURNAL_CATEGORIES[entry.category] }),
        entry.archived && h('span', { class: 'tag', text: 'Archived' }),
        h('time', { class: 'muted small', dateTime: entry.created, text: fmtDate(entry.created) })),
      h('h3', { class: 'entry-title', text: entry.title }),
      entry.body && h('p', { class: 'entry-body', text: entry.body }),
      versions.length > 0 && h('details', { class: 'entry-versions' },
        h('summary', { text: `${plural(versions.length, 'earlier version')}, last edited ${fmtDate(entry.modified)}` }),
        [...versions].reverse().map(e => h('div', { class: 'entry-version' },
          h('p', { class: 'muted small', text: `Replaced ${fmtDate(e.ts)}` }),
          h('p', { class: 'entry-version-title', text: e.before.title }),
          e.before.body && h('p', { class: 'entry-body', text: e.before.body })))),
      h('div', { class: 'entry-actions' },
        !entry.archived && h('button', { type: 'button', class: 'btn subtle small', text: 'Edit', onclick: () => { this.editingEntry = entry.id; this.renderJournalList(); } }),
        h('button', {
          type: 'button', class: 'btn subtle small', text: entry.archived ? 'Restore' : 'Archive',
          onclick: () => Actions.updateJournal(entry.id, { archived: !entry.archived }, entry.archived ? 'restore' : 'archive'),
        })));
  }

  entryForm(entry) {
    const category = h('select', { class: 'input', 'aria-label': 'Category' }, Object.entries(JOURNAL_CATEGORIES).map(([value, text]) => h('option', { value, text, selected: value === entry.category })));
    const title = h('input', { class: 'input', value: entry.title, 'aria-label': 'Title' });
    const body = h('textarea', { class: 'input', rows: 5, value: entry.body, 'aria-label': 'Entry text' });
    const close = () => {
      this.editingEntry = null;
      this.renderJournalList();
    };
    return h('article', { class: 'entry editing' },
      h('div', { class: 'form-row' }, category, title),
      body,
      h('p', { class: 'field-hint', text: 'Saving keeps the current text as an earlier version.' }),
      h('div', { class: 'form-actions' },
        h('button', {
          type: 'button', class: 'btn primary', text: 'Save entry',
          onclick: () => {
            this.editingEntry = null;
            Actions.updateJournal(entry.id, { category: category.value, title: title.value.trim() || entry.title, body: body.value.trim() });
            this.renderJournalList();
          },
        }),
        h('button', { type: 'button', class: 'btn subtle', text: 'Cancel', onclick: close })));
  }

  // History

  renderHistory() {
    const kinds = [['all', 'All changes'], ['code', 'Codes'], ['framework', 'Framework'], ['journal', 'Journal'], ['document', 'Documents']];
    const events = project.log.filter(e => this.historyKind === 'all' || e.kind === this.historyKind);
    this.body.replaceChildren(h('div', { class: 'cb-log' },
      h('div', { class: 'cb-log-tools' },
        h('select', {
          class: 'input', 'aria-label': 'Show',
          onchange: e => {
            this.historyKind = e.target.value;
            this.renderHistory();
          },
        }, kinds.map(([value, text]) => h('option', { value, text, selected: value === this.historyKind }))),
        h('span', { class: 'muted small', text: plural(events.length, 'recorded change') })),
      historyList(events, 'Changes to codes, the framework, the journal and documents are recorded here.')));
  }
}
