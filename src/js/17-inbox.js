// Papers saved from the browser with Save to MCdng. When MCdng runs as the browser extension, the extension
// keeps each saved PDF in its inbox (the extension's IndexedDB "mcdng-inbox") and tells this page. With a
// project open, the paper is imported at once; otherwise it waits and is offered when a project opens.
// As a plain MCdng.html file there is no extension and this module does nothing.

const Inbox = {
  enabled: typeof chrome !== 'undefined' && !!chrome.runtime?.id,
  db: null,

  open() {
    this.db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('mcdng-inbox', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('items', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.db;
  },

  async count() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction('items').objectStore('items').count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  // Takes every waiting item out of the inbox in one transaction, so two open MCdng tabs never import the same paper.
  async claim() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('items', 'readwrite');
      const store = tx.objectStore('items');
      const request = store.getAll();
      request.onsuccess = () => {
        for (const item of request.result) store.delete(item.id);
      };
      tx.oncomplete = () => resolve(request.result.sort((a, b) => a.saved.localeCompare(b.saved)));
      tx.onerror = () => reject(tx.error);
    });
  },

  // Imports the waiting papers into the open project. Resolves with { imported: [doc], failed: [message] }.
  async importWaiting() {
    const imported = [];
    const failed = [];
    for (const item of await this.claim()) {
      try {
        const file = new File([item.blob], item.fileName, { type: 'application/pdf' });
        imported.push(await Library.import(file, item.details));
      } catch (err) {
        failed.push(`${item.details?.title || item.fileName}: ${err.message}`);
      }
    }
    if (imported.length) {
      Toast.show(imported.length === 1 ? `Saved from the browser: ${imported[0].title}` : `Saved ${plural(imported.length, 'paper')} from the browser.`);
      Metadata.enrich(imported.map(d => d.id)).catch(() => {});
    }
    for (const message of failed) Toast.error(`Not saved. ${message}`);
    return { imported, failed };
  },

  // Papers saved while no project was open are offered as soon as one opens.
  async offerWaiting() {
    const waiting = await this.count();
    if (!waiting || !project) return;
    const ok = await Dialog.confirm(
      waiting === 1 ? 'A paper saved from the browser is waiting' : `${waiting} papers saved from the browser are waiting`,
      `Add ${waiting === 1 ? 'it' : 'them'} to “${project.name}”? Otherwise ${waiting === 1 ? 'it waits' : 'they wait'} until you open another project.`,
      { confirmLabel: `Add to ${project.name}` });
    if (ok && project) await this.importWaiting();
  },

  init() {
    if (!this.enabled) return;
    chrome.runtime.onMessage.addListener((message, sender, reply) => {
      if (message?.type !== 'inbox' || !project) return false;
      this.importWaiting().then(
        ({ imported, failed }) => reply(imported.length ? { project: project.name, title: imported.at(-1).title } : { error: failed[0] ?? 'Nothing was waiting.' }),
        err => reply({ error: err.message }));
      return true;
    });
    bus.on('project', () => {
      if (project) this.offerWaiting();
    });
  },
};
