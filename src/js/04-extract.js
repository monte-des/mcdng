// Turns an imported file into the canonical content every view works with:
//   text    one string; coded segments are [start, end) offsets into it
//   blocks  [start, end, type] paragraphs and headings for the text view
//   pages   PDF only: page size and text items mapped to offsets, for the layout view
//   reflow  PDF only: single line breaks are layout, not meaning, so the text view joins them
// and reads the bibliographic details the file itself carries (see fileMetadata in 05-metadata.js).

const Extract = {
  async pdf(bytes) {
    const pdf = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
    try {
      const builder = new PdfTextBuilder();
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const viewport = page.getViewport({ scale: 1 });
        builder.addPage(viewport, await page.getTextContent());
        page.cleanup();
      }
      const { info = {}, metadata = null } = (await pdf.getMetadata().catch(() => null)) ?? {};
      const content = builder.finish();
      return { content, meta: pdfMetadata(info, metadata, content), pages: pdf.numPages };
    } finally {
      await pdf.destroy();
    }
  },

  async docx(bytes) {
    let zip;
    try {
      zip = await Zip.read(new Blob([bytes]));
    } catch {
      throw new Error('This file is not a valid Word document.');
    }
    if (!zip.has('word/document.xml')) throw new Error('This file is not a valid Word document.');
    const xml = async name => new DOMParser().parseFromString(new TextDecoder().decode(zip.get(name)), 'application/xml');
    const styles = zip.has('word/styles.xml') ? docxStyleNames(await xml('word/styles.xml')) : new Map();
    const paragraphs = docxParagraphs(await xml('word/document.xml'), styles);
    const meta = {};
    if (zip.has('docProps/core.xml')) {
      const core = await xml('docProps/core.xml');
      meta.title = usefulTitle(core.getElementsByTagNameNS(NS.dc, 'title')[0]?.textContent);
      meta.authors = core.getElementsByTagNameNS(NS.dc, 'creator')[0]?.textContent.trim() ?? '';
    }
    return { content: joinBlocks(paragraphs), meta, pages: null };
  },

  async txt(bytes) {
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder('windows-1252').decode(bytes);
    }
    const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)
      .map(p => p.replace(/^\n+|\s+$/g, ''))
      .filter(p => p.trim())
      .map(p => ({ type: 'p', text: p }));
    return { content: joinBlocks(paragraphs), meta: {}, pages: null };
  },
};

// Titles that tools write into files by themselves: "Microsoft Word - draft.docx", "PII: S0742-…", "untitled".
const JUNK_TITLE = /^(untitled|microsoft (word|powerpoint)|document\d*$|pii:|doi:|layout|title$|\W*$)|\.(docx?|pdf|tex|indd|qxd)\b|^[\w-]+_\d|^[a-z]{1,6}\d{3,}/i;

