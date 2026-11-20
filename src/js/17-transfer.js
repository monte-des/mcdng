// Carrying a project between devices as a zip through the Files app: iCloud Drive, Google Drive or anything else
// Files reaches, with no account and no connection needed. The Mac exports its project folder as a zip; the iPad
// opens it as a project kept on the device (DeviceStore, `device: true`), exports it again when done, and the Mac
// brings the changes back into its folder. The zip holds project.json, README.txt, the document folders and a
// note, mcdng-transfer.json, with `base`: the version of project.json (its `modified` stamp) that the two devices
// last had in common. Each device remembers that stamp per project, so bringing a file in can tell whether this
// copy changed meanwhile; then the user chooses, and the version not kept goes to backups.

const TRANSFER_FILE = 'mcdng-transfer.json';

const Transfer = {
  // The stamp of the version last in common with the other device, per project (by its creation time).
  async inStep(created) {
    return (await Memory.get(`step:${created}`).catch(() => null)) ?? null;
  },

  async setInStep(created, modified) {
    this.current = modified;
    await Memory.set(`step:${created}`, modified).catch(() => {});
    bus.emit('sync');
  },

  // Whether the open project changed since it was last exported or brought in (for the status).
  current: null,
  get pending() {
    return Boolean(project) && this.current !== project.modified;
  },

  async load() {
    this.current = project ? await this.inStep(project.created) : null;
    bus.emit('sync');
  },

  async export() {
    await Saver.flush();
    const progress = Toast.show('Preparing the project file…', { timeout: 0 });
    try {
      const files = [];
      const add = async path => files.push({ path, data: await Disk.readBytes(path) });
      await add(PROJECT_FILE);
      if (await Disk.exists('README.txt')) await add('README.txt');
      for (const doc of project.documents) {
        const folder = Library.folderPath(doc);
        for (const entry of await Disk.list(folder).catch(() => [])) if (!entry.dir) await add(`${folder}/${entry.name}`);
      }
      const note = { format: 'mcdng-transfer/1', base: await this.inStep(project.created), exported: nowISO() };
      files.push({ path: TRANSFER_FILE, data: new TextEncoder().encode(JSON.stringify(note, null, 1)) });
      const zip = await Zip.write(files);
      progress.close();
      await download(`${safeFileName(project.name)}.zip`, zip, 'application/zip');
      await this.setInStep(project.created, project.modified);
    } catch (err) {
      progress.close();
      Dialog.alert('The project file could not be made', err.message);
    }
  },

  // Reads a project zip, made by MCdng or by compressing the project folder in the Finder.
  async read(file) {
    const entries = await Zip.read(file);
    const top = [...entries.keys()].filter(p => p === PROJECT_FILE || p.endsWith(`/${PROJECT_FILE}`))
      .sort((a, b) => a.length - b.length)[0];
    if (!top) throw new Error('This file does not contain an MCdng project.');
    const prefix = top.slice(0, -PROJECT_FILE.length);
    const files = new Map();
    for (const [path, data] of entries) {
      const inside = path.slice(prefix.length);
      // Backups stay on the device that made them.
      if (path.startsWith(prefix) && !inside.startsWith('backups/')) files.set(inside, data);
    }
    const text = new TextDecoder().decode(files.get(PROJECT_FILE));
    const note = files.has(TRANSFER_FILE) ? JSON.parse(new TextDecoder().decode(files.get(TRANSFER_FILE))) : null;
    files.delete(TRANSFER_FILE);
    return { data: normalizeProject(JSON.parse(text)), text, files, base: note?.base ?? null };
  },

  // Asks which version to keep when both this copy and the file changed since they were last in common.
  // Resolves with 'file', 'here' or null (cancelled); the version not kept is copied into backups.
  async choose(current, currentText, incoming) {
    if (current.modified === incoming.base || current.modified === incoming.data.modified) return 'file';
    const choice = await Dialog.open({
      title: 'Changed on two devices',
      wide: 'medium',
      body: [
        h('p', { text: `“${current.name}” was changed here and in this file since the two last had the same version. Which version do you want to keep?` }),
        h('p', { class: 'muted', text: 'The other version is copied into the backups folder of the project, so nothing is lost.' }),
      ],
      buttons: [
        { label: 'Cancel', result: null },
        { label: 'Keep this version', result: 'here' },
        { label: 'Use the file’s version', kind: 'primary', result: 'file' },
      ],
    });
    if (!choice) return null;
    const stamp = nowISO().slice(0, 19).replace(/[:T]/g, '-');
    if (choice === 'here') await Disk.write(`backups/conflict-${stamp}-other-device.json`, incoming.text);
    else await Disk.write(`backups/conflict-${stamp}-this-device.json`, currentText);
    return choice;
  },

  // Writes an incoming project into the project in use: new files, the document folders it no longer has
  // removed, project.json last. Files of documents never change once written, so existing ones are kept.
  async write(incoming) {
    for (const [path, bytes] of incoming.files) {
      if (path !== PROJECT_FILE && !await Disk.exists(path)) await Disk.write(path, bytes);
    }
    const keep = new Set(incoming.data.documents.map(d => d.folder));
    for (const entry of await Disk.list('documents').catch(() => [])) {
      if (entry.dir && !keep.has(entry.name)) await Disk.remove(`documents/${entry.name}`);
    }
    await Disk.write(PROJECT_FILE, incoming.text);
  },

  // "Import changes from a file", on the open project (a folder on the computer, or a project on this device).
  async bringIn(file) {
    try {
      await Saver.flush();
      const incoming = await this.read(file);
      if (incoming.data.created !== project.created) throw new Error(`This file holds another project, “${incoming.data.name}”.`);
      if (incoming.data.modified === project.modified) return Toast.show('This project already has the changes in the file.');
      const choice = await this.choose(project, JSON.stringify(project, null, 1), incoming);
      if (choice === 'file') {
        await this.write(incoming);
        App.reload(incoming.data);
        await Saver.remember(incoming.text);
        Toast.show(`Brought in the changes from “${file.name}”.`);
      }
      if (choice) await this.setInStep(project.created, project.modified);
    } catch (err) {
      Dialog.alert('The changes could not be brought in', err.message);
    }
  },

  // "Open project file" where folders cannot be opened (iPad): the project is kept on this device. Opening a
  // project already here brings the file's changes into it.
  async openHere(file) {
    try {
      const incoming = await this.read(file);
      const created = incoming.data.created;
      const known = await Memory.get(`device:${created}`).catch(() => null);
      const target = { id: known?.id ?? `device:${uid()}`, name: incoming.data.name, device: true };
      await DeviceStore.use(target);
      if (known && await Disk.exists(PROJECT_FILE)) {
        const text = await Disk.readText(PROJECT_FILE);
        const choice = await this.choose(normalizeProject(JSON.parse(text)), text, incoming);
        if (!choice) return;
        if (choice === 'file') await this.write(incoming);
      } else {
        await this.write(incoming);
      }
      await Memory.set(`device:${created}`, target).catch(() => {});
      await App.openProject();
      // In step with the file, unless this copy was kept against it.
      if (project.modified === incoming.data.modified) await this.setInStep(created, project.modified);
      else await this.load();
    } catch (err) {
      Dialog.alert('The project file could not be opened', err.message);
    }
  },

  // A file picker for project zips, from Files (iCloud Drive, Google Drive, On My iPad) or the Finder.
  pick(then) {
    const input = h('input', { type: 'file', accept: '.zip,application/zip', hidden: true });
    input.addEventListener('change', () => {
      const [file] = input.files;
      input.remove();
      if (file) then(file);
    });
    document.body.append(input);
    input.click();
  },
};
