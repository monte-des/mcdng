// App shell: start screen, top bar, navigation between sections and project lifecycle.

const SECTIONS = [['documents', 'Documents'], ['coding', 'Coding'], ['review', 'Review'], ['codebook', 'Codebook'], ['insights', 'Insights']];

const App = {
  views: {},
  current: null,

  init() {
    this.views = { documents: new DocumentsView(), coding: new CodingView(), review: new ReviewView(), codebook: new CodebookView(), insights: new InsightsView() };
    this.nav = h('nav', { class: 'nav', 'aria-label': 'Sections' }, SECTIONS.map(([key, label]) => h('button', {
      type: 'button', text: label, dataset: { view: key }, onclick: () => this.go(key),
    })));
    this.projectButton = h('button', { type: 'button', class: 'project-button', onclick: () => this.projectMenu() }, folderIcon());
    this.status = h('span', { class: 'save-status', role: 'status' });
    this.topbar = h('header', { class: 'topbar' },
      h('span', { class: 'brand', text: 'MCdng' }),
      this.nav,
      h('div', { class: 'topbar-end' }, this.status, this.projectButton));
    this.start = h('main', { class: 'start' });
    this.main = h('main', { class: 'workspace' }, Object.values(this.views).map(v => v.el));
    document.body.append(this.topbar, this.start, this.main);

    bus.on('save', () => this.renderStatus());
    bus.on('meta', () => this.renderProjectName());
    addEventListener('beforeunload', event => {
      if (project && Saver.status !== 'saved') {
        Saver.flush();
        event.preventDefault();
      }
    });
    addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && project) Saver.flush();
    });
    Inbox.init();
    this.showStart();
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
    const remembered = Disk.supported ? await Disk.remembered() : null;
    // Returning to the last project is the usual case, so its button leads when there is one.
    const reopen = remembered && h('button', { type: 'button', class: 'btn primary large', text: `Reopen “${remembered.name}”`, onclick: () => this.openFolder(remembered, false) });
    this.start.replaceChildren(h('div', { class: 'start-panel' },
      h('h1', { class: 'start-title', text: 'MCdng' }),
      Disk.supported
        ? h('div', { class: 'start-actions' },
          reopen,
          h('button', { type: 'button', class: `btn large${reopen ? '' : ' primary'}`, text: 'New project', onclick: () => this.chooseFolder(true) }),
          h('button', { type: 'button', class: 'btn large', text: 'Open project', onclick: () => this.chooseFolder(false) }))
        : h('p', { class: 'start-warning', text: 'MCdng saves projects as folders on your computer, which needs Google Chrome or Microsoft Edge. Open this file in one of them.' })));
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
      await Disk.use(handle);
      const exists = await Disk.exists(PROJECT_FILE);
      if (exists) {
        if (create) Toast.show(`“${handle.name}” already contains a project, so it was opened.`);
        const text = await Disk.readText(PROJECT_FILE);
        const data = normalizeProject(JSON.parse(text));
        const backup = `backups/project-${today()}.json`;
        if (!await Disk.exists(backup)) await Disk.write(backup, text);
        await Library.upgrade(data);
        await Library.writeGuide();
        this.load(data);
      } else if (create) {
        const name = await Dialog.prompt('New project', 'Project name', handle.name, 'Create project');
        if (!name) return;
        const data = emptyProject(name);
        await Disk.write(PROJECT_FILE, JSON.stringify(data, null, 1));
        await Library.writeGuide();
        this.load(data);
      } else {
        Dialog.alert('No project in this folder', `“${handle.name}” does not contain an MCdng project. Choose New project to start one there.`);
      }
    } catch (err) {
      Dialog.alert('The project could not be opened', err.message);
    }
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
    this.status.className = `save-status ${status}`;
    this.status.textContent = status === 'saved' ? 'All changes saved' : status === 'pending' ? 'Saving…' : 'Not saved';
    this.status.title = error?.message ?? '';
    if (status === 'error') Toast.error(`Changes could not be saved to the project folder. ${error.message}`);
  },

  async projectMenu() {
    const choice = await Dialog.open({
      title: project.name,
      body: h('p', { class: 'muted', text: `Saved in the folder “${Disk.root.name}”. Each day you open the project, a copy of project.json is kept in its backups folder.` }),
      buttons: [
        { label: 'Close project', result: 'close' },
        { label: 'Rename project', result: 'rename' },
        { label: 'Done', kind: 'primary', result: null, submit: true },
      ],
    });
    if (choice === 'close') this.close();
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
