// Project state. Every change goes through Actions, which saves, logs and notifies the views.

const FORMAT = 'mcdng/1';
// Projects created before the tool was renamed carry the old format name and open unchanged.
const LEGACY_FORMATS = ['marginalia/1'];
const PROJECT_FILE = 'project.json';

let project = null;

const bus = {
  handlers: new Map(),

  on(topic, fn) {
    if (!this.handlers.has(topic)) this.handlers.set(topic, new Set());
    this.handlers.get(topic).add(fn);
  },

  emit(topic, detail) {
    for (const fn of this.handlers.get(topic) ?? []) fn(detail, topic);
  },
};

function emptyFramework() {
  return { questions: '', approach: '', rationale: '', unit: '', levels: [], dimensions: [], notes: '' };
}

function emptyProject(name) {
  const now = nowISO();
  return {
    format: FORMAT, name, created: now, modified: now,
    documents: [], fields: [], codes: [], segments: [],
    framework: emptyFramework(), journal: [], log: [],
    keywords: { excluded: [] },
  };
}

function normalizeProject(data) {
  if (data?.format !== FORMAT && !LEGACY_FORMATS.includes(data?.format)) throw new Error('project.json is not an MCdng project file.');
  const base = emptyProject(data.name);
  // Fields added in later versions get their empty values, so older projects open unchanged.
  const documents = (data.documents ?? []).map(d => ({ volume: '', issue: '', articlePages: '', ...d, meta: { ...emptyDocMeta(), ...d.meta } }));
  const fields = (data.fields ?? []).map(f => ({ type: 'text', options: [], ...f }));
  // Options made before they had colours take the sections' colours in order.
  for (const field of fields) {
    field.options = field.options.map(o => ({ ...o }));
    for (const option of field.options) if (!option.color) option.color = Fields.nextColor(field);
  }
  return { ...base, ...data, format: FORMAT, documents, fields, framework: { ...base.framework, ...data.framework }, keywords: { ...base.keywords, ...data.keywords } };
}

// Saves project.json shortly after each change. With a folder on the computer, it first checks that the file is
// still the one MCdng last read or wrote: a sync app (Google Drive, iCloud) may have brought in a version saved on
// another device, which is then not overwritten silently ('conflict', decided by the user in App).
const Saver = {
  timer: null,
  queue: Promise.resolve(),
  status: 'saved',
  error: null,
  base: null, // folder only: { stamp, text } of project.json as last read or written here

  schedule() {
    project.modified = nowISO();
    if (this.status !== 'conflict') this.setStatus('pending');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 600);
  },

  flush() {
    clearTimeout(this.timer);
    if (!project || this.status !== 'pending') return this.queue;
    const json = JSON.stringify(project, null, 1);
    this.queue = this.queue
      .then(() => this.unchanged())
      .then(async same => {
        if (!same) return;
        await Disk.write(PROJECT_FILE, json);
        await this.remember(json);
        this.setStatus('saved');
      })
      .catch(err => this.setStatus('error', err));
    return this.queue;
  },

  async remember(text) {
    this.base = Disk.mode === 'folder' ? { stamp: await FolderStore.stamp(PROJECT_FILE), text } : null;
  },

  // Whether project.json is as MCdng left it; when not, raises the conflict and resolves with false.
  async unchanged() {
    if (!this.base) return true;
    const stamp = await FolderStore.stamp(PROJECT_FILE).catch(() => null);
    if (stamp === this.base.stamp) return true;
    const text = stamp && await Disk.readText(PROJECT_FILE).catch(() => null);
    // Removed, or rewritten with the same content: nothing to lose.
    if (!text || text === this.base.text) return true;
    this.setStatus('conflict');
    bus.emit('conflict', { text });
    return false;
  },

  // Folder only, when MCdng comes back to the front: picks up a version saved on another device. Resolves with
  // its text when the project here has no unsaved change and can simply be reloaded.
  async incoming() {
    if (!this.base || this.status === 'conflict') return null;
    await this.queue;
    const stamp = await FolderStore.stamp(PROJECT_FILE).catch(() => null);
    if (!stamp || stamp === this.base.stamp) return null;
    const text = await Disk.readText(PROJECT_FILE).catch(() => null);
    if (!text || text === this.base.text) return null;
    if (this.status === 'pending') {
      this.setStatus('conflict');
      bus.emit('conflict', { text });
      return null;
    }
    return text;
  },

  setStatus(status, error = null) {
    this.status = status;
    this.error = error;
    bus.emit('save');
  },
};

