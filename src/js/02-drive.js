// Projects on Google Drive, for the iPad and other browsers that cannot open folders on the device.
//
// The project folder on Drive is the same one the computer opens through Google Drive for desktop. On the
// device, every file of the open project is mirrored in IndexedDB, so MCdng works the same without a connection:
// changes are saved to the mirror at once and sent to Drive when a connection and a sign-in are there.
//
// Sign-in: Google's OAuth redirect for browser apps. The page goes to Google and comes back with a token after #,
// valid for an hour; the token stays on the device. The scope is the whole Drive, because the project folder and
// its files were made by Google Drive for desktop, not by MCdng. The client ID is public by design: Google only
// accepts it from the address registered with it.

// The OAuth client ID made for MCdng's web address in Google Cloud. Tests set MCDNG_CLIENT_ID before the app runs.
const GOOGLE_CLIENT_ID = globalThis.MCDNG_CLIENT_ID ?? '1045024909712-fqjt19mq4rlj3f6i0gt2jo45m0n09f75.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const TOKEN_KEY = 'mcdng.google';
const SIGNIN_KEY = 'mcdng.signin';

class SignInError extends Error {
  constructor() {
    super('Sign in to Google Drive to sync.');
  }
}

const Google = {
  // The page's own address, which Google sends the answer back to. It must be registered with the client ID
  // exactly, so MCdng's address has no query; tests add ?storage=drive, which their fake Google accepts.
  get redirect() { return `${location.origin}${location.pathname.replace(/index\.html$/, '')}${location.search}`; },

  // Drive needs a page served over https (or localhost for testing) and a client ID set for this copy.
  get usable() {
    return Boolean(GOOGLE_CLIENT_ID) && (location.protocol === 'https:' || location.hostname === 'localhost');
  },

  saved() {
    try {
      return JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null');
    } catch {
      return null;
    }
  },

  // A token valid for at least another minute, or null.
  token() {
    const saved = this.saved();
    return saved?.token && saved.expires > Date.now() + 60_000 ? saved.token : null;
  },

  forget() {
    const saved = this.saved();
    if (saved) localStorage.setItem(TOKEN_KEY, JSON.stringify({ ...saved, token: null }));
  },

  // Leaves the page for Google's sign-in. `resume` says what to do on return; `silent` asks Google not to show
  // anything, which works when the account has already allowed MCdng.
  signIn({ resume = null, silent = false } = {}) {
    const state = uid();
    sessionStorage.setItem(SIGNIN_KEY, JSON.stringify({ state, resume }));
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID, redirect_uri: this.redirect, response_type: 'token',
      scope: DRIVE_SCOPE, include_granted_scopes: 'true', state,
    });
    const email = this.saved()?.email;
    if (email) params.set('login_hint', email);
    if (silent) params.set('prompt', 'none');
    location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  },

  // Reads Google's answer when the page comes back from sign-in, and removes it from the address.
  // Resolves with { resume, error } or null when the page was opened normally.
  receive() {
    const hash = new URLSearchParams(location.hash.slice(1));
    if (!hash.has('access_token') && !hash.has('error')) return null;
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    let sent = null;
    try {
      sent = JSON.parse(sessionStorage.getItem(SIGNIN_KEY) ?? 'null');
    } catch {}
    sessionStorage.removeItem(SIGNIN_KEY);
    if (!sent || hash.get('state') !== sent.state) return { resume: null, error: 'The answer from Google did not match this sign-in. Try again.' };
    if (hash.has('error')) return { resume: sent.resume, error: hash.get('error') };
    if (!(hash.get('scope') ?? '').split(' ').includes(DRIVE_SCOPE)) {
      return { resume: sent.resume, error: 'MCdng needs access to Google Drive to open projects. Sign in again and allow it.' };
    }
    localStorage.setItem(TOKEN_KEY, JSON.stringify({
      ...this.saved(), token: hash.get('access_token'), expires: Date.now() + Number(hash.get('expires_in') ?? 3600) * 1000,
    }));
    return { resume: sent.resume, error: null };
  },

  remember(email) {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ ...this.saved(), email }));
  },
};

