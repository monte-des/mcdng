// Keyword statistics and theme overviews, derived from the coded segments. Nothing here is saved:
// every figure is recomputed from the segments, so it always agrees with the other sections.
//
// Terms come in two kinds: 'words' (Porter stems of content words) and 'phrases' (runs of two or three
// content words within a clause). A term is { kind, key, label }, where key is the stems joined by spaces.

const TERM_KINDS = { words: 'Words', phrases: 'Phrases' };
const PHRASE_MIN = 2;

const Analysis = {
  cache: new Map(),
  excludedSignature: null,

  // Words the user excluded act as stopwords; excluded phrases are dropped from the phrase list.
  exclusions() {
    const signature = project.keywords.excluded.join('\n');
    if (signature !== this.excludedSignature) {
      this.excludedSignature = signature;
      const keys = project.keywords.excluded.map(termKey).filter(Boolean);
      this.excludedWords = new Set(keys.filter(k => !k.includes(' ')));
      this.excludedPhrases = new Set(keys.filter(k => k.includes(' ')));
      this.cache.clear();
    }
  },

  // Term counts and surface forms of one segment, cached by segment.
  terms(seg) {
    this.exclusions();
    const cached = this.cache.get(seg.id);
    if (cached?.text === seg.text) return cached;
    const entry = { text: seg.text, words: { counts: new Map(), forms: new Map() }, phrases: { counts: new Map(), forms: new Map() } };
    const add = (bag, key, form) => {
      bag.counts.set(key, (bag.counts.get(key) ?? 0) + 1);
      if (!bag.forms.has(key)) bag.forms.set(key, new Map());
      const forms = bag.forms.get(key);
      forms.set(form, (forms.get(form) ?? 0) + 1);
    };
    let run = [];
    const flush = () => {
      for (let n = 2; n <= 3; n++) {
        for (let i = 0; i + n <= run.length; i++) {
          const part = run.slice(i, i + n);
          const key = part.map(t => t.stem).join(' ');
          if (!this.excludedPhrases.has(key)) add(entry.phrases, key, part.map(t => t.surface).join(' '));
        }
      }
      run = [];
    };
    for (const token of tokenize(seg.text, this.excludedWords)) {
      if (token.brk || token.stop) flush();
      if (token.stop) continue;
      add(entry.words, token.stem, token.surface);
      run.push(token);
    }
    flush();
    this.cache.set(seg.id, entry);
    return entry;
  },

  contains(seg, term) {
    return this.terms(seg)[term.kind].counts.has(term.key);
  },

  // Character ranges of a term in a text, for highlighting.
  ranges(text, term) {
    this.exclusions();
    const stems = term.key.split(' ');
    const tokens = tokenize(text, this.excludedWords);
    const out = [];
    for (let i = 0; i + stems.length <= tokens.length; i++) {
      const part = tokens.slice(i, i + stems.length);
      if (part.every((t, k) => t.stem === stems[k] && !t.stop && (k === 0 || !t.brk))) out.push([part[0].start, part.at(-1).end]);
    }
    return out;
  },

  // Segments shown elsewhere in the tool: those with at least one active code.
  coded() {
    return project.segments.filter(Segs.visible);
  },

  codeSet(id, subcodes) {
    return new Set([id, ...(subcodes ? Codes.descendants(id) : [])].filter(c => Codes.isActive(c)));
  },

  inCodes(ids, segments = this.coded()) {
    return segments.filter(seg => seg.codes.some(c => ids.has(c)));
  },

  // Totals per term over a set of segments: { rows: Map(key -> row), total, segments }.
  stats(segments, kind) {
    const rows = new Map();
    let total = 0;
    for (const seg of segments) {
      const bag = this.terms(seg)[kind];
      for (const [key, n] of bag.counts) {
        let row = rows.get(key);
        if (!row) rows.set(key, (row = { key, occurrences: 0, segments: 0, docs: new Set(), forms: new Map() }));
        row.occurrences += n;
        row.segments++;
        row.docs.add(seg.docId);
        total += n;
        for (const [form, k] of bag.forms.get(key)) row.forms.set(form, (row.forms.get(form) ?? 0) + k);
      }
    }
    return { rows, total, segments: segments.length };
  },

  // Surface forms, most frequent first; the first one labels the term.
  forms(row) {
    return [...row.forms.entries()].sort((a, b) => b[1] - a[1] || byText(a[0], b[0])).map(([form]) => form);
  },

  label(row) {
    return this.forms(row)[0];
  },

  // How much more typical each term is of a subset of segments than of the rest: the log-odds ratio with an
  // informative Dirichlet prior, divided by its standard error (Monroe, Colaresi and Quinn, 2008). The prior
  // is the term's count in all coded segments. Returns null when the subset is everything.
  distinctiveness(part, all) {
    const rest = all.total - part.total;
    if (part.total === 0 || rest <= 0) return null;
    const scores = new Map();
    for (const [key, row] of part.rows) {
      const prior = all.rows.get(key).occurrences;
      const a = row.occurrences;
      const b = prior - a;
      const otherA = part.total + all.total - a - prior;
      const otherB = rest + all.total - b - prior;
      if (otherA <= 0 || otherB <= 0) continue;
      const delta = Math.log((a + prior) / otherA) - Math.log((b + prior) / otherB);
      scores.set(key, delta / Math.sqrt(1 / (a + prior) + 1 / (b + prior)));
    }
    return scores;
  },

  // Rows ready for display, with distinctiveness when the scope is a subset of the coded segments.
  keywordRows({ kind, codeId, subcodes }) {
    const coded = this.coded();
    const segments = codeId ? this.inCodes(this.codeSet(codeId, subcodes), coded) : coded;
    const part = this.stats(segments, kind);
    const scores = codeId ? this.distinctiveness(part, this.stats(coded, kind)) : null;
    const rows = [...part.rows.values()]
      .filter(row => kind === 'words' || row.occurrences >= PHRASE_MIN)
      .map(row => ({ ...row, label: this.label(row), score: scores?.get(row.key) ?? null }));
    return { rows, segments, total: part.total, hasScores: !!scores };
  },

  // The few words most typical of a set of segments, for theme summaries.
  typicalWords(segments, all, limit = 4) {
    const part = this.stats(segments, 'words');
    const scores = this.distinctiveness(part, all);
    const rank = row => (scores ? scores.get(row.key) ?? 0 : row.occurrences);
    const rows = [...part.rows.values()];
    const repeated = rows.filter(row => row.occurrences >= 2);
    return (repeated.length ? repeated : rows)
      .sort((a, b) => rank(b) - rank(a) || b.occurrences - a.occurrences)
      .slice(0, limit)
      .map(row => this.label(row));
  },

  // One row per active code with the segments of the code and its subcodes, the papers they come from,
  // their share of all coded segments and the words most typical of them.
  themes() {
    const coded = this.coded();
    const all = this.stats(coded, 'words');
    return Codes.tree().map(({ code, depth }) => {
      const segments = this.inCodes(this.codeSet(code.id, true), coded);
      const byDoc = new Map();
      for (const seg of segments) byDoc.set(seg.docId, (byDoc.get(seg.docId) ?? 0) + 1);
      return {
        code, depth, segments, byDoc,
        share: coded.length ? segments.length / coded.length : 0,
        words: segments.length ? this.typicalWords(segments, all) : [],
      };
    });
  },

  // Pairs of codes that apply to the same passage, on one segment or on overlapping segments. A passage
  // is a stretch of text where both codes apply without a gap.
  cooccurrences() {
    const pairs = new Map();
    const coded = this.coded();
    for (const docId of new Set(coded.map(s => s.docId))) {
      const items = coded.filter(s => s.docId === docId).map(s => ({ start: s.start, end: s.end, codes: Segs.activeCodes(s) }));
      const open = new Map();
      for (const atom of buildAtoms(items)) {
        const here = new Set();
        for (let i = 0; i < atom.codes.length; i++) {
          for (let j = i + 1; j < atom.codes.length; j++) {
            const key = `${atom.codes[i]}|${atom.codes[j]}`;
            here.add(key);
            if (open.get(key) === atom.start) {
              open.set(key, atom.end);
              continue;
            }
            open.set(key, atom.end);
            let pair = pairs.get(key);
            if (!pair) pairs.set(key, (pair = { a: atom.codes[i], b: atom.codes[j], passages: 0, docs: new Set() }));
            pair.passages++;
            pair.docs.add(docId);
          }
        }
        for (const key of open.keys()) if (!here.has(key)) open.delete(key);
      }
    }
    return [...pairs.values()].sort((x, y) => y.passages - x.passages || y.docs.size - x.docs.size);
  },

  // Pairs of codes whose segments use similar words: cosine similarity of TF-IDF vectors, one vector per
  // code built from its own segments. A code and its own subcodes are not compared.
  similarities(limit = 12, threshold = 0.1) {
    const coded = this.coded();
    const vectors = [];
    for (const { code } of Codes.tree()) {
      const stats = this.stats(this.inCodes(new Set([code.id]), coded), 'words');
      if (stats.total) vectors.push({ code, stats });
    }
    const df = new Map();
    for (const { stats } of vectors) for (const key of stats.rows.keys()) df.set(key, (df.get(key) ?? 0) + 1);
    for (const v of vectors) {
      v.weights = new Map();
      let norm = 0;
      for (const [key, row] of v.stats.rows) {
        const w = row.occurrences * Math.log(vectors.length / df.get(key) + 1);
        v.weights.set(key, w);
        norm += w * w;
      }
      v.norm = Math.sqrt(norm);
    }
    const together = new Map(this.cooccurrences().map(p => [`${p.a}|${p.b}`, p.passages]));
    const related = (x, y) => Codes.descendants(x).has(y) || Codes.descendants(y).has(x);
    const out = [];
    for (let i = 0; i < vectors.length; i++) {
      for (let j = i + 1; j < vectors.length; j++) {
        const x = vectors[i], y = vectors[j];
        if (related(x.code.id, y.code.id)) continue;
        const shared = [];
        let dot = 0;
        for (const [key, w] of x.weights) {
          const u = y.weights.get(key);
          if (u) {
            dot += w * u;
            shared.push([key, w * u]);
          }
        }
        const similarity = dot / (x.norm * y.norm);
        if (similarity < threshold) continue;
        const words = shared.sort((p, q) => q[1] - p[1]).slice(0, 5)
          .map(([key]) => this.label({ forms: mergeForms(x.stats.rows.get(key).forms, y.stats.rows.get(key).forms) }));
        const [a, b] = Codes.ordered([x.code.id, y.code.id]);
        out.push({ a, b, similarity, words, together: together.get(`${a}|${b}`) ?? 0 });
      }
    }
    return out.sort((p, q) => q.similarity - p.similarity).slice(0, limit);
  },
};

function mergeForms(...maps) {
  const out = new Map();
  for (const map of maps) for (const [form, n] of map) out.set(form, (out.get(form) ?? 0) + n);
  return out;
}

bus.on('project', () => {
  Analysis.cache.clear();
  Analysis.excludedSignature = null;
});
