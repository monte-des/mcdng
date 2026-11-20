// Base for the sections. A view re-renders only when visible; changes while hidden are collected
// and applied when it is shown. Several topics emitted by one action are batched into one update.

class View {
  constructor(name, topics) {
    this.el = h('section', { class: `view view-${name}`, hidden: true });
    this.visible = false;
    this.stale = new Set(['all']);
    this.scheduled = false;
    for (const topic of topics) bus.on(topic, () => this.invalidate(topic));
    bus.on('project', () => this.invalidate('all'));
  }

  invalidate(topic) {
    this.stale.add(topic);
    if (!this.visible || this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.flush();
    });
  }

  flush() {
    if (!this.stale.size || !project) return;
    const topics = this.stale;
    this.stale = new Set();
    this.update(topics);
  }

  show() {
    this.visible = true;
    this.el.hidden = false;
    this.flush();
  }

  hide() {
    this.visible = false;
    this.el.hidden = true;
  }
}

// Where the bibliographic details came from, for the document's detail panel.
function metaSourceText(doc) {
  const { source, checked } = doc.meta;
  if (source !== 'file') return `${META_SOURCES[source]}${checked ? `, ${fmtDate(checked, false)}` : ''}.`;
  return checked ? 'Read from the file. No certain match on Crossref.' : 'Read from the file.';
}

const IMPORTABLE = /\.(pdf|docx|txt|md)$/i;

const TYPE_LABELS = { pdf: 'PDF', docx: 'Word', txt: 'Text' };

const DOC_COLUMNS = [
  { key: 'citation', label: 'Reference', value: d => Docs.citation(d) },
  { key: 'authors', label: 'Authors', value: d => d.authors },
  { key: 'title', label: 'Title', value: d => d.title },
  { key: 'journal', label: 'Journal or source', value: d => d.journal },
  { key: 'type', label: 'Type', value: d => TYPE_LABELS[d.type] },
  { key: 'segments', label: 'Segments', value: (d, counts) => counts.get(d.id) ?? 0, numeric: true },
  { key: 'added', label: 'Added', value: d => d.added, format: d => fmtDate(d.added, false) },
];

// The table's columns: options and tags fields come after the journal, shown as small chips.
function docColumns() {
  const lists = project.fields.filter(Fields.isList).map(f => ({
    key: `field:${f.id}`, label: f.name, value: d => Fields.text(d, f),
    cell: d => h('span', { class: 'cell-chips' }, Fields.chosen(d, f).map(o => optionChip(o))),
  }));
  const at = DOC_COLUMNS.findIndex(c => c.key === 'type');
  return [...DOC_COLUMNS.slice(0, at), ...lists, ...DOC_COLUMNS.slice(at)];
}

// One option of an options or tags field, as a small chip; tags carry their colour.
function optionChip(option) {
  return h('span', { class: 'opt-chip', style: option.color ? { '--tag': option.color } : null, title: option.name },
    option.color && swatch(option.color), option.name);
}

class DocumentsView extends View {
  constructor() {
    super('documents', ['documents', 'segments', 'fields']);
    this.sort = { key: 'citation', dir: 1 };
    this.query = '';
    this.selectedId = null;

    this.fileInput = h('input', {
      type: 'file', multiple: true, hidden: true, accept: '.pdf,.docx,.txt,.md',
      onchange: () => {
        this.importFiles([...this.fileInput.files]);
        this.fileInput.value = '';
      },
    });
    this.count = h('span', { class: 'view-count' });
    this.table = h('div', { class: 'doc-table-wrap' });
    this.detail = h('aside', { class: 'doc-detail', 'aria-label': 'Document details' });
    this.el.append(
      h('header', { class: 'view-header' },
        h('h1', { class: 'view-title', text: 'Documents' }),
        this.count,
        h('span', { class: 'spacer' }),
        h('input', {
          class: 'input search', type: 'search', placeholder: 'Search documents', 'aria-label': 'Search documents',
          oninput: event => {
            this.query = event.target.value.trim().toLowerCase();
            this.renderTable();
          },
        }),
        h('button', { type: 'button', class: 'btn', text: 'Find details online', title: 'Look up titles, authors and journals on Crossref for documents with details read only from their files', onclick: () => this.findAllDetails() }),
        h('button', { type: 'button', class: 'btn primary', text: 'Import documents', onclick: () => this.fileInput.click() }),
        this.fileInput),
      h('div', { class: 'doc-layout' }, this.table, this.detail));

    this.el.addEventListener('dragover', event => {
      if (!event.dataTransfer.types.includes('Files')) return;
      event.preventDefault();
      this.el.classList.add('dropping');
    });
    this.el.addEventListener('dragleave', event => {
      if (!this.el.contains(event.relatedTarget)) this.el.classList.remove('dropping');
    });
    this.el.addEventListener('drop', event => {
      event.preventDefault();
      this.el.classList.remove('dropping');
      this.importFiles([...event.dataTransfer.files]);
    });
  }

