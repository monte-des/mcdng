// Reads and writes inside the project folder the user picked.
// The folder handle is remembered in IndexedDB so the project can be reopened with one click.

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

const Disk = {
  root: null,
  supported: typeof window.showDirectoryPicker === 'function',

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