function commit(...topics) {
  Saver.schedule();
  for (const topic of topics) bus.emit(topic);
}

// Document contents (extracted text and page geometry) live in their own files and load on demand.
const Contents = {
  cache: new Map(),

  async get(docId) {
    if (!this.cache.has(docId)) {
      this.cache.set(docId, Library.idle().then(() => Disk.readText(Library.textPath(Docs.get(docId)))).then(JSON.parse));
    }
    try {
      return await this.cache.get(docId);
    } catch (err) {
      this.cache.delete(docId);
      throw err;
    }
  },
};

// Queries

const Docs = {
  get: id => project.documents.find(d => d.id === id),

  surname(author) {
    const name = author.trim();
    return name.includes(',') ? name.split(',')[0].trim() : name.split(/\s+/).pop();
  },

  // "Smith", "Smith & Lee", "Smith et al.", or "" without authors
  authorLabel(doc) {
    const authors = doc.authors.split(/;|\band\b|&/).map(a => a.trim()).filter(Boolean);
    if (authors.length > 2) return `${this.surname(authors[0])} et al.`;
    return authors.map(a => this.surname(a)).join(' & ');
  },

  // Full author list with year, as written in the document's metadata: "Smith, J.; Lee, K. (2021)".
  byline(doc) {
    return `${doc.authors || 'Unknown authors'} (${doc.year || 'n.d.'})`;
  },

  // "Smith & Lee (2021)"; the title stands in when there are no authors.
  citation(doc) {
    return `${this.authorLabel(doc) || truncate(doc.title, 40)} (${doc.year || 'n.d.'})`;
  },

  sorted() {
    return [...project.documents].sort((a, b) => byText(this.citation(a), this.citation(b)));
  },
};

