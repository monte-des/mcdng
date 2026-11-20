// How documents are stored in the project folder:
//
//   documents/Smith & Lee 2021 - Teacher self-efficacy in inclusive classrooms/
//     original.pdf          the imported file, unchanged
//     extracted-text.json   the text and page layout that coded segments point into
//
// Folder names follow the document's authors, year and title and are renamed when those change.
// project.json links each document to its folder, so the internal id never appears on disk.

const GUIDE = `This folder is an MCdng project.

project.json   Codes, coded segments, codebook, journal and history. MCdng saves it automatically.
documents/     One folder per paper, named "Authors Year - Title", containing:
                 original.pdf, .docx or .txt   the file you imported
                 extracted-text.json           the text MCdng codes against
backups/       A copy of project.json from each day the project was opened.

To continue working, open MCdng.html in Chrome or Edge, or the MCdng browser extension, and choose Open project.
To back up the project, copy or sync this whole folder.
`;

const RESERVED_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

// A name that is valid on Windows, macOS and Linux and short enough for deep folder paths.
function safeFileName(text, max = 70) {
  let name = text
    .replace(/\s*:\s*/g, ', ')
    .replace(/[\\/]/g, '-')
    .replace(/[*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (name.length > max) name = name.slice(0, max).replace(/\s+\S*$/, '');
  name = name.replace(/[. ]+$/, '');
  return RESERVED_NAMES.test(name) ? `${name} document` : name;
}

const Library = {
  queue: Promise.resolve(),
  timers: new Map(),

  // Folder operations run one at a time, and reads wait for them, so a rename never meets a read halfway.
  run(task) {
    const result = this.queue.then(task);
    this.queue = result.catch(() => {});
    return result;
  },

  idle() {
    return this.queue;
  },

  folderPath: doc => `documents/${doc.folder}`,
  sourcePath: doc => `documents/${doc.folder}/original.${doc.file.ext}`,
  textPath: doc => `documents/${doc.folder}/extracted-text.json`,

  folderName(doc) {
    const authors = Docs.authorLabel(doc);
    const head = authors ? `${authors} ${doc.year || 'n.d.'}` : doc.year;
    return safeFileName([head, doc.title].filter(Boolean).join(' - ')) || 'Untitled document';
  },

  async uniqueName(base, doc, documents) {
    const taken = new Set(documents.filter(d => d !== doc && d.folder).map(d => d.folder.toLowerCase()));
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()) || (name.toLowerCase() !== doc.folder?.toLowerCase() && await Disk.hasDir(`documents/${name}`)); n++) {
      name = `${base} (${n})`;
    }
    return name;
  },

  async writeGuide() {
    if (!await Disk.exists('README.txt')) await Disk.write('README.txt', GUIDE);
  },

  // Imports a file and resolves with the new document. `known` holds details from a better source than the
  // file itself, such as the publisher's page the file was saved from; they win over what the file says.
  import(file, known = null) {
    return this.run(async () => {
      const ext = file.name.split('.').pop().toLowerCase();
      const type = ext === 'md' ? 'txt' : ext;
      if (project.documents.some(d => d.file.name === file.name && d.file.size === file.size)) {
        throw new Error('It is already in this project.');
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { content, meta, pages } = await Extract[type](bytes.slice());
      if (!content.text.trim()) {
        throw new Error(type === 'pdf' ? 'No selectable text found. Scanned PDFs need OCR before import.' : 'The file contains no text.');
      }
      const read = fileMetadata(meta, content, file.name);
      const fields = { ...read.fields };
      const docMeta = read.meta;
      if (known) {
        for (const f of META_FIELDS) if (known[f]) fields[f] = known[f];
        docMeta.source = known.source;
        docMeta.guessed = [];
      }
      const sameDoi = fields.doi && project.documents.find(d => d.doi.toLowerCase() === fields.doi.toLowerCase());
      if (sameDoi) throw new Error(`It is already in this project as “${Docs.citation(sameDoi)}”.`);
      const doc = {
        id: uid(),
        folder: '',
        ...fields,
        fields: {},
        memo: '',
        type,
        file: { name: file.name, ext, size: file.size },
        pages,
        added: nowISO(),
        meta: docMeta,
      };
      doc.folder = await this.uniqueName(this.folderName(doc), doc, project.documents);
      await Disk.write(this.sourcePath(doc), bytes);
      await Disk.write(this.textPath(doc), JSON.stringify(content));
      Contents.cache.set(doc.id, Promise.resolve(content));
      Actions.addDocument(doc);
      return doc;
    });
  },

  // Called after authors, year or title change; waits for edits to settle before renaming.
  syncFolderSoon(docId) {
    clearTimeout(this.timers.get(docId));
    this.timers.set(docId, setTimeout(() => {
      this.timers.delete(docId);
      this.run(() => this.syncFolder(docId));
    }, 1200));
  },

  async syncFolder(docId) {
    const doc = project && Docs.get(docId);
    if (!doc) return;
    const wanted = await this.uniqueName(this.folderName(doc), doc, project.documents);
    // Same name or a change of letter case only: case-insensitive file systems see the same folder.
    if (wanted.toLowerCase() === doc.folder.toLowerCase()) return;
    const old = doc.folder;
    try {
      await Disk.copyDir(`documents/${old}`, `documents/${wanted}`);
      doc.folder = wanted;
      commit('documents');
      await Saver.flush();
      await Disk.remove(`documents/${old}`);
    } catch (err) {
      if (doc.folder === wanted) {
        doc.folder = old;
        commit('documents');
      }
      await Disk.remove(`documents/${wanted}`).catch(() => {});
      Toast.error(`The folder of “${doc.title}” could not be renamed and keeps its previous name. ${err.message}`);
    }
  },

  remove(doc) {
    return this.run(() => Disk.remove(this.folderPath(doc)).catch(() => {}));
  },

  // Projects from earlier versions stored documents as documents/<id>/source.<ext> and content.json.
  async upgrade(data) {
    const legacy = data.documents.filter(d => !d.folder);
    if (!legacy.length) return;
    const progress = Toast.show('Giving document folders readable names…', { timeout: 0 });
    try {
      for (const doc of legacy) {
        doc.folder = await this.uniqueName(this.folderName(doc), doc, data.documents);
        await Disk.copyFile(`documents/${doc.id}/source.${doc.file.ext}`, this.sourcePath(doc));
        await Disk.copyFile(`documents/${doc.id}/content.json`, this.textPath(doc));
      }
      await Disk.write(PROJECT_FILE, JSON.stringify(data, null, 1));
    } catch (err) {
      // The old folders are untouched; drop the half-made new ones so the next attempt starts clean.
      for (const doc of legacy.filter(d => d.folder)) {
        await Disk.remove(this.folderPath(doc)).catch(() => {});
        doc.folder = '';
      }
      throw err;
    } finally {
      progress.close();
    }
    for (const doc of legacy) await Disk.remove(`documents/${doc.id}`).catch(() => {});
  },
};
