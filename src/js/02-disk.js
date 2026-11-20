// Where projects are stored. Two stores share one interface of paths inside the project folder:
// - FolderStore: a folder on the computer, through the File System Access API (Chrome and Edge on a computer);
// - DeviceStore (02-drive.js): a folder on Google Drive, mirrored on the device so it works offline (iPad).
// The rest of the app only uses Disk, which forwards to the store in use.

const Memory = {
  db: null,

  open() {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open('mcdng', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  },

  async request(mode, action) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = action(db.transaction('kv', mode).objectStore('kv'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  get(key) { return this.request('readonly', store => store.get(key)); },
  set(key, value) { return this.request('readwrite', store => store.put(value, key)); },
};

// A project folder on the computer. The folder handle is remembered in IndexedDB so the project can be
// reopened with one click.
const FolderStore = {
  root: null,

  get name() { return this.root.name; },

  async use(handle) {
    const opts = { mode: 'readwrite' };
    if (await handle.queryPermission(opts) !== 'granted' && await handle.requestPermission(opts) !== 'granted') {
      throw new Error('MCdng needs permission to read and write the project folder.');
    }
    this.root = handle;
    await Memory.set('lastFolder', handle).catch(() => {});
  },

  remembered() {
    return Memory.get('lastFolder').catch(() => null);
  },

  async dir(parts, create) {
    let dir = this.root;
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
    return dir;
  },

  async file(path, create = false) {
    const parts = path.split('/');
    const name = parts.pop();
    return (await this.dir(parts, create)).getFileHandle(name, { create });
  },

  async exists(path) {
    try {
      await this.file(path);
      return true;
    } catch {
      return false;
    }
  },

  async readText(path) {
    return (await (await this.file(path)).getFile()).text();
  },

  async readBytes(path) {
    return new Uint8Array(await (await (await this.file(path)).getFile()).arrayBuffer());
  },

  // When and how big the file was last written, to notice changes made by another device through a sync app.
  async stamp(path) {
    const file = await (await this.file(path)).getFile();
    return `${file.lastModified}:${file.size}`;
  },

  async write(path, data) {
    const writable = await (await this.file(path, true)).createWritable();
    await writable.write(data);
    await writable.close();
  },

  async hasDir(path) {
    try {
      await this.dir(path.split('/'), false);
      return true;
    } catch {
      return false;
    }
  },

  async copyFile(from, to) {
    await this.write(to, await (await this.file(from)).getFile());
  },

  // The files and folders directly inside a folder, as [{ name, dir }].
  async list(path) {
    const out = [];
    for await (const [name, handle] of (await this.dir(path.split('/'), false)).entries()) out.push({ name, dir: handle.kind === 'directory' });
    return out;
  },

  // Copies the files directly inside one folder into another; document folders have no subfolders.
  async copyDir(from, to) {
    const source = await this.dir(from.split('/'), false);
    for await (const [name, handle] of source.entries()) {
      if (handle.kind === 'file') await this.write(`${to}/${name}`, await handle.getFile());
    }
  },

  async remove(path) {
    const parts = path.split('/');
    const name = parts.pop();
    await (await this.dir(parts, false)).removeEntry(name, { recursive: true });
  },
};

const Disk = {
  // Folders on the computer where the browser can open them; Google Drive everywhere else (Safari, iPad).
  // `?storage=drive` forces Drive, for testing in Chrome.
  mode: new URLSearchParams(location.search).get('storage') === 'drive' || typeof window.showDirectoryPicker !== 'function'
    ? 'drive' : 'folder',
  store: null,

  get name() { return this.store.name; },

  exists(path) { return this.store.exists(path); },
  readText(path) { return this.store.readText(path); },
  readBytes(path) { return this.store.readBytes(path); },
  write(path, data) { return this.store.write(path, data); },
  hasDir(path) { return this.store.hasDir(path); },
  copyFile(from, to) { return this.store.copyFile(from, to); },
  list(path) { return this.store.list(path); },
  copyDir(from, to) { return this.store.copyDir(from, to); },
  remove(path) { return this.store.remove(path); },
};
