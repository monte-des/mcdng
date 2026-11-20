// Bibliographic details of a document: what the file says about itself, and what Crossref or DataCite know
// about it. Online lookups only ever add to what the file gives. Without a connection, or when nothing
// matches, a document keeps the details read from its file and MCdng works exactly the same.

const META_FIELDS = ['title', 'authors', 'year', 'journal', 'volume', 'issue', 'articlePages', 'doi'];
const META_LABELS = { title: 'Title', authors: 'Authors', year: 'Year', journal: 'Journal or source', volume: 'Volume', issue: 'Issue', articlePages: 'Pages', doi: 'DOI' };
const META_SOURCES = { file: 'Read from the file', crossref: 'From Crossref', datacite: 'From DataCite', publisher: 'From the publisher’s page' };

// A title match this close is taken without asking; a weaker one is offered for confirmation.
const SURE_MATCH = 0.9;
const POSSIBLE_MATCH = 0.6;

function emptyDocMeta() {
  return { source: 'file', checked: null, edited: [], guessed: [] };
}

function findDoi(text) {
  const match = /\b10\.\d{4,9}\/[^\s"<>]+/.exec(text ?? '');
  return match ? match[0].replace(/[.,;)\]]+$/, '') : '';
}

// arXiv preprints carry DataCite DOIs of the form 10.48550/arXiv.<id>.
function findArxiv(text) {
  const id = /\barXiv:\s*(\d{4}\.\d{4,5})(?:v\d+)?\b/i.exec(text ?? '')?.[1];
  return id ? `10.48550/arXiv.${id}` : '';
}

// The details of a newly imported file: its own metadata, then its text and its file name.
function fileMetadata(meta, content, fileName) {
  const base = fileName.replace(/\.[^.]+$/, '');
  const head = content.text.slice(0, 20000);
  const out = {
    title: meta.title || base.replace(/_+/g, ' ').trim(),
    authors: meta.authors ?? '',
    year: meta.year || yearIn(base),
    journal: meta.journal ?? '',
    volume: meta.volume ?? '',
    issue: meta.issue ?? '',
    articlePages: meta.articlePages ?? '',
    doi: meta.doi || findDoi(head) || findArxiv(head),
  };
  // A title taken from the file name is only a placeholder: it is never used to search online.
  const guessed = meta.title ? [] : ['title'];
  return { fields: out, meta: { ...emptyDocMeta(), guessed } };
}

// Lookups

class OfflineError extends Error {}

function plainText(markup) {
  return new DOMParser().parseFromString(markup ?? '', 'text/html').body.textContent.replace(/\s+/g, ' ').trim();
}

function fromCrossref(m) {
  const title = plainText(m.title?.[0]);
  const subtitle = plainText(m.subtitle?.[0]);
  const year = m.issued?.['date-parts']?.[0]?.[0] ?? m.published?.['date-parts']?.[0]?.[0];
  return {
    source: 'crossref',
    title: subtitle && !title.toLowerCase().includes(subtitle.toLowerCase()) ? `${title}: ${subtitle}` : title,
    authors: (m.author ?? []).map(a => (a.family ? (a.given ? `${a.family}, ${initials(a.given)}` : a.family) : a.name ?? '')).filter(Boolean).join('; '),
    year: year ? String(year) : '',
    journal: plainText(m['container-title']?.[0]),
    volume: m.volume ?? '',
    issue: m.issue ?? '',
    articlePages: (m.page ?? '').replace('-', '–'),
    doi: m.DOI ?? '',
  };
}

function fromDataCite(d) {
  const a = d.attributes ?? {};
  const c = a.container ?? {};
  return {
    source: 'datacite',
    title: plainText(a.titles?.[0]?.title),
    authors: (a.creators ?? []).map(p => (p.familyName ? (p.givenName ? `${p.familyName}, ${initials(p.givenName)}` : p.familyName) : personName(p.name ?? ''))).filter(Boolean).join('; '),
    year: a.publicationYear ? String(a.publicationYear) : '',
    journal: c.title ?? a.publisher ?? '',
    volume: c.volume ?? '',
    issue: c.issue ?? '',
    articlePages: [c.firstPage, c.lastPage].filter(Boolean).join('–'),
    doi: a.doi ?? '',
  };
}