// The Drive REST API, version 3. Every call needs a token and a connection.
const DriveApi = {
  async request(url, { method = 'GET', json, body, headers = {} } = {}) {
    const token = Google.token();
    if (!token) throw new SignInError();
    if (!navigator.onLine) throw new OfflineError();
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await fetch(url, {
          method,
          headers: { Authorization: `Bearer ${token}`, ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
          body: json ? JSON.stringify(json) : body,
        });
      } catch {
        throw new OfflineError();
      }
      if (response.status === 401) {
        Google.forget();
        throw new SignInError();
      }
      // Too many requests or a passing server error: wait and try again, twice.
      if ((response.status === 429 || response.status >= 500 || response.status === 403 && /rate/i.test(await response.clone().text())) && attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
        continue;
      }
      if (!response.ok) {
        const message = (await response.json().catch(() => null))?.error?.message;
        throw new Error(`Google Drive answered ${response.status}${message ? `: ${message}` : ''}.`);
      }
      return response;
    }
  },

  async json(path, params = {}, options = {}) {
    const query = new URLSearchParams({ supportsAllDrives: 'true', ...params });
    return (await this.request(`${DRIVE_API}/${path}?${query}`, options)).json();
  },

  // Every file matching a query, across pages.
  async list(q, fields = 'id,name,mimeType,md5Checksum,parents,modifiedTime') {
    const files = [];
    let pageToken = '';
    do {
      const page = await this.json('files', {
        q, fields: `nextPageToken,files(${fields})`, pageSize: '1000', includeItemsFromAllDrives: 'true',
        ...(pageToken ? { pageToken } : {}),
      });
      files.push(...page.files);
      pageToken = page.nextPageToken ?? '';
    } while (pageToken);
    return files;
  },

  get(id, fields = 'id,name,md5Checksum,modifiedTime,trashed') {
    return this.json(`files/${id}`, { fields });
  },

  async download(id) {
    return (await this.request(`${DRIVE_API}/files/${id}?alt=media&supportsAllDrives=true`)).blob();
  },

  createFolder(name, parent) {
    return this.json('files', { fields: 'id' }, { method: 'POST', json: { name, parents: [parent], mimeType: FOLDER_MIME } });
  },

  // A new file with its content, in one request.
  async create(name, parent, blob) {
    const boundary = `mcdng${uid()}`;
    const meta = JSON.stringify({ name, parents: [parent], mimeType: mimeFor(name) });
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
      `--${boundary}\r\nContent-Type: ${mimeFor(name)}\r\n\r\n`, blob, `\r\n--${boundary}--`,
    ]);
    const response = await this.request(`${DRIVE_UPLOAD}/files?uploadType=multipart&supportsAllDrives=true&fields=id,md5Checksum`, {
      method: 'POST', body, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    });
    return response.json();
  },

  async update(id, blob, name) {
    const response = await this.request(`${DRIVE_UPLOAD}/files/${id}?uploadType=media&supportsAllDrives=true&fields=id,md5Checksum`, {
      method: 'PATCH', body: blob, headers: { 'Content-Type': mimeFor(name) },
    });
    return response.json();
  },

  // A copy made by Drive itself, so a renamed document folder does not upload its PDF again.
  copy(id, name, parent) {
    return this.json(`files/${id}/copy`, { fields: 'id,md5Checksum' }, { method: 'POST', json: { name, parents: [parent] } });
  },

  rename(id, name) {
    return this.json(`files/${id}`, { fields: 'id' }, { method: 'PATCH', json: { name } });
  },

  // Removed files go to Drive's bin, where they stay for 30 days.
  trash(id) {
    return this.json(`files/${id}`, { fields: 'id' }, { method: 'PATCH', json: { trashed: true } });
  },

  async user() {
    return (await this.json('about', { fields: 'user(emailAddress,displayName)' })).user;
  },

  // Every file and folder inside a folder, as path → { id, dir, md5 }. Folders of one depth are listed
  // together, in groups, so a project with a hundred documents takes a few requests.
  async tree(rootId) {
    const entries = new Map();
    let level = [[rootId, '']];
    while (level.length) {
      const next = [];
      for (let i = 0; i < level.length; i += 40) {
        const group = new Map(level.slice(i, i + 40));
        const q = `(${[...group.keys()].map(id => `'${id}' in parents`).join(' or ')}) and trashed = false`;
        const files = await this.list(q);
        // When Drive holds two items with one name, the newest wins, as on the computer.
        files.sort((a, b) => a.modifiedTime.localeCompare(b.modifiedTime));
        for (const f of files) {
          const base = group.get(f.parents.find(p => group.has(p)));
          const path = base ? `${base}/${f.name}` : f.name;
          if (f.mimeType === FOLDER_MIME) {
            entries.set(path, { id: f.id, dir: true });
            next.push([f.id, path]);
          } else if (!f.mimeType.startsWith('application/vnd.google-apps.') && !f.name.endsWith('.crswap')) {
            // (.crswap: Chrome's temporary copy while it saves a file, which a sync app may upload for a moment.)
            entries.set(path, { id: f.id, dir: false, md5: f.md5Checksum ?? null });
          }
        }
      }
      level = next;
    }
    return entries;
  },
};