  update(topics) {
    if (topics.has('all')) this.selectedId = null;
    if (this.selectedId && !Docs.get(this.selectedId)) this.selectedId = null;
    this.renderTable();
    // The form already shows what the user typed, so other changes only refresh its heading and count;
    // rebuilding it would drop focus while tabbing between fields.
    if (topics.has('all') || topics.has('fields') || this.detail.dataset.doc !== this.selectedId) this.renderDetail();
    else this.renderDetailSummary();
  }

  async importFiles(files) {
    if (!files.length) return;
    const accepted = files.filter(f => IMPORTABLE.test(f.name));
    for (const file of files.filter(f => !IMPORTABLE.test(f.name))) {
      Toast.error(`${file.name} was skipped. MCdng imports PDF, Word (.docx) and plain text files.`);
    }
    const progress = Toast.show('', { timeout: 0 });
    const imported = [];
    for (const [i, file] of accepted.entries()) {
      progress.update(`Importing ${i + 1} of ${accepted.length}: ${file.name}`);
      try {
        imported.push((await Library.import(file)).id);
      } catch (err) {
        Toast.error(`Could not import ${file.name}. ${err.message}`);
      }
    }
    progress.close();
    if (!imported.length) return;
    Toast.show(`Imported ${plural(imported.length, 'document')}.`);
    const completed = await Metadata.enrich(imported).catch(() => 0);
    if (completed) Toast.show(`Completed the details of ${plural(completed, 'document')} from Crossref.`);
  }

  // Looks one document up and lets the user choose what to take from the record found.
  async lookUp(doc, button) {
    button.disabled = true;
    button.textContent = 'Looking up…';
    let found;
    try {
      found = await Lookup.find(doc);
    } catch (err) {
      if (!(err instanceof OfflineError)) throw err;
      Toast.error('Crossref could not be reached. Check the connection and try again; the details stay as they are.');
      return;
    } finally {
      button.disabled = false;
      button.textContent = 'Look up details';
    }
    if (!Docs.get(doc.id)) return;
    if (!found.candidates.length) {
      Actions.markMetadataChecked(doc.id);
      Dialog.alert('No record found', doc.doi
        ? `Crossref and DataCite have no record for the DOI ${doc.doi}. Check it, or clear it to search by title.`
        : 'Crossref has no record with this title. Add the DOI if you know it, then look up again.');
      return;
    }
    await this.reviewRecord(doc, found);
  }

  async reviewRecord(doc, found) {
    let record = found.record;
    const choices = found.candidates.length > 1 && h('div', { class: 'radio-group', role: 'radiogroup' }, found.candidates.map((c, i) => h('label', { class: 'radio' },
      h('input', { type: 'radio', name: 'record', checked: c === record, onchange: () => { record = c; renderFields(); } }),
      h('span', null, h('span', { class: 'radio-label', text: c.title }), h('span', { class: 'field-hint', text: [c.authors, c.year, c.journal].filter(Boolean).join(' · ') })))));
    const table = h('div', { class: 'meta-compare' });
    const renderFields = () => {
      table.replaceChildren(h('div', { class: 'meta-row meta-head' }, h('span'), h('span', { text: 'Now' }), h('span', { text: `Found on ${record.source === 'datacite' ? 'DataCite' : 'Crossref'}` })),
        ...META_FIELDS.filter(f => record[f] || doc[f]).map(f => {
          const differs = record[f] && record[f] !== doc[f];
          const edited = doc.meta.edited.includes(f);
          return h('label', { class: `meta-row${differs ? '' : ' same'}` },
            h('span', { class: 'meta-field' }, h('input', { type: 'checkbox', name: f, checked: differs && !edited, disabled: !differs }),
              h('span', null, META_LABELS[f], edited && differs && h('span', { class: 'meta-edited', text: 'edited by you' }))),
            h('span', { class: 'meta-now', text: doc[f] || '—' }),
            h('span', { class: 'meta-found', text: record[f] || '—' }));
        }));
    };
    renderFields();
    const intro = found.sure
      ? 'Choose the details to take. Fields you leave unticked keep their current value; those you edited yourself start unticked.'
      : 'This record may not be the same paper. Compare the details before taking any.';
    const fields = await Dialog.open({
      title: 'Details found online',
      wide: true,
      body: [h('p', { text: intro }), choices && h('fieldset', { class: 'fieldset' }, h('legend', { text: 'Records that match' }), choices), table],
      buttons: [
        { label: 'Cancel', result: null },
        { label: 'Use selected details', kind: 'primary', submit: true, value: () => [...table.querySelectorAll('input:checked')].map(i => i.name) },
      ],
    });
    if (fields && Docs.get(doc.id)) Actions.applyMetadata(doc.id, record, fields);
  }

