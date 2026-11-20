// Save to MCdng. From the tab the user is reading, finds the article's PDF and the bibliographic details the
// publisher's page declares, downloads the PDF with the browser's own access, and hands both to MCdng
// through an inbox in the extension's IndexedDB. MCdng saves it in the open project, or keeps it waiting
// until a project is opened.

const INBOX_DB = 'mcdng-inbox';
const APP_PAGE = 'app.html';

function openInbox() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(INBOX_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('items', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function addToInbox(item) {
  const db = await openInbox();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('items', 'readwrite');
    tx.objectStore('items').put(item);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

// Runs in the page: the Highwire Press and Dublin Core tags that publishers add for Google Scholar.
function readArticlePage() {
  const all = name => [...document.querySelectorAll(`meta[name="${name}" i], meta[property="${name}" i]`)].map(m => m.content.trim()).filter(Boolean);
  const one = (...names) => names.map(n => all(n)[0]).find(Boolean) ?? '';
  return {
    contentType: document.contentType,
    title: one('citation_title', 'dc.title'),
    authors: all('citation_author').length ? all('citation_author') : all('dc.creator'),
    date: one('citation_publication_date', 'citation_date', 'citation_online_date', 'citation_cover_date', 'dc.date'),
    journal: one('citation_journal_title', 'citation_conference_title', 'citation_book_title', 'prism.publicationName'),
    volume: one('citation_volume', 'prism.volume'),
    issue: one('citation_issue', 'prism.number'),
    firstPage: one('citation_firstpage', 'prism.startingPage'),
    lastPage: one('citation_lastpage', 'prism.endingPage'),
    doi: one('citation_doi', 'dc.identifier', 'prism.doi'),
    pdfUrl: one('citation_pdf_url'),
    // PDFs shown inside the page, as IEEE Xplore and many library proxies do. A reader inside the page (pdf.js,
    // as in Open Journal Systems) names its PDF in the file= part of its address, which comes first.
    embedded: [...document.querySelectorAll('iframe[src], embed[src], object[data]')].flatMap(el => {
      try {
        const url = new URL(el.getAttribute('src') ?? el.getAttribute('data'), location.href);
        if (!/^https?:$/.test(url.protocol) || !(/pdf/i.test(url.href) || url.searchParams.has('file'))) return [];
        const file = url.searchParams.get('file');
        return file ? [new URL(file, url).href, url.href] : [url.href];
      } catch {
        return [];
      }
    }),
    // Download links of the page: "Download", "PDF", or addresses with /download/ or .pdf.
    links: [...document.querySelectorAll('a[href]')]
      .filter(a => /^https?:/.test(a.href) && (/\/download\/|\.pdf($|[?#])/i.test(a.href) || /^\s*(download|pdf|download pdf|full[- ]text pdf)\s*$/i.test(a.textContent)))
      .map(a => a.href)
      .slice(0, 6),
  };
}

// Runs in every frame of the page, in the page's own scripts: a pdf.js reader (the e-reader of many journals and
// libraries) already holds the PDF it shows, even when its address cannot be downloaded again.
async function readViewerPdf() {
  const app = globalThis.PDFViewerApplication;
  if (!app?.pdfDocument) return null;
  const bytes = await app.pdfDocument.getData();
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { url: /^https?:/.test(app.url ?? '') ? app.url : location.href, data: btoa(binary) };
}

async function viewerPdf(tabId) {
  try {
    const results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: 'MAIN', func: readViewerPdf });
    const found = results.map(r => r.result).find(Boolean);
    return found && { url: found.url, bytes: Uint8Array.from(atob(found.data), c => c.charCodeAt(0)) };
  } catch {
    return null;
  }
}

// Runs in the page: downloads with the page's own cookies and access, returned as base64.
async function downloadInPage(url) {
  const response = await fetch(url, { credentials: 'include' });
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { status: response.status, data: btoa(binary) };
}

async function inPage(tabId, func, args = []) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return result?.result;
}

async function download(tabId, url) {
  try {
    const result = await inPage(tabId, downloadInPage, [url]);
    if (result?.status === 200) return Uint8Array.from(atob(result.data), c => c.charCodeAt(0));
  } catch {
    // The page may forbid scripts (a PDF viewer) or the PDF lives on another site: download from here instead.
  }
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`The publisher answered ${response.status}. You may need to sign in first.`);
  return new Uint8Array(await response.arrayBuffer());
}

// "Smith, John" or "John Smith" → "Smith, J.", as MCdng writes authors.
function personName(name) {
  const n = name.replace(/\s+/g, ' ').trim();
  const initials = given => given.split(' ').filter(Boolean).map(w => w.split('-').map(p => `${p[0]}.`).join('-')).join(' ');
  if (n.includes(',')) {
    const [family, given] = n.split(',', 2).map(s => s.trim());
    return given ? `${family}, ${initials(given)}` : family;
  }
  const parts = n.split(' ');
  return parts.length > 1 ? `${parts.pop()}, ${initials(parts.join(' '))}` : n;
}

function publisherDetails(page) {
  if (!page?.title) return null;
  const doi = /\b10\.\d{4,9}\/[^\s"<>]+/.exec(page.doi)?.[0] ?? '';
  return {
    source: 'publisher',
    title: page.title,
    authors: page.authors.map(personName).join('; '),
    year: /(?<!\d)(19|20)\d{2}(?!\d)/.exec(page.date)?.[0] ?? '',
    journal: page.journal,
    volume: page.volume,
    issue: page.issue,
    articlePages: [page.firstPage, page.lastPage].filter(Boolean).join('–'),
    doi,
  };
}

// The PDF's own name when the address has one; otherwise the DOI, or where and when it was saved. MCdng uses
// the name as the title only when neither the publisher nor the file gives one.
function fileNameFor(url, details) {
  const { pathname, hostname } = new URL(url);
  const last = decodeURIComponent(pathname.split('/').pop() || '');
  if (/\.pdf$/i.test(last)) return last;
  if (details?.doi) return `${details.doi.replace(/[^\w.-]+/g, '_')}.pdf`;
  return `Paper from ${hostname.replace(/^www\./, '')} ${new Date().toISOString().slice(0, 10)}.pdf`;
}

const isPdf = bytes => new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';

// The PDF of a tab, tried in this order: the PDF the publisher's page declares; the tab itself (a PDF in the
// browser's viewer often has an address that does not end in .pdf, so only its first bytes tell); the PDF a
// reader in the page holds; PDFs shown inside the page; the page's download links. Each is accepted only when
// its first bytes say PDF. Resolves with { url, bytes }, or null when none of them is a PDF.
async function findPdf(tabId, tab, page) {
  const first = [page?.pdfUrl, tab.url].filter(Boolean).map(url => new URL(url, tab.url).href);
  const later = [...(page?.embedded ?? []), ...(page?.links ?? [])];
  const tried = new Set();
  const attempt = async url => {
    if (tried.has(url)) return null;
    tried.add(url);
    try {
      const bytes = await download(tabId, url);
      return isPdf(bytes) ? { url, bytes } : null;
    } catch {
      // Not reachable with this access: try the next candidate.
      return null;
    }
  };
  for (const url of first) {
    const found = await attempt(url);
    if (found) return found;
  }
  const shown = await viewerPdf(tabId);
  if (shown && isPdf(shown.bytes)) return shown;
  for (const url of later) {
    const found = await attempt(url);
    if (found) return found;
  }
  return null;
}

// Saves the article in a tab. Resolves with what the popup shows.
async function saveTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (/^file:/.test(tab.url ?? '')) throw new Error('This PDF is already on your computer: drop it on the Documents page of MCdng to import it.');
  if (!/^https?:/.test(tab.url ?? '')) throw new Error('Open the page of an article, or its PDF, then click Save to MCdng.');
  let page = null;
  try {
    page = await inPage(tabId, readArticlePage);
  } catch {
    // A PDF viewer may not run scripts; the tab is then tried as a PDF as it is.
  }
  const found = await findPdf(tabId, tab, page);
  if (!found) {
    throw new Error(page?.pdfUrl
      ? 'The publisher’s PDF link returned a web page, not a PDF. You may need to sign in; or open the PDF and click Save to MCdng again.'
      : 'No PDF found in this tab. Open the article’s PDF, then click Save to MCdng again.');
  }
  // The publisher's details describe the article page; a PDF tab has none and MCdng reads the file instead.
  const details = publisherDetails(page);
  const { url: pdfUrl, bytes } = found;
  const item = {
    id: crypto.randomUUID(),
    blob: new Blob([bytes], { type: 'application/pdf' }),
    fileName: fileNameFor(pdfUrl, details),
    details,
    url: tab.url,
    saved: new Date().toISOString(),
  };
  await addToInbox(item);
  // MCdng answers when it is open with a project, with the title it read; otherwise the paper waits in the inbox.
  const answer = await chrome.runtime.sendMessage({ type: 'inbox' }).catch(() => null);
  if (answer?.error) throw new Error(answer.error);
  const title = answer?.title || details?.title || item.fileName;
  return answer?.project ? { state: 'saved', project: answer.project, title } : { state: 'waiting', title };
}

async function openApp() {
  const url = chrome.runtime.getURL(APP_PAGE);
  const [tab] = await chrome.tabs.query({ url });
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type === 'save') {
    saveTab(message.tabId).then(reply, err => reply({ state: 'error', error: err.message }));
    return true;
  }
  if (message?.type === 'open-app') {
    openApp().then(() => reply({}));
    return true;
  }
  return false;
});