function mimeFor(name) {
  const ext = name.split('.').pop().toLowerCase();
  return {
    json: 'application/json', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }[ext] ?? 'application/octet-stream';
}

// The device's copy of Drive projects, in IndexedDB.
// entries: one per file or folder of a project, keyed [project, path]:
//   { project, path, dir, id (on Drive, or null before the first sync), md5 (of the version last in step with
//     Drive), blob (the content, or null while it is only on Drive), dirty (changed here since), rev (counts
//     changes here), copyOf (Drive id of an unchanged original, so Drive can copy it instead of an upload) }
// trash: Drive ids of files and folders removed here, to move to Drive's bin.
const Mirror = {
  db: null,

  open() {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open('mcdng-drive', 1);
      req.onupgradeneeded = () => {
        const entries = req.result.createObjectStore('entries', { keyPath: ['project', 'path'] });
        entries.createIndex('project', 'project');
        req.result.createObjectStore('trash', { keyPath: ['project', 'id'] });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  },

  // Runs `work(stores)` in one transaction and resolves with its result once the transaction completes.
  async tx(names, mode, work) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, mode);
      const stores = Object.fromEntries(names.map(n => [n, tx.objectStore(n)]));
      let result;
      Promise.resolve(work(stores)).then(value => (result = value), err => {
        tx.abort();
        reject(err);
      });
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('The change on this device was cancelled.'));
    });
  },

  req(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  get(project, path) {
    return this.tx(['entries'], 'readonly', s => this.req(s.entries.get([project, path])));
  },

  all(project) {
    return this.tx(['entries'], 'readonly', s => this.req(s.entries.index('project').getAll(project)));
  },

  // Entries at a path and below it.
  under(project, path) {
    const range = IDBKeyRange.bound([project, `${path}/`], [project, `${path}/￿`]);
    return this.tx(['entries'], 'readonly', s => this.req(s.entries.getAll(range)));
  },

  trashed(project) {
    return this.tx(['trash'], 'readonly', s => this.req(s.trash.getAll(IDBKeyRange.bound([project], [project, []]))));
  },
};