  // Looks up every document whose details come only from its file, then shows what was found for review.
  async findAllDetails() {
    const docs = project.documents.filter(d => d.meta.source === 'file');
    if (!docs.length) return Toast.show('Every document already has details from Crossref or the publisher.');
    const progress = Toast.show('', { timeout: 0 });
    const results = [];
    try {
      for (const [i, doc] of docs.entries()) {
        progress.update(`Looking up ${i + 1} of ${docs.length}: ${truncate(doc.title, 50)}`);
        const found = await Lookup.find(doc);
        if (found.record) results.push({ doc, ...found });
        else Actions.markMetadataChecked(doc.id);
      }
    } catch (err) {
      if (!(err instanceof OfflineError)) throw err;
      Toast.error('Crossref could not be reached. Check the connection and try again; the details stay as they are.');
    } finally {
      progress.close();
    }
    if (!results.length) {
      if (navigator.onLine) Toast.show(`No records found for ${plural(docs.length, 'document')}.`);
      return;
    }
    const rows = results.map(r => h('label', { class: 'meta-pick' },
      h('input', { type: 'checkbox', checked: r.sure }),
      h('span', { class: 'meta-pick-now' }, h('span', { class: 'meta-pick-label', text: 'Now' }),
        h('span', { text: r.doc.title }),
        h('span', { text: [r.doc.authors, r.doc.year].filter(Boolean).join(', ') || 'No authors or year' })),
      h('span', { class: 'meta-pick-found' }, h('span', { class: 'meta-pick-label', text: r.sure ? 'Found' : 'Possible match' }),
        h('span', { text: r.record.title }),
        h('span', { class: 'muted', text: [r.record.authors, r.record.year, r.record.journal].filter(Boolean).join(', ') }))));
    const picked = await Dialog.open({
      title: 'Details found online',
      wide: true,
      body: [
        h('p', { text: `Records found for ${results.length} of ${plural(docs.length, 'document')}. Ticked rows take every detail from the record, except fields you edited yourself. Possible matches are unticked: check them first.` }),
        h('div', { class: 'meta-picks' }, rows),
      ],
      buttons: [
        { label: 'Cancel', result: null },
        { label: 'Update ticked documents', kind: 'primary', submit: true, value: () => results.filter((_, i) => rows[i].querySelector('input').checked) },
      ],
    });
    for (const r of picked ?? []) if (Docs.get(r.doc.id)) Actions.applyMetadata(r.doc.id, r.record, META_FIELDS.filter(f => !r.doc.meta.edited.includes(f)));
    if (picked?.length) Toast.show(`Updated ${plural(picked.length, 'document')}.`);
  }

