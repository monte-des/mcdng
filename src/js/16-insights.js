// Insights: the themes emerging from the coding, how they spread across papers and connect, and the
// keywords of the coded segments. Every table exports to CSV, and the page prints or saves as PDF.

const SHOWN_TERMS = 200;
const SHOWN_PAIRS = 15;

const INSIGHT_TABS = [['overview', 'Overview'], ['keywords', 'Keywords']];

function keywordDefaults() {
  return { kind: 'words', codeId: '', subcodes: true, rank: 'frequency', query: '' };
}

const fmtNumber = n => n.toLocaleString('en-GB');
const fmtShare = x => `${Math.round(x * 100)}%`;
const fmtScore = x => (x == null ? '' : x.toFixed(1));

function levelName(depth) {
  return project.framework.levels[depth]?.name || `Level ${depth + 1}`;
}

function themeCell(code) {
  return h('span', { class: 'theme-name' }, swatch(code.color), h('span', { text: Codes.path(code) }));
}

async function exportTable(title, filename, header, rows) {
  const options = await chooseCsvOptions(title, { layouts: false });
  if (options) download(`${fileSlug(project.name)}-${filename}-${today()}.csv`, toCSV(header, rows, options.delimiter), 'text/csv;charset=utf-8');
}

class InsightsView extends View {
  constructor() {
    super('insights', ['documents', 'codes', 'segments', 'framework', 'keywords']);
    this.tab = 'overview';
    this.kw = keywordDefaults();
    this.tabs = h('nav', { class: 'segmented', 'aria-label': 'Insights sections' });
    this.body = h('div', { class: 'insights-body' });
    this.printHead = h('div', { class: 'print-head' });
    this.el.append(
      h('header', { class: 'view-header' },
        h('h1', { class: 'view-title', text: 'Insights' }),
        this.tabs,
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn', text: 'Print or save as PDF', onclick: () => this.print() })),
      this.printHead,
      this.body);
    bus.on('project', () => {
      this.tab = 'overview';
      this.kw = keywordDefaults();
    });
  }

  update() {
    this.renderTabs();
    if (!Analysis.coded().length) {
      this.body.replaceChildren(emptyState('Nothing coded yet', 'Themes and keywords appear here as soon as you code segments.',
        h('button', { type: 'button', class: 'btn primary', text: 'Start coding', onclick: () => App.go('coding') })));
      return;
    }
    if (this.tab === 'overview') this.renderOverview();
    else this.renderKeywords();
  }

  switchTab(tab) {
    if (tab === this.tab) return;
    this.tab = tab;
    this.body.scrollTop = 0;
    this.update();
  }

  renderTabs() {
    this.tabs.replaceChildren(...INSIGHT_TABS.map(([key, label]) => h('button', {
      type: 'button', text: label,
      class: this.tab === key ? 'active' : '',
      'aria-pressed': String(this.tab === key),
      onclick: () => this.switchTab(key),
    })));
  }

  // Opens the keywords of one theme, ranked by how typical they are of it.
  showThemeKeywords(codeId) {
    Object.assign(this.kw, { codeId, subcodes: true, rank: 'distinctiveness', query: '' });
    this.switchTab('keywords');
  }

  print() {
    const tab = INSIGHT_TABS.find(([key]) => key === this.tab)[1];
    const scope = this.tab === 'keywords' ? ` · ${TERM_KINDS[this.kw.kind]}, ${this.kw.codeId ? Codes.path(Codes.get(this.kw.codeId)) : 'all coded segments'}` : '';
    this.printHead.replaceChildren(
      h('p', { class: 'print-title', text: `${project.name}: ${tab}${scope}` }),
      h('p', { class: 'print-meta', text: `MCdng, ${fmtDate(nowISO(), false)}` }));
    window.print();
  }

  section(title, description, onExport, content) {
    return h('section', { class: 'insight' },
      h('header', { class: 'insight-head' },
        h('div', { class: 'insight-heading' },
          h('h2', { class: 'insight-title', text: title }),
          h('p', { class: 'insight-text', text: description })),
        onExport && h('button', { type: 'button', class: 'btn small', text: 'Export CSV', onclick: onExport })),
      content);
  }

  // Overview

  renderOverview() {
    const themes = Analysis.themes();
    const docs = Docs.sorted();
    const pairs = Analysis.cooccurrences();
    const similar = Analysis.similarities();
    this.body.replaceChildren(h('div', { class: 'insights-page' },
      this.section('Themes', 'How often each theme is coded, in how many papers, and the words most typical of its segments. Counts include subcodes.',
        () => this.exportThemes(themes, docs), this.themesTable(themes, docs)),
      this.section('Themes across papers', 'Coded segments of each theme in each paper. Empty cells show where a theme has not been coded yet.',
        () => this.exportMatrix(themes, docs), this.matrix(themes, docs)),
      this.section('Themes coded together', 'Pairs of codes applied to the same passage, on one segment or on overlapping segments.',
        pairs.length ? () => this.exportPairs(pairs) : null, this.pairsTable(pairs)),
      this.section('Themes with similar vocabulary', 'Pairs of codes whose segments use similar words, even if they were never coded together: candidates to compare, merge or link.',
        similar.length ? () => this.exportSimilar(similar) : null, this.similarTable(similar))));
  }

  themesTable(themes, docs) {
    const used = themes.filter(t => t.segments.length);
    if (!used.length) return h('p', { class: 'insight-empty', text: 'No active code has segments yet.' });
    return h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
      h('thead', null, h('tr', null,
        h('th', { text: 'Theme' }), h('th', { text: 'Level' }), h('th', { text: 'Analytical dimension' }),
        h('th', { class: 'num', text: 'Segments' }), h('th', { class: 'num', text: 'Papers' }),
        h('th', { text: 'Share of coded segments' }), h('th', { text: 'Typical words' }))),
      h('tbody', null, themes.map(t => h('tr', { class: t.segments.length ? '' : 'is-empty' },
        h('td', { style: { paddingLeft: `${16 + t.depth * 18}px` } },
          h('button', { type: 'button', class: 'link-btn', title: 'See the keywords of this theme', onclick: () => this.showThemeKeywords(t.code.id) },
            swatch(t.code.color), h('span', { text: t.code.name }))),
        h('td', { class: 'muted', text: levelName(t.depth) }),
        h('td', { class: 'muted', text: Codes.dimensionName(t.code.dimensionId) || '—' }),
        h('td', { class: 'num' }, t.segments.length
          ? h('button', { type: 'button', class: 'link-btn', title: 'Review these segments', text: fmtNumber(t.segments.length), onclick: () => { App.views.review.showCode(t.code.id); App.go('review'); } })
          : '0'),
        h('td', { class: 'num' }, `${t.byDoc.size} `, h('span', { class: 'muted', text: `of ${docs.length}` })),
        h('td', null, h('span', { class: 'meter' }, h('span', { class: 'meter-fill', style: { width: fmtShare(t.share) } }), h('span', { class: 'meter-value', text: fmtShare(t.share) }))),
        h('td', { class: 'muted words', text: t.words.join(', ') || '—' }))))));
  }

  matrix(themes, docs) {
    const used = themes.filter(t => t.segments.length);
    if (!used.length) return h('p', { class: 'insight-empty', text: 'No active code has segments yet.' });
    const max = Math.max(...used.flatMap(t => [...t.byDoc.values()]));
    const coded = Analysis.coded();
    const perDoc = new Map(docs.map(d => [d.id, coded.filter(s => s.docId === d.id).length]));
    return h('div', { class: 'table-wrap' }, h('table', { class: 'data-table matrix' },
      h('thead', null, h('tr', null,
        h('th', { class: 'sticky-col', text: 'Theme' }),
        docs.map(d => h('th', { class: 'num doc-col', title: d.title, text: Docs.citation(d) })),
        h('th', { class: 'num', text: 'Total' }))),
      h('tbody', null, used.map(t => h('tr', null,
        h('td', { class: 'sticky-col', style: { paddingLeft: `${16 + t.depth * 18}px` } }, h('span', { class: 'theme-name' }, swatch(t.code.color), h('span', { text: t.code.name }))),
        docs.map(d => {
          const n = t.byDoc.get(d.id) ?? 0;
          return h('td', { class: `num heat${n ? '' : ' zero'}`, style: { '--p': (n / max).toFixed(3) }, text: n ? fmtNumber(n) : '', title: `${t.code.name} in ${Docs.citation(d)}: ${plural(n, 'segment')}` });
        }),
        h('td', { class: 'num total', text: fmtNumber(t.segments.length) })))),
      h('tfoot', null, h('tr', null,
        h('th', { class: 'sticky-col', text: 'Coded segments' }),
        docs.map(d => h('td', { class: 'num', text: fmtNumber(perDoc.get(d.id)) })),
        h('td', { class: 'num total', text: fmtNumber(coded.length) })))));
  }

  pairsTable(pairs) {
    if (!pairs.length) return h('p', { class: 'insight-empty', text: 'No passage carries two codes yet. Pairs appear when a segment has more than one code or two segments overlap.' });
    return [
      h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
        h('thead', null, h('tr', null, h('th', { text: 'Theme' }), h('th', { text: 'Coded with' }), h('th', { class: 'num', text: 'Passages' }), h('th', { class: 'num', text: 'Papers' }))),
        h('tbody', null, pairs.slice(0, SHOWN_PAIRS).map(p => h('tr', null,
          h('td', null, themeCell(Codes.get(p.a))),
          h('td', null, themeCell(Codes.get(p.b))),
          h('td', { class: 'num', text: fmtNumber(p.passages) }),
          h('td', { class: 'num', text: fmtNumber(p.docs.size) })))))),
      pairs.length > SHOWN_PAIRS && h('p', { class: 'insight-note', text: `The ${SHOWN_PAIRS} most frequent of ${pairs.length} pairs. The CSV export has them all.` }),
    ];
  }

  similarTable(similar) {
    if (!similar.length) return h('p', { class: 'insight-empty', text: 'No two themes share enough vocabulary yet. The comparison needs at least two codes with segments.' });
    return h('div', { class: 'table-wrap' }, h('table', { class: 'data-table' },
      h('thead', null, h('tr', null,
        h('th', { text: 'Theme' }), h('th', { text: 'Similar to' }),
        h('th', { class: 'num', text: 'Similarity', title: 'Cosine similarity of the two themes’ word profiles, from 0 (no shared words) to 1 (the same words in the same proportions)' }),
        h('th', { text: 'Shared words' }), h('th', { class: 'num', text: 'Coded together' }))),
      h('tbody', null, similar.map(p => h('tr', null,
        h('td', null, themeCell(Codes.get(p.a))),
        h('td', null, themeCell(Codes.get(p.b))),
        h('td', { class: 'num', text: p.similarity.toFixed(2) }),
        h('td', { class: 'muted words', text: p.words.join(', ') }),
        h('td', { class: 'num', text: p.together ? plural(p.together, 'passage') : '—' }))))));
  }

  exportThemes(themes, docs) {
    exportTable('Export themes', 'themes',
      ['code_path', 'level', 'analytical_dimension', 'origin', 'segments', 'documents', 'documents_total', 'share_percent', 'typical_words'],
      themes.map(t => [Codes.path(t.code), levelName(t.depth), Codes.dimensionName(t.code.dimensionId), ORIGIN_LABELS[t.code.origin] ?? '',
        t.segments.length, t.byDoc.size, docs.length, Math.round(t.share * 1000) / 10, t.words.join('; ')]));
  }

  exportMatrix(themes, docs) {
    exportTable('Export themes across papers', 'themes-by-paper',
      ['code_path', ...docs.map(d => Docs.citation(d)), 'total'],
      themes.filter(t => t.segments.length).map(t => [Codes.path(t.code), ...docs.map(d => t.byDoc.get(d.id) ?? 0), t.segments.length]));
  }

  exportPairs(pairs) {
    exportTable('Export themes coded together', 'themes-coded-together', ['code_a', 'code_b', 'passages', 'documents'],
      pairs.map(p => [Codes.path(Codes.get(p.a)), Codes.path(Codes.get(p.b)), p.passages, p.docs.size]));
  }

  exportSimilar(similar) {
    exportTable('Export themes with similar vocabulary', 'themes-similar-vocabulary', ['code_a', 'code_b', 'similarity', 'shared_words', 'passages_coded_together'],
      similar.map(p => [Codes.path(Codes.get(p.a)), Codes.path(Codes.get(p.b)), p.similarity.toFixed(3), p.words.join('; '), p.together]));
  }

  // Keywords

  renderKeywords() {
    const k = this.kw;
    if (k.codeId && !Codes.isActive(k.codeId)) Object.assign(k, { codeId: '', rank: 'frequency' });
    const segmented = (label, options, current, onPick, disabled) => h('div', { class: 'segmented', role: 'group', 'aria-label': label },
      options.map(([value, text, title]) => h('button', {
        type: 'button', text, title,
        class: current === value ? 'active' : '',
        'aria-pressed': String(current === value),
        disabled: disabled?.(value),
        onclick: () => onPick(value),
      })));
    this.kwTable = h('div', { class: 'keyword-results' });
    const excludedCount = project.keywords.excluded.length;
    this.body.replaceChildren(h('div', { class: 'insights-page' },
      h('div', { class: 'keyword-tools' },
        h('select', {
          class: 'input scope', 'aria-label': 'Segments to analyse',
          onchange: event => {
            k.codeId = event.target.value;
            k.rank = k.codeId ? 'distinctiveness' : 'frequency';
            this.renderKeywords();
          },
        },
        h('option', { value: '', text: 'All coded segments' }),
        Codes.tree().map(({ code, depth }) => h('option', { value: code.id, text: `${' '.repeat(depth)}${code.name}`, selected: code.id === k.codeId }))),
        k.codeId && h('label', { class: 'check plain' },
          h('input', { type: 'checkbox', checked: k.subcodes, onchange: event => { k.subcodes = event.target.checked; this.renderKeywordTable(); } }),
          h('span', { class: 'check-label', text: 'Include subcodes' })),
        segmented('Kind of term', Object.entries(TERM_KINDS), k.kind, kind => { k.kind = kind; this.renderKeywords(); }),
        segmented('Rank terms by', [
          ['frequency', 'Most frequent'],
          ['distinctiveness', 'Most distinctive', 'Terms more typical of this theme than of the other coded segments'],
        ], k.rank, rank => { k.rank = rank; this.renderKeywords(); }, value => value === 'distinctiveness' && !k.codeId),
        h('input', {
          class: 'input search', type: 'search', placeholder: 'Find a term', 'aria-label': 'Find a term', value: k.query,
          oninput: event => { k.query = event.target.value; this.renderKeywordTable(); },
        }),
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn', text: excludedCount ? `Excluded words (${excludedCount})` : 'Excluded words', onclick: () => this.editExcluded() }),
        h('button', { type: 'button', class: 'btn', text: 'Export CSV', onclick: () => this.exportKeywords() })),
      this.kwTable));
    this.renderKeywordTable();
  }

  keywordData() {
    const k = this.kw;
    const data = Analysis.keywordRows(k);
    const query = k.query.trim().toLowerCase();
    let rows = data.rows;
    if (query) rows = rows.filter(row => [...row.forms.keys()].some(form => form.includes(query)));
    const byFrequency = (a, b) => b.occurrences - a.occurrences || b.segments - a.segments || byText(a.label, b.label);
    rows.sort(k.rank === 'distinctiveness' && data.hasScores ? (a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || byFrequency(a, b) : byFrequency);
    return { ...data, rows };
  }

  renderKeywordTable() {
    const k = this.kw;
    const data = this.keywordData();
    const kindWord = k.kind === 'words' ? 'distinct word' : 'phrase';
    const summary = h('p', { class: 'keyword-summary' },
      `${fmtNumber(data.total)} words in ${plural(data.segments.length, 'segment')}, ${plural(data.rows.length, kindWord)}`,
      k.kind === 'phrases' && ` occurring at least ${PHRASE_MIN} times`, '.',
      data.hasScores && h('span', { class: 'muted', text: ' Distinctiveness compares this theme with all other coded segments: above 2, a term is clearly typical of the theme; below 0, it is more typical of the others.' }));
    if (!data.rows.length) {
      this.kwTable.replaceChildren(summary, h('p', { class: 'insight-empty', text: k.query ? 'No term matches this search.' : `No ${k.kind === 'words' ? 'words' : 'repeated phrases'} in these segments yet.` }));
      return;
    }
    const max = Math.max(...data.rows.map(r => r.occurrences));
    const shown = data.rows.slice(0, SHOWN_TERMS);
    const review = row => {
      App.views.review.showTerm({ kind: k.kind, key: row.key, label: row.label }, k.codeId || null, k.subcodes);
      App.go('review');
    };
    this.kwTable.replaceChildren();
    append(this.kwTable, [summary,
      h('div', { class: 'table-wrap' }, h('table', { class: 'data-table keywords' },
        h('thead', null, h('tr', null,
          h('th', { text: k.kind === 'words' ? 'Word' : 'Phrase' }),
          h('th', { text: 'Occurrences' }),
          h('th', { class: 'num', text: 'Segments' }),
          h('th', { class: 'num', text: 'Papers' }),
          data.hasScores && h('th', { class: 'num', text: 'Distinctiveness', title: 'Weighted log-odds z-score against all other coded segments' }),
          h('th', { class: 'action-col' }, h('span', { class: 'visually-hidden', text: 'Actions' })))),
        h('tbody', null, shown.map(row => {
          const variants = Analysis.forms(row).slice(1, 5);
          return h('tr', null,
            h('td', null,
              h('span', { class: 'term-label', text: row.label }),
              variants.length ? h('span', { class: 'term-variants', text: variants.join(', ') }) : null),
            h('td', null, h('span', { class: 'meter' }, h('span', { class: 'meter-fill', style: { width: `${(row.occurrences / max) * 100}%` } }), h('span', { class: 'meter-value', text: fmtNumber(row.occurrences) }))),
            h('td', { class: 'num' }, h('button', { type: 'button', class: 'link-btn', title: 'Review the segments with this term', text: fmtNumber(row.segments), onclick: () => review(row) })),
            h('td', { class: 'num', text: fmtNumber(row.docs.size) }),
            data.hasScores && h('td', { class: `num${row.score > 0 ? '' : ' muted'}`, text: fmtScore(row.score) }),
            h('td', { class: 'action-col' }, h('button', {
              type: 'button', class: 'btn subtle small', text: 'Exclude', title: `Leave “${row.label}” out of keyword counts`,
              onclick: () => {
                Actions.setExcludedTerms([...project.keywords.excluded, row.label]);
                Toast.show(`“${row.label}” is excluded from keyword counts. Excluded words lists every exclusion.`);
              },
            })));
        })))),
      data.rows.length > SHOWN_TERMS && h('p', { class: 'insight-note', text: `The first ${SHOWN_TERMS} of ${fmtNumber(data.rows.length)} terms. The CSV export has them all.` })]);
  }

  async editExcluded() {
    const area = h('textarea', { class: 'input', rows: 9, value: project.keywords.excluded.join('\n'), 'aria-label': 'Excluded words and phrases' });
    const result = await Dialog.open({
      title: 'Excluded words',
      body: [h('p', { text: 'One word or phrase per line, left out of every keyword count. Variants go with them: “teacher” also excludes “teachers”.' }), area],
      buttons: [
        { label: 'Cancel', result: null },
        { label: 'Save', kind: 'primary', submit: true, value: () => area.value },
      ],
      initialFocus: area,
    });
    if (result != null) Actions.setExcludedTerms(result.split('\n'));
  }

  exportKeywords() {
    const k = this.kw;
    const data = this.keywordData();
    if (!data.rows.length) return Toast.show('There are no terms to export.');
    const scope = k.codeId ? fileSlug(Codes.get(k.codeId).name) : 'all';
    exportTable(`Export ${k.kind}`, `keywords-${k.kind}-${scope}`,
      ['term', 'variants', 'occurrences', 'segments', 'documents', ...(data.hasScores ? ['distinctiveness'] : [])],
      data.rows.map(row => [row.label, Analysis.forms(row).slice(1).join('; '), row.occurrences, row.segments, row.docs.size, ...(data.hasScores ? [row.score == null ? '' : row.score.toFixed(2)] : [])]));
  }
}