const Codes = {
  get: id => project.codes.find(c => c.id === id),

  isActive(id) {
    const code = this.get(id);
    return !!code && !code.archived;
  },

  // Depth-first list of { code, depth }. A code whose parent is outside the list becomes a root.
  tree(includeArchived = false) {
    const list = project.codes.filter(c => includeArchived || !c.archived);
    const ids = new Set(list.map(c => c.id));
    const children = new Map();
    for (const code of list) {
      const parent = ids.has(code.parentId) ? code.parentId : null;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(code);
    }
    const out = [];
    const walk = (parent, depth) => {
      for (const code of (children.get(parent) ?? []).sort((a, b) => byText(a.name, b.name))) {
        out.push({ code, depth });
        walk(code.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  },

  depth(code) {
    let depth = 0;
    for (let c = this.get(code.parentId); c; c = this.get(c.parentId)) depth++;
    return depth;
  },

  // The code and its ancestors, from the top level down.
  lineage(code) {
    const line = [code];
    for (let c = this.get(code.parentId); c; c = this.get(c.parentId)) line.unshift(c);
    return line;
  },

  path(code) {
    return this.lineage(code).map(c => c.name).join(' › ');
  },

  descendants(id) {
    const out = new Set();
    const walk = parentId => {
      for (const c of project.codes) {
        if (c.parentId === parentId && !out.has(c.id)) {
          out.add(c.id);
          walk(c.id);
        }
      }
    };
    walk(id);
    return out;
  },

  activeChildren(id) {
    return project.codes.filter(c => c.parentId === id && !c.archived);
  },

  nameTaken(name, exceptId) {
    const key = name.trim().toLowerCase();
    return project.codes.some(c => c.id !== exceptId && !c.archived && c.name.trim().toLowerCase() === key);
  },

  nextColor() {
    const used = new Map(CODE_PALETTE.map(c => [c, 0]));
    for (const code of project.codes) if (!code.archived && used.has(code.color)) used.set(code.color, used.get(code.color) + 1);
    return [...used.entries()].sort((a, b) => a[1] - b[1])[0][0];
  },

  // Codes keep the same order everywhere so stripes and chips stay stable.
  rank() {
    return new Map(this.tree(true).map(({ code }, i) => [code.id, i]));
  },

  ordered(ids, rank = this.rank()) {
    return [...ids].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  },

  level(code) {
    const depth = this.depth(code);
    const label = project.framework.levels[depth]?.name;
    return label ? `Level ${depth + 1}: ${label}` : `Level ${depth + 1}`;
  },

  dimensionName(id) {
    return project.framework.dimensions.find(d => d.id === id)?.name ?? '';
  },
};

// Custom document fields. A text field holds a string; an options field (a fixed list, such as Q1, Q2, Q3, SB)
// and a tags field (coloured tags, added while working) hold the ids of the options chosen, in any number.
// Options take the sections' colours in turn (owner's choice, 20 November 2026): a chosen option is edged with
// that section's gradient, and its colour (the section's ink) marks it in the table and the Review filters.
const OPTION_ZONES = [
  ['documents', '#2c7446'], ['coding', '#6343c4'], ['review', '#b8355f'], ['codebook', '#985a12'], ['insights', '#1d6784'],
];
const FIELD_TYPES = [
  ['text', 'Text', 'Free text, such as a country or a study design.'],
  ['options', 'Options', 'A fixed list to tick, any number at once, such as Q1, Q2, Q3, SB.'],
  ['tags', 'Tags', 'Coloured tags, any number at once; new tags can be added from any document.'],
];

const Fields = {
  get: id => project.fields.find(f => f.id === id),

  isList: field => field.type === 'options' || field.type === 'tags',

  // The options a document has, in the field's own order.
  chosen(doc, field) {
    const ids = doc.fields[field.id];
    return Array.isArray(ids) ? field.options.filter(o => ids.includes(o.id)) : [];
  },

  // A field's value as text, for CSV and search; options are joined with semicolons.
  text(doc, field) {
    if (this.isList(field)) return this.chosen(doc, field).map(o => o.name).join('; ');
    return typeof doc.fields[field.id] === 'string' ? doc.fields[field.id] : '';
  },

  used(field) {
    return project.documents.filter(d => this.text(d, field)).length;
  },

  // The section whose colour an option has, or null for a colour chosen by hand.
  zone(option) {
    return OPTION_ZONES.find(([, color]) => color === option.color)?.[0] ?? null;
  },

  nextColor(field) {
    const palette = field.type === 'options' ? OPTION_ZONES.map(([, color]) => color) : CODE_PALETTE;
    const used = new Map(palette.map(c => [c, 0]));
    for (const o of field.options) if (used.has(o.color)) used.set(o.color, used.get(o.color) + 1);
    return [...used].sort((a, b) => a[1] - b[1])[0][0];
  },
};

const Segs = {
  get: id => project.segments.find(s => s.id === id),

  activeCodes(seg) {
    return Codes.ordered(seg.codes.filter(id => Codes.isActive(id)));
  },

  // Segments whose codes are all archived stay in the project but are not shown.
  visible(seg) {
    return seg.codes.some(id => Codes.isActive(id));
  },

  forDoc(docId) {
    return project.segments.filter(s => s.docId === docId).sort((a, b) => a.start - b.start || a.end - b.end);
  },

  countForDoc(docId) {
    return project.segments.filter(s => s.docId === docId && this.visible(s)).length;
  },

  countByCode() {
    const counts = new Map();
    for (const seg of project.segments) for (const id of seg.codes) counts.set(id, (counts.get(id) ?? 0) + 1);
    return counts;
  },

  pageLabel(seg) {
    if (!seg.page) return '';
    return seg.pageEnd && seg.pageEnd !== seg.page ? `pp. ${seg.page}–${seg.pageEnd}` : `p. ${seg.page}`;
  },
};

function pageAt(content, offset) {
  return content.pages ? lastAtOrBefore(content.pages, offset, p => p.start) + 1 : null;
}

// Mutations

const CODE_FIELDS = ['name', 'color', 'parentId', 'origin', 'dimensionId', 'definition', 'inclusion', 'exclusion', 'example', 'notes', 'archived', 'mergedInto'];
const JOURNAL_FIELDS = ['category', 'title', 'body', 'archived'];

function pick(obj, keys) {
  return Object.fromEntries(keys.map(k => [k, obj[k]]));
}

function logEvent(kind, action, ref, label, before = null, after = null, note = '') {
  project.log.push({ id: uid(), ts: nowISO(), kind, action, ref, label, before, after, note });
}

const Actions = {
  // Documents

  addDocument(doc) {
    project.documents.push(doc);
    logEvent('document', 'import', doc.id, doc.title, null, null, doc.file.name);
    commit('documents', 'log');
  },

  // An edit by the user: the bibliographic fields it touches are never replaced by a background lookup.
  updateDocument(id, patch) {
    const doc = Docs.get(id);
    Object.assign(doc, patch);
    const edited = META_FIELDS.filter(f => f in patch && !doc.meta.edited.includes(f));
    if (edited.length) doc.meta.edited.push(...edited);
    commit('documents');
    if (['title', 'authors', 'year'].some(key => key in patch)) Library.syncFolderSoon(id);
  },

  // Details found online. `fields` are those to take from the record; empty values in it change nothing.
  applyMetadata(id, record, fields = META_FIELDS) {
    const doc = Docs.get(id);
    const patch = Object.fromEntries(fields.filter(f => record[f]).map(f => [f, record[f]]));
    Object.assign(doc, patch);
    doc.meta = { ...doc.meta, source: record.source, checked: nowISO(), guessed: doc.meta.guessed.filter(f => !(f in patch)) };
    commit('documents');
    if (['title', 'authors', 'year'].some(key => key in patch)) Library.syncFolderSoon(id);
  },

  // A lookup found nothing certain: remembered so the document says it was checked.
  markMetadataChecked(id) {
    Docs.get(id).meta.checked = nowISO();
    commit('documents');
  },

  async removeDocument(id) {
    const doc = Docs.get(id);
    const removed = project.segments.filter(s => s.docId === id).length;
    project.documents = project.documents.filter(d => d.id !== id);
    project.segments = project.segments.filter(s => s.docId !== id);
    Contents.cache.delete(id);
    logEvent('document', 'remove', id, doc.title, null, null, plural(removed, 'segment'));
    commit('documents', 'segments', 'log');
    await Library.remove(doc);
  },

  // Custom document fields

  addField(name, type = 'text') {
    const field = { id: uid(), name: name.trim(), type, options: [] };
    project.fields.push(field);
    commit('fields');
    return field;
  },

  renameField(id, name) {
    project.fields.find(f => f.id === id).name = name.trim();
    commit('fields');
  },

  removeField(id) {
    project.fields = project.fields.filter(f => f.id !== id);
    for (const doc of project.documents) delete doc.fields[id];
    commit('fields', 'documents');
  },

  // Options of an options or tags field. Names are unique within a field, ignoring case: adding an existing
  // name returns that option.
  addFieldOption(fieldId, name) {
    const field = Fields.get(fieldId);
    const clean = name.replace(/\s+/g, ' ').trim();
    const same = field.options.find(o => o.name.toLowerCase() === clean.toLowerCase());
    if (same) return same;
    const option = { id: uid(), name: clean, color: Fields.nextColor(field) };
    field.options.push(option);
    commit('fields');
    return option;
  },

  updateFieldOption(fieldId, optionId, patch) {
    Object.assign(Fields.get(fieldId).options.find(o => o.id === optionId), patch);
    commit('fields');
  },

  removeFieldOption(fieldId, optionId) {
    const field = Fields.get(fieldId);
    field.options = field.options.filter(o => o.id !== optionId);
    for (const doc of project.documents) {
      const ids = doc.fields[fieldId];
      if (Array.isArray(ids)) doc.fields[fieldId] = ids.filter(id => id !== optionId);
    }
    commit('fields', 'documents');
  },

  // Ticks or unticks one option of a document.
  toggleFieldOption(docId, fieldId, optionId, on) {
    const doc = Docs.get(docId);
    const ids = Array.isArray(doc.fields[fieldId]) ? doc.fields[fieldId] : [];
    const next = on ? [...new Set([...ids, optionId])] : ids.filter(id => id !== optionId);
    this.updateDocument(docId, { fields: { ...doc.fields, [fieldId]: next } });
  },

  // Segments

  createSegment({ doc, content, start, end, codes, memo }) {
    const now = nowISO();
    const existing = project.segments.find(s => s.docId === doc.id && s.start === start && s.end === end);
    if (existing) {
      existing.codes = Codes.ordered(new Set([...existing.codes, ...codes]));
      if (memo && !existing.memo) existing.memo = memo;
      existing.modified = now;
      commit('segments');
      return existing;
    }
    let text = content.text.slice(start, end);
    // Single line breaks become spaces; blank lines between paragraphs stay.
    if (content.reflow) text = text.replace(/(^|[^\n])\n(?!\n)/g, '$1 ');
    const seg = {
      id: uid(), docId: doc.id, start, end, text,
      page: pageAt(content, start), pageEnd: pageAt(content, end - 1),
      codes: Codes.ordered(codes), memo, created: now, modified: now,
    };
    project.segments.push(seg);
    commit('segments');
    return seg;
  },

  updateSegment(id, { codes, memo }) {
    const seg = Segs.get(id);
    seg.codes = Codes.ordered(codes);
    seg.memo = memo;
    seg.modified = nowISO();
    commit('segments');
  },

  deleteSegment(id) {
    project.segments = project.segments.filter(s => s.id !== id);
    commit('segments');
  },

  // Codes: never deleted. Archive hides them, merge archives the source, and every change is logged.

  createCode(fields) {
    const now = nowISO();
    const code = {
      id: uid(), name: fields.name.trim(), color: fields.color ?? Codes.nextColor(),
      parentId: fields.parentId ?? null, origin: fields.origin ?? '', dimensionId: fields.dimensionId ?? null,
      definition: '', inclusion: '', exclusion: '', example: '', notes: '',
      archived: false, mergedInto: null, created: now, modified: now,
    };
    for (const key of CODE_FIELDS) if (key in fields) code[key] = fields[key];
    project.codes.push(code);
    logEvent('code', 'create', code.id, code.name, null, pick(code, CODE_FIELDS));
    commit('codes', 'log');
    return code;
  },

  updateCode(id, patch, action = 'update', note = '') {
    const code = Codes.get(id);
    const before = pick(code, CODE_FIELDS);
    Object.assign(code, patch);
    const after = pick(code, CODE_FIELDS);
    if (sameJSON(before, after)) return false;
    code.modified = nowISO();
    logEvent('code', action, id, code.name, before, after, note);
    commit('codes', 'log');
    return true;
  },

  archiveCode(id) {
    this.updateCode(id, { archived: true }, 'archive');
    bus.emit('segments');
  },

  restoreCode(id) {
    const code = Codes.get(id);
    const parent = Codes.get(code.parentId);
    const patch = { archived: false, mergedInto: null };
    if (parent?.archived) patch.parentId = null;
    this.updateCode(id, patch, 'restore');
    bus.emit('segments');
  },

  mergeCode(sourceId, targetId) {
    const source = Codes.get(sourceId);
    const target = Codes.get(targetId);
    const moved = [];
    for (const seg of project.segments) {
      if (!seg.codes.includes(sourceId)) continue;
      seg.codes = Codes.ordered(new Set(seg.codes.map(c => (c === sourceId ? targetId : c))));
      seg.modified = nowISO();
      moved.push(seg.id);
    }
    for (const child of Codes.activeChildren(sourceId)) {
      this.updateCode(child.id, { parentId: targetId }, 'update', `Moved under “${target.name}” when “${source.name}” was merged`);
    }
    this.updateCode(sourceId, { archived: true, mergedInto: targetId }, 'merge',
      `Merged into “${target.name}”, ${plural(moved.length, 'segment')} recoded`);
    project.log.at(-1).segments = moved;
    commit('segments');
  },

  // Framework: saved as whole snapshots so every earlier version stays readable.

  saveFramework(next) {
    const before = structuredClone(project.framework);
    const after = { ...structuredClone(next), modified: nowISO() };
    const { modified: _a, ...beforeBody } = before;
    const { modified: _b, ...afterBody } = after;
    if (sameJSON(beforeBody, afterBody)) return false;
    project.framework = after;
    logEvent('framework', 'update', 'framework', 'Framework', before, after);
    commit('framework', 'codes', 'log');
    return true;
  },

  // Keyword analysis: words and phrases left out of every count.

  setExcludedTerms(list) {
    project.keywords.excluded = [...new Set(list.map(t => t.trim().toLowerCase()).filter(Boolean))].sort(byText);
    commit('keywords');
  },

  // Journal: edits create new versions in the log, archive hides an entry without removing it.

  addJournal({ category, title, body }) {
    const now = nowISO();
    const entry = { id: uid(), category, title: title.trim(), body: body.trim(), archived: false, created: now, modified: now };
    project.journal.push(entry);
    logEvent('journal', 'create', entry.id, entry.title, null, pick(entry, JOURNAL_FIELDS));
    commit('journal', 'log');
  },

  updateJournal(id, patch, action = 'update') {
    const entry = project.journal.find(e => e.id === id);
    const before = pick(entry, JOURNAL_FIELDS);
    Object.assign(entry, patch);
    const after = pick(entry, JOURNAL_FIELDS);
    if (sameJSON(before, after)) return;
    entry.modified = nowISO();
    logEvent('journal', action, id, entry.title, before, after);
    commit('journal', 'log');
  },
};