  renderTable() {
    const counts = new Map();
    for (const seg of project.segments) if (Segs.visible(seg)) counts.set(seg.docId, (counts.get(seg.docId) ?? 0) + 1);
    this.count.textContent = project.documents.length ? plural(project.documents.length, 'document') : '';

    if (!project.documents.length) {
      this.table.replaceChildren(emptyState(
        'Import the papers you want to code',
        'PDF, Word (.docx) and plain text files. Drop them anywhere on this page or choose them from your computer.',
        h('button', { type: 'button', class: 'btn primary', text: 'Import documents', onclick: () => this.fileInput.click() })));
      return;
    }

    const columns = docColumns();
    if (!columns.some(c => c.key === this.sort.key)) this.sort = { key: 'citation', dir: 1 };
    const column = columns.find(c => c.key === this.sort.key);
    const fieldsText = d => [d.title, d.authors, d.journal, d.year, d.doi, d.file.name, ...project.fields.map(f => Fields.text(d, f))].join(' ').toLowerCase();
    const docs = project.documents
      .filter(d => !this.query || fieldsText(d).includes(this.query))
      .sort((a, b) => {
        const x = column.value(a, counts), y = column.value(b, counts);
        return this.sort.dir * (column.numeric ? x - y : byText(String(x ?? ''), String(y ?? '')));
      });

    const head = h('tr', null, columns.map(c => {
      const sorted = this.sort.key === c.key;
      return h('th', { scope: 'col', class: c.numeric ? 'num' : '', 'aria-sort': sorted ? (this.sort.dir > 0 ? 'ascending' : 'descending') : 'none' },
        h('button', {
          type: 'button', class: 'th-sort',
          onclick: () => {
            this.sort = { key: c.key, dir: sorted ? -this.sort.dir : 1 };
            this.renderTable();
          },
        }, c.label, sorted && h('span', { class: 'sort-mark', 'aria-hidden': 'true', text: this.sort.dir > 0 ? '↑' : '↓' })));
    }));
    const rows = docs.map(d => h('tr', {
      class: d.id === this.selectedId ? 'selected' : '',
      tabIndex: 0,
      onclick: () => this.select(d.id),
      onkeydown: event => { if (event.key === 'Enter') this.select(d.id); },
    }, columns.map(c => (c.cell
      ? h('td', null, c.cell(d))
      : h('td', { class: c.numeric ? 'num' : '', text: c.format ? c.format(d) : c.value(d, counts) })))));

    this.table.replaceChildren(docs.length
      ? h('table', { class: 'doc-table' }, h('thead', null, head), h('tbody', null, rows))
      : emptyState('No documents match this search'));
  }

  select(id) {
    this.selectedId = id;
    this.renderTable();
    this.renderDetail();
  }

  renderDetailSummary() {
    const doc = Docs.get(this.selectedId);
    if (!doc) return;
    this.detail.querySelector('.detail-title').textContent = Docs.citation(doc);
    const segments = Segs.countForDoc(doc.id);
    this.detail.querySelector('.detail-count').textContent = plural(segments, 'coded segment');
    this.detail.querySelector('.folder-path').textContent = `Stored in documents/${doc.folder}`;
    this.detail.querySelector('.meta-source-text').textContent = metaSourceText(doc);
  }