function usefulTitle(title) {
  const t = (title ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 8 && /\s/.test(t) && !JUNK_TITLE.test(t) ? t : '';
}

const first = value => (Array.isArray(value) ? value[0] : value) ?? '';

// What a PDF says about itself: XMP metadata, the document information dictionary and its first page.
function pdfMetadata(info, xmp, content) {
  const get = name => xmp?.get?.(name) ?? null;
  const meta = {};
  const printed = layoutTitle(content);
  const stored = usefulTitle(first(get('dc:title'))) || usefulTitle(info.Title);
  // The printed title wins when the stored one names something else, as stored titles often do.
  meta.title = printed && (!stored || titleSimilarity(stored, printed) < 0.5) ? printed : stored || printed;
  const creators = get('dc:creator');
  meta.authors = Array.isArray(creators) && creators.length
    ? creators.map(personName).filter(Boolean).join('; ')
    : (typeof creators === 'string' ? creators : info.Author ?? '').trim();
  meta.journal = first(get('prism:publicationName')).trim();
  meta.volume = first(get('prism:volume')).trim();
  meta.issue = first(get('prism:number')).trim();
  const year = text => /(?<!\d)(19|20)\d{2}(?!\d)/.exec(text ?? '')?.[0] ?? '';
  meta.year = year(first(get('prism:coverDate'))) || year(first(get('prism:publicationDate')));
  meta.doi = findDoi([first(get('prism:doi')), first(get('dc:identifier')), info.Subject, info.Keywords].filter(Boolean).join(' '));
  // Elsevier and others describe the article in the subject: "Teaching and Teacher Education, 103 (2021) 103245. doi:…"
  const cite = /^([^,]{4,120}),\s*(\d+)\s*\(((?:19|20)\d{2})\)/.exec(info.Subject ?? '');
  if (cite) {
    meta.journal ||= cite[1].trim();
    meta.volume ||= cite[2];
    meta.year ||= cite[3];
  }
  const head = content.text.slice(0, content.pages?.[1]?.end ?? 6000);
  meta.year ||= year(/©\s*((?:19|20)\d{2})/.exec(head)?.[1]) || year(/(?:published|available)\s+online[^\n]{0,40}?((?:19|20)\d{2})/i.exec(head)?.[1]);
  return meta;
}

// "Jane Marie Smith" → "Smith, J. M."; names already written "Smith, Jane" keep their order.
function personName(name) {
  const n = String(name).replace(/\s+/g, ' ').trim();
  if (!n) return '';
  if (n.includes(',')) {
    const [family, given] = n.split(',', 2).map(s => s.trim());
    return given ? `${family}, ${initials(given)}` : family;
  }
  const parts = n.split(' ');
  return parts.length > 1 ? `${parts.pop()}, ${initials(parts.join(' '))}` : n;
}

function initials(given) {
  return given.split(/\s+/).filter(Boolean)
    .map(word => word.split('-').map(part => (/^\p{L}\.?$/u.test(part) ? part.replace(/\.?$/, '.') : `${part[0]}.`)).join('-'))
    .join(' ');
}

// Words of a title, for comparing two titles regardless of case, punctuation and markup.
function titleWords(title) {
  return (title ?? '').toLowerCase().replace(/<[^>]+>/g, ' ').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').match(/[\p{L}\p{N}]+/gu) ?? [];
}

// Dice coefficient of the two titles' word sets: 1 for the same words, 0 for none in common.
function titleSimilarity(a, b) {
  const x = new Set(titleWords(a)), y = new Set(titleWords(b));
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return (2 * shared) / (x.size + y.size);
}

// Pages that publishers and archives put before the article itself.
const COVER_PAGE = /to cite this article|full terms & conditions|jstor is a not-for-profit|this article was downloaded by|downloaded from https?:\/\//i;
const NOT_A_TITLE = /journal|volume|vol\.|issn|doi|https?:|www\.|©|copyright|received|accepted|abstract|article info|keywords|contents lists|available online|elsevier|springer|wiley|taylor & francis|sage|original (article|research)|research article|review article/i;

// The printed title: the largest type in the upper part of the first page of the article.
function layoutTitle(content) {
  if (!content.pages?.length) return '';
  const index = content.pages.length > 1 && COVER_PAGE.test(content.text.slice(content.pages[0].start, content.pages[0].end)) ? 1 : 0;
  const page = content.pages[index];
  const lines = [];
  for (const [start, length, , , c, d, , y] of page.items) {
    const text = content.text.slice(start, start + length);
    if (!/\p{L}/u.test(text) || y < page.h * 0.3) continue;
    const size = Math.round(Math.hypot(c, d) * 10) / 10;
    const line = lines.find(l => Math.abs(l.y - y) < size * 0.4 && Math.abs(l.size - size) < size * 0.08);
    if (line) {
      line.start = Math.min(line.start, start);
      line.end = Math.max(line.end, start + length);
    } else {
      lines.push({ y, size, start, end: start + length });
    }
  }
  // Consecutive lines in the same size form one block; a title runs over one to four lines.
  lines.sort((a, b) => b.y - a.y);
  const blocks = [];
  for (const line of lines) {
    const text = content.text.slice(line.start, line.end).replace(/\s+/g, ' ').trim();
    const last = blocks.at(-1);
    if (last && Math.abs(last.size - line.size) < line.size * 0.08 && last.y - line.y < line.size * 2.2 && last.lines < 4) {
      last.text = last.text.endsWith('-') ? last.text.slice(0, -1) + text : `${last.text} ${text}`;
      last.y = line.y;
      last.lines++;
    } else {
      blocks.push({ size: line.size, y: line.y, text, lines: 1 });
    }
  }
  const candidates = blocks.filter(b => b.text.length >= 12 && b.text.length <= 300 && b.text.split(' ').length >= 3 && !NOT_A_TITLE.test(b.text));
  if (!candidates.length) return '';
  const best = candidates.reduce((a, b) => (b.size > a.size ? b : a));
  // Body text is not a title: the title's type must stand out from the page's usual size.
  const sizes = lines.map(l => l.size).sort((a, b) => a - b);
  const usual = sizes[Math.floor(sizes.length / 2)];
  return best.size >= usual * 1.25 ? best.text : '';
}

function joinBlocks(paragraphs) {
  let text = '';
  const blocks = [];
  for (const p of paragraphs) {
    if (text) text += '\n\n';
    blocks.push([text.length, text.length + p.text.length, p.type]);
    text += p.text;
  }
  return { text, blocks };
}

// PDF text: items are joined with spaces, line breaks or paragraph breaks inferred from their geometry.
// Each item keeps [start, length, transform(6), width, ascent] so the layout view can rebuild a selectable text layer.

class PdfTextBuilder {
  constructor() {
    this.text = '';
    this.pages = [];
  }

  addPage(viewport, textContent) {
    if (this.text) this.text += '\n\n';
    const page = { w: round(viewport.width), h: round(viewport.height), start: this.text.length, end: 0, items: [] };
    let prev = null;
    for (const item of textContent.items) {
      if (!item.str) {
        if (item.hasEOL && prev) prev.hasEOL = true;
        continue;
      }
      if (prev) this.text += this.separator(prev, item);
      const style = textContent.styles[item.fontName] ?? {};
      const ascent = style.ascent || (style.descent ? 1 + style.descent : 0.8);
      page.items.push([this.text.length, item.str.length, ...item.transform.map(round), round(item.width), round(ascent, 3)]);
      this.text += item.str;
      prev = { ...item, hasEOL: item.hasEOL };
    }
    page.end = this.text.length;
    this.pages.push(page);
  }

  separator(prev, item) {
    const size = Math.hypot(item.transform[2], item.transform[3]) || 10;
    const prevSize = Math.hypot(prev.transform[2], prev.transform[3]) || size;
    const dy = prev.transform[5] - item.transform[5];
    const sameLine = !prev.hasEOL && Math.abs(dy) < Math.min(size, prevSize) * 0.5;
    if (sameLine) {
      const gap = item.transform[4] - (prev.transform[4] + prev.width);
      const spaced = /\s$/.test(prev.str) || /^\s/.test(item.str);
      return !spaced && gap > size * 0.15 ? ' ' : '';
    }
    if (/[a-z]-$/i.test(prev.str) && /^[a-z]/.test(item.str) && dy > 0 && dy < prevSize * 1.8) return '';
    const paragraph = dy < 0 || dy > Math.max(size, prevSize) * 1.75;
    return paragraph ? '\n\n' : '\n';
  }

  finish() {
    const text = this.text;
    const blocks = [];
    const re = /\n\n/g;
    let start = 0;
    for (let m = re.exec(text); ; m = re.exec(text)) {
      const end = m ? m.index : text.length;
      if (text.slice(start, end).trim()) blocks.push([start, end, 'p']);
      if (!m) break;
      start = m.index + 2;
    }
    return { text, blocks, pages: this.pages, reflow: true };
  }
}

function round(n, digits = 2) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

// DOCX: a zip archive with WordprocessingML inside. Headings come from style names, lists from numbering.

const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  dc: 'http://purl.org/dc/elements/1.1/',
};