// The open project's files on this device, with the same interface as FolderStore. Two kinds of project live here:
// a Google Drive project ({ id: the folder's id on Drive, name }), kept in step with Drive by Sync, and a project
// kept only on this device ({ id: 'device:…', name, device: true }), which travels as a zip through the Files
// app (17-transfer.js).
const DeviceStore = {
  project: null,

  get name() { return this.project.name; },
  get id() { return this.project.id; },

  async use(project) {
    this.project = project;
    await Memory.set('lastDrive', project).catch(() => {});
    navigator.storage?.persist?.().catch(() => {});
  },

  remembered() {
    return Memory.get('lastDrive').catch(() => null);
  },

  async exists(path) {
    const entry = await Mirror.get(this.id, path);
    return Boolean(entry && !entry.dir);
  },

  async hasDir(path) {
    return Boolean(await Mirror.get(this.id, path)) || (await Mirror.under(this.id, path)).length > 0;
  },

  // The files and folders directly inside a folder, as [{ name, dir }].
  async list(path) {
    const below = await Mirror.under(this.id, path);
    return below.map(e => ({ name: e.path.slice(path.length + 1), dir: e.dir })).filter(e => !e.name.includes('/'));
  },

  // The content of a file, from the device or, the first time, from Drive.
  async blob(path) {
    const entry = await Mirror.get(this.id, path);
    if (!entry || entry.dir) throw new Error(`${path} is not in the project.`);
    if (entry.blob) return entry.blob;
    const source = entry.id ?? entry.copyOf;
    let blob;
    try {
      blob = await DriveApi.download(source);
    } catch (err) {
      if (err instanceof OfflineError || err instanceof SignInError) {
        throw new Error('This file is not on this device yet. Connect to the internet and sign in to Google Drive to download it.');
      }
      throw err;
    }
    // Kept for next time, unless the entry changed meanwhile.
    await Mirror.tx(['entries'], 'readwrite', async s => {
      const now = await Mirror.req(s.entries.get([this.id, path]));
      if (now && !now.blob && now.rev === entry.rev) s.entries.put({ ...now, blob });
    });
    return blob;
  },

  async readText(path) {
    return (await this.blob(path)).text();
  },

  async readBytes(path) {
    return new Uint8Array(await (await this.blob(path)).arrayBuffer());
  },

  async write(path, data) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mimeFor(path) });
    await this.put(path, { blob, copyOf: null });
  },

  // Records a changed file and the folders above it, then asks for a sync.
  async put(path, change) {
    const project = this.id;
    await Mirror.tx(['entries'], 'readwrite', async s => {
      const parts = path.split('/');
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join('/');
        if (!await Mirror.req(s.entries.get([project, dir]))) {
          s.entries.put({ project, path: dir, dir: true, id: null, md5: null, blob: null, dirty: false, rev: 0, copyOf: null });
        }
      }
      const old = await Mirror.req(s.entries.get([project, path]));
      s.entries.put({
        project, path, dir: false, id: old?.id ?? null, md5: old?.md5 ?? null,
        dirty: true, rev: (old?.rev ?? 0) + 1, ...change,
      });
    });
    Sync.soon();
  },

  async copyFile(from, to) {
    const source = await Mirror.get(this.id, from);
    if (!source || source.dir) throw new Error(`${from} is not in the project.`);
    const target = await Mirror.get(this.id, to);
    // An unchanged file that Drive has, copied to a new place: Drive copies it, nothing is uploaded.
    if (!target?.id && source.id && !source.dirty) await this.put(to, { blob: source.blob, copyOf: source.id });
    else await this.put(to, { blob: await this.blob(from), copyOf: null });
  },

  async copyDir(from, to) {
    for (const entry of await Mirror.under(this.id, from)) {
      const name = entry.path.slice(from.length + 1);
      if (!entry.dir && !name.includes('/')) await this.copyFile(entry.path, `${to}/${name}`);
    }
  },

  // Removes a file or folder here; what Drive has of it goes to Drive's bin at the next sync.
  async remove(path) {
    const project = this.id;
    await Mirror.tx(['entries', 'trash'], 'readwrite', async s => {
      const top = await Mirror.req(s.entries.get([project, path]));
      if (!top) throw new Error(`${path} is not in the project.`);
      const below = await Mirror.req(s.entries.getAll(IDBKeyRange.bound([project, `${path}/`], [project, `${path}/￿`])));
      if (top.id) s.trash.put({ project, id: top.id });
      // Files moved here by Drive's copy are not inside the old folder's id; send them to the bin too.
      for (const entry of below) if (entry.id && !top.id) s.trash.put({ project, id: entry.id });
      for (const entry of [top, ...below]) s.entries.delete([project, entry.path]);
    });
    Sync.soon();
  },
};