  renderDetail() {
    const doc = this.selectedId && Docs.get(this.selectedId);
    this.detail.hidden = !doc;
    this.detail.dataset.doc = doc ? doc.id : '';
    if (!doc) return this.detail.replaceChildren();

    const input = (key, props = {}) => h(props.multiline ? 'textarea' : 'input', {
      class: 'input', value: doc[key] ?? '', rows: props.rows,
      onchange: event => Actions.updateDocument(doc.id, { [key]: event.target.value.trim() }),
    });
    const segments = Segs.countForDoc(doc.id);

    this.detail.replaceChildren(
      h('div', { class: 'detail-head' },
        h('h2', { class: 'detail-title', text: Docs.citation(doc) }),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close details', text: '×', onclick: () => this.select(null) })),
      h('p', { class: 'detail-meta', text: `${doc.file.name}, ${TYPE_LABELS[doc.type]}${doc.pages ? `, ${plural(doc.pages, 'page')}` : ''}. Added ${fmtDate(doc.added)}.` }),
      h('p', { class: 'detail-meta folder-path', text: `Stored in documents/${doc.folder}` }),
      h('div', { class: 'meta-source' },
        h('span', { class: 'meta-source-text', text: metaSourceText(doc) }),
        h('button', { type: 'button', class: 'btn small', text: 'Look up details', onclick: event => this.lookUp(doc, event.currentTarget) })),
      h('div', { class: 'detail-actions' },
        h('button', { type: 'button', class: 'btn primary', text: 'Open for coding', onclick: () => App.openSegment(doc.id) }),
        h('span', { class: 'detail-count', text: plural(segments, 'coded segment') })),
      h('div', { class: 'form' },
        field('Title', input('title', { multiline: true, rows: 2 })),
        field('Authors', input('authors'), 'Separate authors with semicolons, for example: Smith, J.; Lee, K.'),
        h('div', { class: 'form-row' },
          field('Year', input('year')),
          field('Journal or source', input('journal'))),
        h('div', { class: 'form-row thirds' },
          field('Volume', input('volume')),
          field('Issue', input('issue')),
          field('Pages', input('articlePages'))),
        field('DOI', input('doi'), doc.doi && h('a', { href: `https://doi.org/${doc.doi}`, target: '_blank', rel: 'noopener', text: 'Open DOI link' })),
        project.fields.map(f => this.fieldControl(doc, f)),
        field('Memo', input('memo', { multiline: true, rows: 5 }), 'Notes on the paper as a whole.')),
      h('div', { class: 'detail-foot' },
        h('button', { type: 'button', class: 'btn subtle', text: 'Edit document fields', title: 'Add, rename or remove fields shared by all documents', onclick: () => this.editFields() }),
        h('button', { type: 'button', class: 'btn subtle danger-text', text: 'Remove document', onclick: () => this.remove(doc) })));
  }

  // A custom field in the detail panel. Options and tags toggle in place, so the panel keeps its scroll and focus.
  fieldControl(doc, f) {
    if (f.type === 'text') {
      return field(f.name, h('input', {
        class: 'input', value: Fields.text(doc, f),
        onchange: event => Actions.updateDocument(doc.id, { fields: { ...doc.fields, [f.id]: event.target.value.trim() } }),
      }));
    }
    const chosen = new Set(Fields.chosen(doc, f).map(o => o.id));
    const toggle = option => h('button', {
      type: 'button', class: f.type === 'tags' ? 'tag-toggle' : '', 'aria-pressed': String(chosen.has(option.id)),
      style: option.color ? { '--tag': option.color } : null,
      onclick: event => {
        const on = event.currentTarget.getAttribute('aria-pressed') !== 'true';
        event.currentTarget.setAttribute('aria-pressed', String(on));
        Actions.toggleFieldOption(doc.id, f.id, option.id, on);
      },
    }, option.color && swatch(option.color), option.name);
    const group = (cls, items) => h('div', { class: cls, role: 'group', 'aria-label': f.name }, items);

    if (f.type === 'options') {
      return h('div', { class: 'field' },
        h('span', { class: 'field-label', text: f.name }),
        f.options.length
          ? group('toggles', f.options.map(toggle))
          : h('button', { type: 'button', class: 'btn small fit', text: 'Add options', onclick: () => this.editFields(f.id) }));
    }
    // Tags: every tag of the field, ticked or not, and a box to add a new one to this document.
    const add = h('input', {
      class: 'tag-new', placeholder: f.options.length ? 'New tag' : 'Add a tag', 'aria-label': `New tag for ${f.name}`, 'data-field': f.id,
      onkeydown: event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const name = event.target.value.trim();
        if (!name) return;
        const option = Actions.addFieldOption(f.id, name);
        Actions.toggleFieldOption(doc.id, f.id, option.id, true);
        // Rebuild the panel now, so the new tag shows ticked and the box keeps focus for the next one.
        this.stale.add('fields');
        this.flush();
        this.detail.querySelector(`.tag-new[data-field="${f.id}"]`)?.focus();
      },
    });
    return h('div', { class: 'field' },
      h('span', { class: 'field-label', text: f.name }),
      group('tag-picker', [...f.options.map(toggle), add]));
  }

  async remove(doc) {
    const count = project.segments.filter(s => s.docId === doc.id).length;
    const ok = await Dialog.confirm('Remove document',
      `“${doc.title}” and its ${plural(count, 'coded segment')} will be removed from the project. The removal is recorded in the history.`,
      { confirmLabel: 'Remove document', danger: true });
    if (ok) await Actions.removeDocument(doc.id);
  }

  // Extra fields defined per project, such as study design (text), the research question a paper answers
  // (options) or tags. `focusId` opens with that field's new-option box focused.
  editFields(focusId = null) {
    const list = h('div', { class: 'field-list' });
    const removeButton = (label, onclick) => h('button', { type: 'button', class: 'icon-btn', 'aria-label': label, title: label, text: '×', onclick });
    const onEnter = run => event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      run();
    };