const Lookup = {
  timeout: 10000,

  // Crossref and DataCite allow requests from any page, file:// included. Every failure to reach them
  // is an OfflineError, so callers can tell "no connection" from "no match".
  async json(url) {
    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(this.timeout) });
    } catch {
      throw new OfflineError('No connection');
    }
    if (response.status === 404) return null;
    if (!response.ok) throw new OfflineError(`The service answered ${response.status}`);
    return response.json();
  },

  async byDoi(doi) {
    const id = encodeURIComponent(doi.trim());
    const crossref = await this.json(`https://api.crossref.org/works/${id}`);
    if (crossref?.message) return fromCrossref(crossref.message);
    const datacite = await this.json(`https://api.datacite.org/dois/${id}`);
    return datacite?.data ? fromDataCite(datacite.data) : null;
  },

  async byTitle(title, author) {
    const query = encodeURIComponent([title, author].filter(Boolean).join(' '));
    const fields = 'DOI,title,subtitle,author,issued,published,container-title,volume,issue,page';
    const result = await this.json(`https://api.crossref.org/works?query.bibliographic=${query}&rows=5&select=${fields}`);
    return (result?.message?.items ?? []).map(fromCrossref);
  },

  // Finds the record of a document: by its DOI when it has one, otherwise by its title.
  // Returns { record, sure, candidates }; record is null when nothing fits.
  async find(doc) {
    const knowsTitle = !doc.meta?.guessed?.includes('title') && titleWords(doc.title).length >= 3;
    const candidates = [];
    if (doc.doi) {
      const record = await this.byDoi(doc.doi);
      if (record) {
        // A DOI found in the text may belong to a cited paper: the record must match the printed title.
        if (!knowsTitle || titleSimilarity(record.title, doc.title) >= 0.5) return { record, sure: true, candidates: [record] };
        candidates.push(record);
      }
    }
    if (!knowsTitle) return { record: candidates[0] ?? null, sure: false, candidates };
    const author = doc.authors ? Docs.surname(doc.authors.split(';')[0]) : '';
    const scored = (await this.byTitle(doc.title, author))
      .map(record => {
        const off = doc.year && record.year && Math.abs(Number(doc.year) - Number(record.year)) > 1;
        return { record, score: titleSimilarity(record.title, doc.title) - (off ? 0.15 : 0) };
      })
      .filter(x => x.score >= POSSIBLE_MATCH)
      .sort((a, b) => b.score - a.score);
    for (const { record } of scored) if (!candidates.some(c => c.doi === record.doi)) candidates.push(record);
    const best = scored[0];
    return { record: best?.record ?? candidates[0] ?? null, sure: !!best && best.score >= SURE_MATCH, candidates };
  },
};

// Completes newly imported documents in the background, one at a time.
const Metadata = {
  queue: Promise.resolve(),

  // Resolves with the number of documents completed. Stops quietly at the first sign of no connection.
  enrich(ids) {
    const run = async () => {
      let done = 0;
      for (const id of ids) {
        const doc = project && Docs.get(id);
        if (!doc || !navigator.onLine) break;
        let found;
        try {
          found = await Lookup.find(doc);
        } catch (err) {
          if (err instanceof OfflineError) break;
          throw err;
        }
        if (Docs.get(id) !== doc) continue;
        if (found.record && found.sure) {
          Actions.applyMetadata(id, found.record, META_FIELDS.filter(f => !doc.meta.edited.includes(f)));
          done++;
        } else {
          Actions.markMetadataChecked(id);
        }
      }
      return done;
    };
    const result = this.queue.then(run);
    this.queue = result.catch(() => 0);
    return result;
  },
};