// Keeps the device's copy and Drive in step. One step runs at a time.
//   state: 'synced' | 'pending' (changes wait for the next step) | 'syncing' | 'offline' | 'signin' | 'error'
//          | 'conflict'; downloads: { done, total } while papers are being downloaded for offline use.
const Sync = {
  state: 'synced',
  error: null,
  downloads: null,
  queue: Promise.resolve(),
  timer: null,

  set(state, error = null) {
    this.state = state;
    this.error = error;
    bus.emit('sync');
  },

  run(step) {
    const next = this.queue.then(step);
    this.queue = next.catch(() => {});
    return next;
  },

  soon(delay = 1500) {
    if (Disk.mode !== 'drive' || !DeviceStore.project || DeviceStore.project.device) return;
    if (this.state !== 'conflict') this.set(navigator.onLine ? 'pending' : 'offline');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.push(), delay);
  },

  // Turns a failure into a state; resolves with whether the step can go on.
  fail(err) {
    if (err instanceof OfflineError) this.set('offline');
    else if (err instanceof SignInError) this.set('signin');
    else this.set('error', err);
    return false;
  },

  // Brings Drive's changes to the device. Resolves with { changed, conflict }: changed when project.json came
  // from Drive in a new version; conflict ({ text, md5 } of the version on Drive) when both sides changed it
  // since the last step, which the user then decides on.
  pull() {
    return this.run(async () => {
      const project = DeviceStore.id;
      this.set('syncing');
      const remote = await DriveApi.tree(project);
      let conflict = null, changed = false;
      await Mirror.tx(['entries'], 'readwrite', async s => {
        const local = new Map((await Mirror.req(s.entries.index('project').getAll(project))).map(e => [e.path, e]));
        for (const [path, item] of remote) {
          const entry = local.get(path);
          local.delete(path);
          const fresh = { project, path, dir: item.dir, id: item.id, md5: item.md5 ?? null, blob: null, dirty: false, rev: 0, copyOf: null };
          if (!entry) s.entries.put(fresh);
          else if (item.dir) s.entries.put({ ...entry, dir: true, id: item.id });
          else if (entry.id === item.id && entry.md5 === item.md5) {
            // In step, or only changed here.
          } else if (!entry.dirty) {
            s.entries.put({ ...fresh, rev: entry.rev });
            if (path === PROJECT_FILE) changed = true;
          } else if (path === PROJECT_FILE) {
            conflict = item;
            s.entries.put({ ...entry, id: item.id });
          } else {
            // Changed on both sides: the device's version is sent at the next step.
            s.entries.put({ ...entry, id: item.id, md5: item.md5 });
          }
        }
        // What is here but no longer on Drive was removed on the other device, unless it was changed here.
        for (const entry of local.values()) {
          if (!entry.id) continue;
          if (entry.dirty) s.entries.put({ ...entry, id: null, md5: null });
          else s.entries.delete([project, entry.path]);
        }
      });
      if (!conflict) {
        this.set('synced');
        return { changed, conflict: null };
      }
      this.set('conflict');
      return { changed, conflict: { text: await (await DriveApi.download(conflict.id)).text(), md5: conflict.md5 } };
    }).catch(err => {
      this.fail(err);
      throw err;
    });
  },

  // Sends the device's changes to Drive.
  push() {
    clearTimeout(this.timer);
    return this.run(async () => {
      if (!DeviceStore.project || DeviceStore.project.device || this.state === 'conflict') return;
      const project = DeviceStore.id;
      if (!navigator.onLine) return this.set('offline');
      if (!Google.token()) return this.set('signin');
      this.set('syncing');
      try {
        const entries = await Mirror.all(project);
        const ids = new Map(entries.filter(e => e.dir && e.id).map(e => [e.path, e.id]));
        const folder = async path => {
          if (!path) return project;
          if (ids.has(path)) return ids.get(path);
          const cut = path.lastIndexOf('/');
          const parent = await folder(cut < 0 ? '' : path.slice(0, cut));
          const { id } = await DriveApi.createFolder(path.slice(cut + 1), parent);
          ids.set(path, id);
          await Mirror.tx(['entries'], 'readwrite', async s => {
            const entry = await Mirror.req(s.entries.get([project, path]));
            if (entry) s.entries.put({ ...entry, id });
          });
          return id;
        };
        // project.json goes last, so on Drive it never refers to a document whose files are not there yet.
        const dirty = entries.filter(e => e.dirty && !e.dir).sort((a, b) => (a.path === PROJECT_FILE) - (b.path === PROJECT_FILE));
        for (const entry of dirty) {
          if (DeviceStore.id !== project) return;
          const cut = entry.path.lastIndexOf('/');
          const name = entry.path.slice(cut + 1);
          let done;
          if (entry.id) {
            if (entry.path === PROJECT_FILE && await this.changedOnDrive(entry)) return;
            done = await DriveApi.update(entry.id, entry.blob ?? await DeviceStore.blob(entry.path), name);
          } else {
            const parent = await folder(cut < 0 ? '' : entry.path.slice(0, cut));
            done = entry.copyOf
              ? await DriveApi.copy(entry.copyOf, name, parent)
              : await DriveApi.create(name, parent, entry.blob);
          }
          await Mirror.tx(['entries'], 'readwrite', async s => {
            const now = await Mirror.req(s.entries.get([project, entry.path]));
            if (!now) return;
            // Changed again while it was being sent: it stays to send.
            s.entries.put({ ...now, id: done.id, md5: done.md5Checksum ?? null, dirty: now.rev !== entry.rev, copyOf: null });
          });
        }
        for (const { id } of await Mirror.trashed(project)) {
          await DriveApi.trash(id).catch(err => {
            // Already gone from Drive: nothing to do.
            if (!/ 404/.test(err.message)) throw err;
          });
          await Mirror.tx(['trash'], 'readwrite', s => s.trash.delete([project, id]));
        }
        const left = (await Mirror.all(project)).some(e => e.dirty);
        this.set(left ? 'pending' : 'synced');
        if (left) this.soon(200);
      } catch (err) {
        this.fail(err);
      }
    });
  },

  // Before project.json replaces the one on Drive: if the other device changed it since the last step, the user
  // decides which version to keep.
  async changedOnDrive(entry) {
    const now = await DriveApi.get(entry.id);
    if (now.md5Checksum === entry.md5) return false;
    this.set('conflict');
    const text = await (await DriveApi.download(entry.id)).text();
    queueMicrotask(() => bus.emit('conflict', { text, md5: now.md5Checksum }));
    return true;
  },

  // After the user decided: `keep` is 'here' or 'drive'; `remote` is the version on Drive.
  async settle(keep, remote) {
    const project = DeviceStore.id;
    await Mirror.tx(['entries'], 'readwrite', async s => {
      const entry = await Mirror.req(s.entries.get([project, PROJECT_FILE]));
      if (keep === 'drive') {
        s.entries.put({ ...entry, blob: new Blob([remote.text], { type: 'application/json' }), md5: remote.md5, dirty: false, rev: entry.rev + 1 });
      } else {
        s.entries.put({ ...entry, md5: remote.md5 });
      }
    });
    this.set('pending');
    this.soon(0);
  },

  // Downloads, in the background, every file still only on Drive, so the project works offline: extracted texts
  // first, then the papers. Backups stay on Drive. Runs beside the sync steps, so changes keep going out.
  async prefetch() {
    if (this.downloads) return;
    const project = DeviceStore.id;
    const wanted = (await Mirror.all(project))
      .filter(e => !e.dir && !e.blob && !e.path.startsWith('backups/'))
      .sort((a, b) => Number(!a.path.endsWith('.json')) - Number(!b.path.endsWith('.json')));
    if (!wanted.length) return;
    this.downloads = { done: 0, total: wanted.length };
    bus.emit('sync');
    for (const entry of wanted) {
      if (DeviceStore.id !== project || !navigator.onLine || !Google.token()) break;
      // A file that cannot be downloaded now is tried again when it is opened.
      await DeviceStore.blob(entry.path).catch(() => {});
      this.downloads.done++;
      bus.emit('sync');
    }
    this.downloads = null;
    bus.emit('sync');
  },

  // Projects on Drive: every MCdng project.json the account can see, with its folder.
  async projects() {
    const files = await DriveApi.list("name = 'project.json' and trashed = false", 'id,parents,modifiedTime');
    const found = [];
    for (const f of files) {
      const parent = f.parents?.[0];
      if (!parent) continue;
      const folder = await DriveApi.get(parent, 'id,name,trashed').catch(() => null);
      if (folder && !folder.trashed) found.push({ id: folder.id, name: folder.name, modified: f.modifiedTime });
    }
    return found.sort((a, b) => b.modified.localeCompare(a.modified));
  },

  async createProject(name) {
    const { id } = await DriveApi.createFolder(name, 'root');
    return { id, name };
  },
};