    const optionRow = (f, o) => h('div', { class: 'option-item' },
      f.type === 'tags' && h('input', {
        type: 'color', class: 'color-input small', value: o.color, 'aria-label': `Colour of ${o.name}`,
        onchange: event => Actions.updateFieldOption(f.id, o.id, { color: event.target.value }),
      }),
      h('input', {
        class: 'input', value: o.name, 'aria-label': 'Option name',
        onchange: event => {
          const name = event.target.value.replace(/\s+/g, ' ').trim();
          const taken = f.options.some(x => x.id !== o.id && x.name.toLowerCase() === name.toLowerCase());
          if (name && !taken) Actions.updateFieldOption(f.id, o.id, { name });
          else event.target.value = o.name;
        },
      }),
      removeButton(`Remove ${o.name}`, async () => {
        const used = project.documents.filter(d => Fields.chosen(d, f).includes(o)).length;
        if (used && !await Dialog.confirm(`Remove “${o.name}”`, `“${o.name}” is ticked on ${plural(used, 'document')}. It will be removed from them.`, { confirmLabel: 'Remove', danger: true })) return;
        Actions.removeFieldOption(f.id, o.id);
        render();
      }));

    const fieldBlock = f => {
      const block = h('div', { class: 'field-block' },
        h('div', { class: 'field-item' },
          h('input', {
            class: 'input', value: f.name, 'aria-label': 'Field name',
            onchange: event => (event.target.value.trim() ? Actions.renameField(f.id, event.target.value) : (event.target.value = f.name)),
          }),
          h('span', { class: 'tag', text: FIELD_TYPES.find(t => t[0] === f.type)[1] }),
          removeButton(`Remove ${f.name}`, async () => {
            const used = Fields.used(f);
            if (used && !await Dialog.confirm('Remove field', `“${f.name}” has values in ${plural(used, 'document')}. They will be removed.`, { confirmLabel: 'Remove field', danger: true })) return;
            Actions.removeField(f.id);
            render();
          })));
      if (Fields.isList(f)) {
        // Several options at once, separated by commas: "Q1, Q2, Q3, SB".
        const name = h('input', {
          class: 'input', 'data-field': f.id, 'aria-label': `New option for ${f.name}`,
          placeholder: f.type === 'tags' ? 'New tags, separated by commas' : 'New options, separated by commas, such as Q1, Q2, Q3, SB',
        });
        const add = () => {
          const names = name.value.split(',').map(n => n.trim()).filter(Boolean);
          if (!names.length) return;
          for (const n of names) Actions.addFieldOption(f.id, n);
          render();
          list.querySelector(`input[data-field="${f.id}"]`).focus();
        };
        name.addEventListener('keydown', onEnter(add));
        block.append(h('div', { class: 'field-options' },
          f.options.map(o => optionRow(f, o)),
          h('div', { class: 'field-add' }, name, h('button', { type: 'button', class: 'btn', text: 'Add', onclick: add }))));
      }
      return block;
    };
    const render = () => list.replaceChildren(...(project.fields.length
      ? project.fields.map(fieldBlock)
      : [h('p', { class: 'muted', text: 'No custom fields yet.' })]));

    let type = 'text';
    const hint = h('p', { class: 'field-hint' });
    const types = h('div', { class: 'segmented small', role: 'group', 'aria-label': 'Field type' }, FIELD_TYPES.map(([value, label]) => h('button', {
      type: 'button', text: label, dataset: { type: value },
      onclick: () => {
        type = value;
        syncType();
      },
    })));
    const syncType = () => {
      for (const b of types.children) {
        b.classList.toggle('active', b.dataset.type === type);
        b.setAttribute('aria-pressed', String(b.dataset.type === type));
      }
      hint.textContent = FIELD_TYPES.find(t => t[0] === type)[2];
    };
    const name = h('input', { class: 'input', placeholder: 'New field name', 'aria-label': 'New field name' });
    const add = () => {
      if (!name.value.trim()) return;
      const f = Actions.addField(name.value, type);
      name.value = '';
      render();
      (Fields.isList(f) ? list.querySelector(`input[data-field="${f.id}"]`) : name).focus();
    };
    name.addEventListener('keydown', onEnter(add));
    render();
    syncType();
    Dialog.open({
      title: 'Document fields',
      wide: 'medium',
      body: [
        h('p', { class: 'muted', text: 'Fields appear on every document and as columns in CSV exports. Options and tags can be ticked in any number, and filter the Review.' }),
        list,
        h('div', { class: 'field-new' },
          h('div', { class: 'field-add' }, name, types, h('button', { type: 'button', class: 'btn', text: 'Add field', onclick: add })),
          hint),
      ],
      buttons: [{ label: 'Done', kind: 'primary', result: true }],
      initialFocus: (focusId && list.querySelector(`input[data-field="${focusId}"]`)) || name,
    });
  }
}