function docxStyleNames(doc) {
  const names = new Map();
  for (const style of doc.getElementsByTagNameNS(NS.w, 'style')) {
    const name = style.getElementsByTagNameNS(NS.w, 'name')[0]?.getAttributeNS(NS.w, 'val') ?? '';
    names.set(style.getAttributeNS(NS.w, 'styleId'), name.toLowerCase());
  }
  return names;
}

function docxParagraphs(doc, styles) {
  const out = [];
  const inFallback = node => {
    for (let a = node.parentNode; a && a.nodeType === Node.ELEMENT_NODE; a = a.parentNode) if (a.localName === 'Fallback') return true;
    return false;
  };
  for (const p of doc.getElementsByTagNameNS(NS.w, 'p')) {
    if (inFallback(p)) continue;
    let text = '';
    // Paragraphs nested in text boxes are visited on their own, so the outer walk skips them.
    const walker = doc.createTreeWalker(p, NodeFilter.SHOW_ELEMENT, {
      acceptNode: node => (node.localName === 'p' && node.namespaceURI === NS.w ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.namespaceURI !== NS.w) continue;
      if (node.localName === 't') text += node.textContent;
      else if (node.localName === 'tab') text += '\t';
      else if (node.localName === 'br' || node.localName === 'cr') text += '\n';
      else if (node.localName === 'noBreakHyphen') text += '-';
    }
    text = text.replace(/\s+$/, '').replace(/^\s+/, '');
    if (!text) continue;
    const pPr = [...p.children].find(c => c.localName === 'pPr');
    const styleId = pPr && [...pPr.children].find(c => c.localName === 'pStyle')?.getAttributeNS(NS.w, 'val');
    const styleName = styles.get(styleId) ?? '';
    const heading = /^heading (\d)/.exec(styleName);
    const isList = /^list/.test(styleName) || (pPr && [...pPr.children].some(c => c.localName === 'numPr'));
    const type = styleName === 'title' ? 'h1'
      : heading ? `h${Math.min(Number(heading[1]) + 1, 4)}`
      : isList ? 'li' : 'p';
    out.push({ type, text });
  }
  return out;
}
