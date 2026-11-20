// App shell: start screen, top bar, navigation between sections and project lifecycle.

// Insights is a tab of the Codebook.
const SECTIONS = [['documents', 'Documents'], ['coding', 'Coding'], ['review', 'Review'], ['codebook', 'Codebook']];

const App = {
  views: {},
  current: null,

  init() {
    this.views = { documents: new DocumentsView(), coding: new CodingView(), review: new ReviewView(), codebook: new CodebookView() };
    this.nav = h('nav', { class: 'nav', 'aria-label': 'Sections' }, SECTIONS.map(([key, label]) => h('button', {
      type: 'button', text: label, dataset: { view: key }, onclick: () => this.go(key),
    })));
    this.projectButton = h('button', { type: 'button', class: 'project-button', onclick: () => this.projectMenu() }, folderIcon());
    this.status = h('span', { class: 'save-status', role: 'status' });
    // Next to the status when it asks for something: sign in, try again, choose between two versions.
    this.statusAction = h('button', { type: 'button', class: 'btn small status-action', hidden: true });
    this.topbar = h('header', { class: 'topbar' },
      h('span', { class: 'brand', text: 'MCdng' }),
      this.nav,
      h('div', { class: 'topbar-end' }, this.status, this.statusAction, this.projectButton));
    this.start = h('main', { class: 'start' });
    this.main = h('main', { class: 'workspace' }, Object.values(this.views).map(v => v.el));
    document.body.append(this.topbar, this.start, this.main);

    Disk.store = Disk.mode === 'folder' ? FolderStore : DeviceStore;
    bus.on('save', () => this.renderStatus());
    bus.on('sync', () => this.renderStatus());
    bus.on('meta', () => this.renderProjectName());
    bus.on('conflict', detail => this.conflict(detail));
    addEventListener('beforeunload', event => {
      if (project && Saver.status !== 'saved') {
        Saver.flush();
        event.preventDefault();
      }
    });
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && project) Saver.flush();
      if (document.visibilityState === 'visible' && project) this.refresh();
    });
    addEventListener('focus', () => project && this.refresh());
    addEventListener('online', () => project && this.refresh(true));
    addEventListener('offline', () => project && Disk.mode === 'drive' && Sync.set('offline'));
    Inbox.init();
    // Coming back from Google's sign-in: carry on with what the user was doing.
    const signedIn = Disk.mode === 'drive' ? Google.receive() : null;
    this.showStart().then(() => signedIn && this.resume(signedIn));
  },

  go(name) {
    if (!project) return;
    if (this.current === name) return;
    Editor.close();
    this.views[this.current]?.hide();
    this.current = name;
    document.body.dataset.view = name;
    this.views[name].show();
    for (const button of this.nav.children) {
      const active = button.dataset.view === name;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
  },

  openSegment(docId, segmentId) {
    this.go('coding');
    this.views.coding.open(docId, { segmentId });
  },

  enter() {
    this.start.hidden = true;
    this.topbar.classList.remove('bare');
    this.main.hidden = false;
    this.renderProjectName();
    this.renderStatus();
    this.current = null;
    this.go(project.documents.length ? 'coding' : 'documents');
  },

  async showStart() {
    this.views[this.current]?.hide();
    this.current = null;
    delete document.body.dataset.view;
    this.main.hidden = true;
    this.topbar.classList.add('bare');
    this.start.hidden = false;
    const panel = h('div', { class: 'start-panel' }, h('h1', { class: 'start-title', text: 'MCdng' }));
    this.start.replaceChildren(panel);
    if (Disk.mode === 'folder') {
      const remembered = await FolderStore.remembered();
      // Returning to the last project is the usual case, so its button leads when there is one.
      const reopen = remembered && h('button', { type: 'button', class: 'btn primary large', text: `Reopen “${remembered.name}”`, onclick: () => this.openFolder(remembered, false) });
      panel.append(h('div', { class: 'start-actions' },
        reopen,
        h('button', { type: 'button', class: `btn large${reopen ? '' : ' primary'}`, text: 'New project', onclick: () => this.chooseFolder(true) }),
        h('button', { type: 'button', class: 'btn large', text: 'Open project', onclick: () => this.chooseFolder(false) })));
    } else {
      // Where folders cannot be opened (iPad): projects on Google Drive, kept in step automatically, and project
      // files opened from Files (iCloud Drive or anywhere), kept on this device.
      const remembered = await DeviceStore.remembered();
      const reopen = remembered && (remembered.device || Google.usable) && h('button', {
        type: 'button', class: 'btn primary large', text: `Reopen “${remembered.name}”`,
        onclick: () => (remembered.device ? this.openDevice(remembered) : this.openDrive(remembered)),
      });
      const lead = reopen ? '' : ' primary';
      panel.append(h('div', { class: 'start-actions' },
        reopen,
        Google.usable && h('button', { type: 'button', class: `btn large${lead}`, text: 'Open from Google Drive', onclick: () => this.chooseDrive() }),
        h('button', { type: 'button', class: `btn large${Google.usable ? '' : lead}`, text: 'Open project file', onclick: () => Transfer.pick(file => Transfer.openHere(file)) }),
        h('button', { type: 'button', class: 'btn large', text: 'New project', onclick: () => this.newHere() })));
    }
  },

  // A new project where folders cannot be opened: on Google Drive, or on this device only.
  async newHere() {
    let where = 'device';
    if (Google.usable) {
      where = await Dialog.open({
        title: 'New project',
        body: [
          h('p', { text: 'Where do you want to keep it?' }),
          h('p', { class: 'muted', text: 'On Google Drive it stays in step with your other devices by itself. On this device only, you carry it as a project file through Files, for example on iCloud Drive.' }),
        ],
        buttons: [
          { label: 'Cancel', result: null },
          { label: 'On this device only', result: 'device' },
          { label: 'On Google Drive', kind: 'primary', result: 'drive' },
        ],
      });
    }
    if (where === 'drive') return this.newDrive();
    if (!where) return;
    const name = await Dialog.prompt('New project', 'Project name', '', 'Create project');
    if (!name) return;
    const target = { id: `device:${uid()}`, name, device: true };
    await DeviceStore.use(target);
    await this.createProject(name);
    await Memory.set(`device:${project.created}`, target).catch(() => {});
  },

  async openDevice(target) {
    try {
      await DeviceStore.use(target);
      if (!await Disk.exists(PROJECT_FILE)) throw new Error('This project is no longer on this device. Open its project file again.');
      await this.openProject();
    } catch (err) {
      Dialog.alert('The project could not be opened', err.message);
    }
  },

  async chooseFolder(create) {
    let handle;
    try {
      handle = await window.showDirectoryPicker({ id: 'mcdng', mode: 'readwrite' });
    } catch {
      return;
    }
    await this.openFolder(handle, create);
  },

  async openFolder(handle, create) {
    try {
      await FolderStore.use(handle);
      const exists = await Disk.exists(PROJECT_FILE);
      if (exists) {
        if (create) Toast.show(`“${handle.name}” already contains a project, so it was opened.`);
        await this.openProject();
      } else if (create) {
        const name = await Dialog.prompt('New project', 'Project name', handle.name, 'Create project');
        if (!name) return;
        await this.createProject(name);
      } else {
        Dialog.alert('No project in this folder', `“${handle.name}” does not contain an MCdng project. Choose New project to start one there.`);
      }
    } catch (err) {
      Dialog.alert('The project could not be opened', err.message);
    }
  },

  // Reads project.json of the store in use, keeps today's backup, upgrades old projects and shows the project.
  async openProject() {
    const text = await Disk.readText(PROJECT_FILE);
    const data = normalizeProject(JSON.parse(text));
    const backup = `backups/project-${today()}.json`;
    if (!await Disk.exists(backup)) await Disk.write(backup, text);
    await Library.upgrade(data);
    await Library.writeGuide();
    this.load(data);
    await Saver.remember(await Disk.readText(PROJECT_FILE));
    await Transfer.load();
  },

  async createProject(name) {
    const data = emptyProject(name);
    const text = JSON.stringify(data, null, 1);
    await Disk.write(PROJECT_FILE, text);
    await Library.writeGuide();
    this.load(data);
    await Saver.remember(text);
    await Transfer.load();
  },

  // Google Drive. Each action that needs Drive signs in first when there is no valid token, leaving the page
  // and coming back to `resume` with the same action.
  needsSignIn(resume) {
    if (Google.token()) return false;
    if (!navigator.onLine) {
      Dialog.alert('No connection', 'Opening a project from Google Drive for the first time needs an internet connection.');
      return true;
    }
    Google.signIn({ resume });
    return true;
  },

  async resume({ resume, error }) {
    if (error && error !== 'interaction_required' && error !== 'login_required' && error !== 'consent_required') {
      Toast.error(error === 'access_denied' ? 'Google Drive was not allowed, so MCdng cannot sync.' : `Google sign-in did not work: ${error}`);
    }
    if (!error) DriveApi.user().then(user => Google.remember(user.emailAddress)).catch(() => {});
    if (resume?.action === 'open') await this.openDrive(resume.project, resume.view, true);
    else if (resume?.action === 'choose' && !error) await this.chooseDrive();
    else if (resume?.action === 'new' && !error) await this.newDrive();
  },

  async chooseDrive() {
    if (this.needsSignIn({ action: 'choose' })) return;
    const progress = Toast.show('Looking for MCdng projects on Google Drive…', { timeout: 0 });
    let found;
    try {
      found = await Sync.projects();
    } catch (err) {
      return Dialog.alert('Google Drive could not be read', err.message);
    } finally {
      progress.close();
    }
    if (!found.length) {
      return Dialog.alert('No projects found', 'No folder on your Google Drive contains an MCdng project.json. Choose New project on Google Drive to start one.');
    }
    const chosen = await Dialog.open({
      title: 'Open from Google Drive',
      body: finish => h('div', { class: 'pick-list' }, found.map(p => h('button', {
        type: 'button', class: 'pick-row', onclick: () => finish(p),
      }, h('span', { class: 'pick-name', text: p.name }), h('span', { class: 'pick-meta', text: `Changed ${fmtDate(p.modified)}` })))),
      buttons: [{ label: 'Cancel', result: null }],
    });
    if (chosen) await this.openDrive({ id: chosen.id, name: chosen.name });
  },

  async newDrive() {
    if (this.needsSignIn({ action: 'new' })) return;
    const name = await Dialog.prompt('New project on Google Drive', 'Project name', '', 'Create project');
    if (!name) return;
    try {
      await DeviceStore.use(await Sync.createProject(name));
      await this.createProject(name);
      Sync.soon(0);
    } catch (err) {
      Dialog.alert('The project could not be created', err.message);
    }
  },

  // Opens a Drive project: first brings Drive's changes to the device when it can, then works from the device.
  // `back` is true on return from sign-in, which is then not tried again: without a token the project opens from
  // the device and the status offers to sign in.
  async openDrive(target, view = null, back = false) {
    if (!Google.token() && navigator.onLine && !back) {
      // A silent sign-in, unnoticed when the account has allowed MCdng before.
      Google.signIn({ resume: { action: 'open', project: target, view }, silent: true });
      return;
    }
    const progress = Toast.show(`Opening “${target.name}”…`, { timeout: 0 });
    try {
      await DeviceStore.use(target);
      let remote = null;
      if (Google.token() && navigator.onLine) remote = await Sync.pull().catch(() => null);
      if (!await Disk.exists(PROJECT_FILE)) {
        throw new Error(Google.token() && navigator.onLine
          ? `“${target.name}” on Google Drive does not contain an MCdng project.`
          : 'This project is not on this device yet. Connect to the internet and sign in to Google Drive to open it.');
      }
      if (remote?.conflict) await this.decide(remote.conflict, null);
      await this.openProject();
      if (view && view !== this.current) this.go(view);
      Sync.soon(0);
      Sync.prefetch();
    } catch (err) {
      Dialog.alert('The project could not be opened', err.message);
    } finally {
      progress.close();
    }
  },

  // Coming back to MCdng, or back online: picks up what was saved on the other device meanwhile.
  async refresh(online = false) {
    if (!project || Date.now() - (this.refreshed ?? 0) < (online ? 0 : 30_000)) return;
    this.refreshed = Date.now();
    let text = null;
    if (Disk.mode === 'folder') {
      text = await Saver.incoming();
    } else if (navigator.onLine && Google.token() && Sync.state !== 'conflict') {
      await Saver.flush();
      const remote = await Sync.pull().catch(() => null);
      if (remote?.conflict) return this.conflict(remote.conflict);
      if (remote?.changed) text = await Disk.readText(PROJECT_FILE);
      Sync.soon(0);
      Sync.prefetch();
    }
    if (!text) return;
    this.reload(normalizeProject(JSON.parse(text)));
    await Saver.remember(text);
    Toast.show('Updated with the changes saved on your other device.');
  },

  // project.json was changed both here and on another device. The user keeps one version; the other is
  // copied into backups, so nothing is lost.
  async conflict(remote) {
    this.pendingConflict = remote;
    this.renderStatus();
    if (this.deciding) return;
    this.deciding = true;
    try {
      await this.decide(remote, JSON.stringify(project, null, 1));
    } finally {
      this.deciding = false;
    }
  },

  // `here` is the project here as text, or null before it is loaded (then read from the device).
  async decide(remote, here) {
    const choice = await Dialog.open({
      title: 'Changed on two devices',
      wide: 'medium',
      body: [
        h('p', { text: 'This project was changed on another device and here since they were last in step. Which version do you want to keep?' }),
        h('p', { class: 'muted', text: 'The other version is copied into the backups folder of the project, so nothing is lost.' }),
      ],
      buttons: [
        { label: 'Decide later', result: null },
        { label: 'Keep the other version', result: 'other' },
        { label: 'Keep this version', kind: 'primary', result: 'here' },
      ],
    });
    if (!choice) {
      if (!project) throw new Error('The project stays closed until you choose which version to keep.');
      return;
    }
    here ??= await Disk.readText(PROJECT_FILE);
    const stamp = nowISO().slice(0, 19).replace(/[:T]/g, '-');
    if (choice === 'here') {
      await Disk.write(`backups/conflict-${stamp}-other-device.json`, remote.text);
      if (Disk.mode === 'drive') {
        await Sync.settle('here', remote);
      } else {
        Saver.base = null;
        Saver.setStatus('pending');
        await Saver.flush();
      }
    } else {
      await Disk.write(`backups/conflict-${stamp}-this-device.json`, here);
      if (Disk.mode === 'drive') await Sync.settle('drive', remote);
      if (project) {
        this.reload(normalizeProject(JSON.parse(remote.text)));
        await Saver.remember(remote.text);
      }
    }
    this.pendingConflict = null;
    this.renderStatus();
  },

  // Replaces the project in memory with a newer version, keeping the section and the open document.
  reload(data) {
    const docId = this.views.coding.doc?.id;
    project = data;
    Contents.cache.clear();
    Editor.close();
    Saver.setStatus('saved');
    bus.emit('project');
    this.renderProjectName();
    if (this.current === 'coding' && docId && Docs.get(docId)) this.views.coding.open(docId);
  },

  load(data) {
    project = data;
    Contents.cache.clear();
    Saver.setStatus('saved');
    bus.emit('project');
    this.enter();
  },

  async close() {
    await Saver.flush();
    Editor.close();
    project = null;
    if (Disk.mode === 'drive') {
      // What is not sent now stays on the device and goes at the next opening.
      await Sync.push();
      DeviceStore.project = null;
    }
    bus.emit('project');
    this.renderProjectName();
    this.showStart();
  },

  renderProjectName() {
    const name = project?.name;
    document.title = name ? `${name} · MCdng` : 'MCdng';
    this.projectButton.title = name ? `${name}: project options` : '';
    this.projectButton.setAttribute('aria-label', this.projectButton.title);
  },

  renderStatus() {
    const { status, error } = Saver;
    let kind = status, text, title = error?.message ?? '', action = null;
    if (status === 'pending') text = 'Saving…';
    else if (status === 'error') text = 'Not saved';
    else if (status === 'conflict' || this.pendingConflict) {
      [kind, text, action] = ['error', 'Changed on two devices', ['Choose', () => this.conflict(this.pendingConflict)]];
    } else if (Disk.mode === 'folder') text = 'All changes saved';
    else if (DeviceStore.project?.device) {
      [kind, text] = ['saved', 'Saved on this device'];
      if (Transfer.pending) action = ['Export', () => Transfer.export()];
    } else {
      const sync = Sync.state;
      const down = Sync.downloads;
      if (sync === 'synced') [kind, text] = ['saved', down ? `On Drive · downloading ${down.done} of ${down.total}` : 'All changes on Drive'];
      else if (sync === 'offline') [kind, text, title] = ['pending', 'Saved here · offline', 'Changes go to Google Drive when the connection is back.'];
      else if (sync === 'signin') [kind, text, action] = ['pending', 'Saved here', ['Sign in to sync', () => this.signInAgain()]];
      else if (sync === 'error') [kind, text, title, action] = ['error', 'Not synced', Sync.error?.message ?? '', ['Try again', () => Sync.push()]];
      else [kind, text] = ['pending', 'Saved here · syncing…'];
    }
    this.status.className = `save-status ${kind}`;
    this.status.textContent = text;
    this.status.title = title;
    this.statusAction.hidden = !action;
    if (action) {
      this.statusAction.textContent = action[0];
      this.statusAction.onclick = action[1];
    }
    if (status === 'error') Toast.error(`Changes could not be saved to the project folder. ${error.message}`);
  },

  // The hour-long Google token ran out: sign in again and come back to the same place.
  async signInAgain() {
    await Saver.flush();
    if (!navigator.onLine) return Sync.set('offline');
    Google.signIn({ resume: { action: 'open', project: DeviceStore.project, view: this.current } });
  },

  async projectMenu() {
    const device = Disk.mode === 'drive' && DeviceStore.project?.device;
    const where = Disk.mode === 'folder'
      ? `Saved in the folder “${Disk.name}”.`
      : device
        ? 'Kept on this device only. To work on it elsewhere, export the project file (to iCloud Drive, for example) and open it there; bring the changes back with Import changes from a file.'
        : `Saved in the folder “${Disk.name}” on Google Drive, and on this device so it works offline.`;
    const action = (label, result, hint) => ({ label, result, hint });
    const actions = [
      action('Export project file', 'export', 'A zip of the project for another device, through Files or the Finder.'),
      // A Google Drive project is kept in step by itself, so it does not take changes from files.
      (Disk.mode === 'folder' || device) && action('Import changes from a file', 'import', 'Brings in a project file exported on another device.'),
      action('Rename project', 'rename'),
      action('Close project', 'close'),
    ].filter(Boolean);
    const choice = await Dialog.open({
      title: project.name,
      body: finish => [
        h('p', { class: 'muted', text: `${where} Each day you open the project, a copy of project.json is kept in its backups folder.` }),
        h('div', { class: 'pick-list' }, actions.map(a => h('button', { type: 'button', class: 'pick-row', onclick: () => finish(a.result) },
          h('span', { class: 'pick-name', text: a.label }), a.hint && h('span', { class: 'pick-meta', text: a.hint })))),
      ],
      buttons: [{ label: 'Done', kind: 'primary', result: null, submit: true }],
    });
    if (choice === 'close') this.close();
    if (choice === 'export') Transfer.export();
    if (choice === 'import') Transfer.pick(file => Transfer.bringIn(file));
    if (choice === 'rename') {
      const name = await Dialog.prompt('Rename project', 'Project name', project.name);
      if (name) {
        project.name = name;
        commit('meta');
      }
    }
  },
};

// A folder outline, for the project menu button.
function folderIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<path d="M2.75 5.75a2 2 0 0 1 2-2h3.1l1.9 2h5.5a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2H4.75a2 2 0 0 1-2-2z"/>';
  return svg;
}

App.init();

// For the browser console and the tests: the running app's state.
globalThis.MCdng = { App, Sync, Saver, Transfer, Zip, commit, get project() { return project; } };
