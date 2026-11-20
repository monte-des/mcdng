// The two document readers. Both map DOM positions to offsets in content.text through elements that
// carry data-s (the offset of their first character), so codings are shared between the two views.
//
// A reader receives a context from the coding view:
//   ctx.doc, ctx.content
//   ctx.highlights()  [{ id, start, end, codes }] for segments to draw, codes already filtered and ordered
//   ctx.pending       { start, end } while a new selection waits in the editor, otherwise null;
//                     drawn as an overlay so the text underneath is never rebuilt mid-selection
//   ctx.onBarClick(segmentId, rect)

const HIGHLIGHT_ALPHA = { text: 0.3, page: 0.42 };
const PDF_OPTIONS = { isEvalSupported: false, verbosity: 0 };

// Splits overlapping highlights into non-overlapping atoms, each with the union of its codes.
function buildAtoms(items, pending) {
  const all = pending ? [...items, { ...pending, codes: [], pending: true }] : items;
  const points = [...new Set(all.flatMap(i => [i.start, i.end]))].sort((a, b) => a - b);
  const rank = Codes.rank();
  const atoms = [];
  for (let k = 0; k < points.length - 1; k++) {
    const start = points[k], end = points[k + 1];
    const codes = new Set();
    let isPending = false;
    for (const item of all) {
      if (item.start > start || item.end < end) continue;
      if (item.pending) isPending = true;
      else for (const c of item.codes) codes.add(c);
    }
    if (codes.size || isPending) atoms.push({ start, end, codes: Codes.ordered(codes, rank), pending: isPending });
  }
  return atoms;
}

function atomColors(atom) {
  return atom.codes.map(id => Codes.get(id).color);
}

// index: [{ node: Text, s: offset }] in document order. Returns a [node, offset] DOM point for a text offset.
function pointAt(index, offset, forStart) {
  const i = lastAtOrBefore(index, offset, x => x.s);
  if (i < 0) return index.length ? [index[0].node, 0] : null;
  const { node, s } = index[i];
  const local = offset - s;
  const next = index[i + 1];
  if (local < node.length || (local === node.length && !(forStart && next))) return [node, local];
  return forStart && next ? [next.node, 0] : [node, node.length];
}

// Maps a DOM selection boundary back to a text offset.
function offsetAtPoint(root, node, offset) {
  if (node.nodeType === Node.TEXT_NODE) {
    const owner = node.parentElement?.closest('[data-s]');
    if (owner && root.contains(owner)) return Number(owner.dataset.s) + Math.min(offset, node.length);
  }
  const spans = root.querySelectorAll('[data-s]');
  if (!spans.length) return 0;
  const probe = document.createRange();
  probe.setStart(node, offset);
  let lo = 0, hi = spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (probe.comparePoint(spans[mid], 0) < 0) lo = mid + 1; else hi = mid;
  }
  if (lo < spans.length) return Number(spans[lo].dataset.s);
  const last = spans[spans.length - 1];
  return Number(last.dataset.s) + last.textContent.length;
}

function selectionIn(root) {
  const sel = getSelection();
  if (!sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  return {
    start: offsetAtPoint(root, range.startContainer, range.startOffset),
    end: offsetAtPoint(root, range.endContainer, range.endOffset),
    collapsed: range.collapsed,
    rect: range.getBoundingClientRect(),
  };
}

// Margin bars: one per segment and code, packed into lanes so overlapping segments sit side by side.
const BAR_STEP = 6;

function drawBars(margin, bars, ctx) {
  const rank = Codes.rank();
  bars.sort((a, b) => a.top - b.top || (rank.get(a.code) ?? 0) - (rank.get(b.code) ?? 0));
  const lanes = [];
  for (const bar of bars) {
    let lane = lanes.findIndex(bottom => bottom < bar.top - 2);
    if (lane < 0) lane = lanes.push(0) - 1;
    lanes[lane] = bar.bottom;
    bar.lane = lane;
  }
  const width = margin.clientWidth - 10;
  const step = lanes.length * BAR_STEP > width ? width / lanes.length : BAR_STEP;
  margin.replaceChildren(...bars.map(bar => {
    const code = Codes.get(bar.code);
    return h('button', {
      type: 'button',
      class: 'bar',
      title: `${Codes.path(code)}: ${truncate(Segs.get(bar.seg).text, 90)}`,
      'aria-label': `Edit segment coded ${code.name}`,
      style: {
        top: `${bar.top}px`,
        height: `${Math.max(6, bar.bottom - bar.top)}px`,
        right: `${4 + bar.lane * step}px`,
        background: code.color,
      },
      onclick: event => ctx.onBarClick(bar.seg, event.currentTarget.getBoundingClientRect()),
    });
  }));
}

function flashNodes(nodes) {
  for (const node of nodes) {
    node.classList.remove('flash');
    void node.offsetWidth;
    node.classList.add('flash');
  }
  setTimeout(() => nodes.forEach(n => n.classList.remove('flash')), 1700);
}

// A highlighted segment lands a third of the way down; a restored reading position lands near the top.
function revealGap(host, flash) {
  return flash ? host.clientHeight / 3 : 16;
}

const BLOCK_TAGS = { h1: 'h2', h2: 'h3', h3: 'h4', h4: 'h5', li: 'p', p: 'p' };

class TextReader {
  constructor(ctx) {
    this.ctx = ctx;
    this.margin = h('div', { class: 'margin' });
    this.overlay = h('div', { class: 'pending-layer' });
    this.body = h('article', { class: `text-body${ctx.content.reflow ? ' reflow' : ''}` });
    this.root = h('div', { class: 'text-reader' }, this.margin, this.overlay, this.body);
    this.index = [];
    this.resizeObserver = new ResizeObserver(() => this.scheduleBars());
  }

  async mount(host) {
    this.host = host;
    host.replaceChildren(this.root);
    this.refresh();
    this.resizeObserver.observe(this.body);
  }

  refresh() {
    const { text, blocks, reflow } = this.ctx.content;
    const items = this.ctx.highlights();
    const atoms = buildAtoms(items);
    const show = reflow ? s => s.replace(/\n/g, ' ') : s => s;
    let j = 0;
    const piece = (start, end, atom) => {
      const span = h('span', { dataset: { s: start }, text: show(text.slice(start, end)) });
      if (atom) {
        span.className = 'hl';
        span.style.background = paint(atomColors(atom), HIGHLIGHT_ALPHA.text);
      }
      return span;
    };
    const elements = blocks.map(([start, end, type]) => {
      const el = h(BLOCK_TAGS[type] ?? 'p', { class: `block block-${type}` });
      while (atoms[j] && atoms[j].end <= start) j++;
      let pos = start;
      let k = j;
      while (pos < end) {
        const atom = atoms[k];
        if (!atom || atom.start >= end) {
          el.append(piece(pos, end));
          pos = end;
        } else if (atom.start > pos) {
          el.append(piece(pos, atom.start));
          pos = atom.start;
        } else {
          const stop = Math.min(atom.end, end);
          el.append(piece(pos, stop, atom));
          pos = stop;
          if (atom.end <= end) k++;
        }
      }
      return el;
    });
    this.body.replaceChildren(...elements);
    this.index = [...this.body.querySelectorAll('[data-s]')].map(el => ({ node: el.firstChild, s: Number(el.dataset.s) }));
    this.items = items;
    this.scheduleBars();
  }

  scheduleBars() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.drawBars());
  }

  drawBars() {
    const base = this.margin.getBoundingClientRect().top;
    const bars = [];
    for (const item of this.items) {
      const rect = this.range(item.start, item.end)?.getBoundingClientRect();
      if (!rect) continue;
      for (const code of item.codes) bars.push({ seg: item.id, code, top: rect.top - base, bottom: rect.bottom - base });
    }
    drawBars(this.margin, bars, this.ctx);
    this.setPending();
  }

  setPending() {
    const pending = this.ctx.pending;
    if (!pending) return this.overlay.replaceChildren();
    const base = this.root.getBoundingClientRect();
    const range = document.createRange();
    const rects = [];
    for (let i = Math.max(0, lastAtOrBefore(this.index, pending.start, x => x.s)); i < this.index.length && this.index[i].s < pending.end; i++) {
      const { node, s } = this.index[i];
      if (s + node.length <= pending.start) continue;
      range.setStart(node, Math.max(0, pending.start - s));
      range.setEnd(node, Math.min(node.length, pending.end - s));
      for (const r of range.getClientRects()) {
        rects.push(h('div', {
          class: 'pending-rect',
          style: { left: `${r.left - base.left}px`, top: `${r.top - base.top}px`, width: `${r.width}px`, height: `${r.height}px` },
        }));
      }
    }
    this.overlay.replaceChildren(...rects);
  }

  range(start, end) {
    const a = pointAt(this.index, start, true);
    const b = pointAt(this.index, end, false);
    if (!a || !b) return null;
    const range = document.createRange();
    range.setStart(...a);
    range.setEnd(...b);
    return range;
  }

  // Scrolls a range into view; target is a segment or any { start, end }.
  async reveal(target, { flash = true } = {}) {
    const rect = this.range(target.start, target.end)?.getBoundingClientRect();
    if (!rect) return;
    const hostRect = this.host.getBoundingClientRect();
    this.host.scrollTo({ top: this.host.scrollTop + rect.top - hostRect.top - revealGap(this.host, flash), behavior: flash ? 'smooth' : 'instant' });
    if (!flash) return;
    flashNodes([...this.body.querySelectorAll('[data-s]')].filter(el => {
      const s = Number(el.dataset.s);
      return s >= target.start && s < target.end;
    }));
  }

  destroy() {
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.frame);
  }
}

const ZOOM_LEVELS = [0.75, 1, 1.25, 1.5, 2];

function zoomControl(onChange) {
  const select = h('select', {
    class: 'input zoom', 'aria-label': 'Zoom',
    onchange: () => onChange(select.value === 'fit' ? 'fit' : Number(select.value)),
  }, h('option', { value: 'fit', text: 'Fit width' }), ZOOM_LEVELS.map(z => h('option', { value: z, text: `${z * 100}%` })));
  return select;
}

class PageReader {
  constructor(ctx, zoom = 'fit') {
    this.ctx = ctx;
    this.zoom = zoom;
    this.scale = 0;
    this.pages = [];
    this.items = [];
    this.generation = 0;
    this.root = h('div', { class: 'page-reader' });
    this.measure = document.createElement('canvas').getContext('2d');
    this.root.addEventListener('mousedown', event => event.target.closest('.text-layer')?.classList.add('selecting'));
    this.endSelecting = () => this.root.querySelectorAll('.selecting').forEach(el => el.classList.remove('selecting'));
    document.addEventListener('mouseup', this.endSelecting);
  }

  async mount(host) {
    this.host = host;
    host.replaceChildren(this.root);
    await Library.idle();
    const bytes = await Disk.readBytes(Library.sourcePath(this.ctx.doc));
    this.pdf = await pdfjsLib.getDocument({ ...PDF_OPTIONS, data: bytes }).promise;
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) this.renderPage(this.pages[Number(entry.target.dataset.page)]);
    }, { root: host, rootMargin: '1200px 0px' });
    this.resizeObserver = new ResizeObserver(debounce(() => {
      if (this.zoom === 'fit' && Math.abs(this.fitScale() - this.scale) > 0.01) this.layout();
    }, 150));
    this.resizeObserver.observe(host);
    this.items = this.ctx.highlights();
    this.layout();
  }

  fitScale() {
    const widest = Math.max(...this.ctx.content.pages.map(p => p.w));
    const available = this.host.clientWidth - 112;
    return Math.min(3, Math.max(0.5, available / widest));
  }

  setZoom(zoom) {
    this.zoom = zoom;
    this.layout();
  }

  // Rebuilds page placeholders at the current scale, keeping the reading position.
  layout() {
    const anchor = this.anchor();
    this.generation++;
    this.observer.disconnect();
    this.scale = this.zoom === 'fit' ? this.fitScale() : this.zoom;
    this.pages = this.ctx.content.pages.map((info, i) => {
      const page = h('div', { class: 'page', dataset: { page: i }, style: { width: `${info.w * this.scale}px`, height: `${info.h * this.scale}px` } });
      const margin = h('div', { class: 'margin' });
      return { i, info, page, margin, row: h('div', { class: 'page-row' }, margin, page), state: null, index: [] };
    });
    this.root.replaceChildren(...this.pages.map(p => p.row));
    for (const p of this.pages) this.observer.observe(p.page);
    if (anchor) {
      const row = this.pages[anchor.i].row.getBoundingClientRect();
      this.host.scrollTop += row.top - this.host.getBoundingClientRect().top + anchor.fraction * row.height;
    }
  }

  anchor() {
    const top = this.host.getBoundingClientRect().top;
    for (const p of this.pages) {
      const rect = p.row.getBoundingClientRect();
      if (rect.bottom > top) return { i: p.i, fraction: Math.max(0, (top - rect.top) / rect.height) };
    }
    return null;
  }

  renderPage(p) {
    if (p.ready) return p.ready;
    const generation = this.generation;
    p.ready = (async () => {
      const page = await this.pdf.getPage(p.i + 1);
      if (generation !== this.generation) return;
      const viewport = page.getViewport({ scale: this.scale });
      const ratio = devicePixelRatio || 1;
      const canvas = h('canvas', { width: Math.floor(viewport.width * ratio), height: Math.floor(viewport.height * ratio) });
      await page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      }).promise;
      if (generation !== this.generation) return;
      p.hl = h('div', { class: 'hl-layer' });
      p.page.replaceChildren(canvas, p.hl, this.textLayer(p, viewport));
      p.state = 'done';
      this.paintPage(p);
    })();
    return p.ready;
  }

  // Rebuilds pdf.js text items as transparent, selectable spans laid exactly over the canvas glyphs.
  textLayer(p, viewport) {
    const layer = h('div', { class: 'text-layer' });
    const text = this.ctx.content.text;
    let font = '';
    p.index = p.info.items.map(([s, length, a, b, c, d, e, f, width, ascentRatio]) => {
      const str = text.substr(s, length);
      const tx = pdfjsLib.Util.transform(viewport.transform, [a, b, c, d, e, f]);
      const angle = Math.atan2(tx[1], tx[0]);
      const size = Math.hypot(tx[2], tx[3]);
      const ascent = size * ascentRatio;
      const span = h('span', { dataset: { s }, text: str });
      span.style.left = `${angle ? tx[4] + ascent * Math.sin(angle) : tx[4]}px`;
      span.style.top = `${angle ? tx[5] - ascent * Math.cos(angle) : tx[5] - ascent}px`;
      if (font !== `${size}px sans-serif`) this.measure.font = font = `${size}px sans-serif`;
      const measured = this.measure.measureText(str).width;
      const ratio = measured > 0 && width > 0 ? (width * this.scale) / measured : 1;
      // Chrome can lose drag selections over text squeezed with scaleX below 1, so narrow spans get a
      // smaller font stretched back vertically instead. Both keep the span exactly over the glyphs.
      const transforms = angle ? [`rotate(${angle}rad)`] : [];
      if (ratio < 1) {
        span.style.fontSize = `${size * ratio}px`;
        transforms.push(`scaleY(${1 / ratio})`);
      } else {
        span.style.fontSize = `${size}px`;
        if (ratio > 1) transforms.push(`scaleX(${ratio})`);
      }
      if (transforms.length) span.style.transform = transforms.join(' ');
      layer.append(span);
      return { node: span.firstChild, s };
    });
    layer.append(h('div', { class: 'end-of-content' }));
    return layer;
  }

  refresh() {
    this.items = this.ctx.highlights();
    this.setPending();
  }

  setPending() {
    for (const p of this.pages) this.paintPage(p);
  }

  paintPage(p) {
    if (p.state !== 'done') return;
    const { start, end } = p.info;
    const onPage = this.items.filter(item => item.start < end && item.end > start);
    const pending = this.ctx.pending && this.ctx.pending.start < end && this.ctx.pending.end > start ? this.ctx.pending : null;
    const rects = [];
    for (const atom of buildAtoms(onPage, pending)) {
      const background = atom.codes.length ? paint(atomColors(atom), HIGHLIGHT_ALPHA.page) : '';
      for (const r of this.rects(p, atom.start, atom.end)) {
        rects.push(h('div', {
          class: atom.pending ? 'hl-rect pending' : 'hl-rect',
          style: { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, background },
        }));
      }
    }
    p.hl.replaceChildren(...rects);
    const bars = [];
    for (const item of onPage) {
      const boxes = this.rects(p, item.start, item.end);
      if (!boxes.length) continue;
      const top = Math.min(...boxes.map(r => r.y));
      const bottom = Math.max(...boxes.map(r => r.y + r.h));
      for (const code of item.codes) bars.push({ seg: item.id, code, top, bottom });
    }
    drawBars(p.margin, bars, this.ctx);
  }

  // Page-relative rectangles covering text offsets [a, b) on a rendered page.
  rects(p, a, b) {
    const base = p.page.getBoundingClientRect();
    const items = p.info.items;
    const range = document.createRange();
    const out = [];
    for (let i = Math.max(0, lastAtOrBefore(items, a, it => it[0])); i < items.length && items[i][0] < b; i++) {
      const [s, length] = items[i];
      if (s + length <= a) continue;
      const node = p.index[i].node;
      range.setStart(node, Math.max(0, a - s));
      range.setEnd(node, Math.min(length, b - s));
      for (const r of range.getClientRects()) out.push({ x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
    }
    return out;
  }

  async reveal(target, { flash = true } = {}) {
    const i = Math.max(0, lastAtOrBefore(this.pages, target.start, p => p.info.start));
    const p = this.pages[i];
    await this.renderPage(p);
    if (p.state !== 'done') return;
    const boxes = this.rects(p, target.start, target.end);
    const offset = boxes.length ? Math.min(...boxes.map(r => r.y)) : 0;
    const hostRect = this.host.getBoundingClientRect();
    const pageRect = p.page.getBoundingClientRect();
    this.host.scrollTo({ top: this.host.scrollTop + pageRect.top - hostRect.top + offset - revealGap(this.host, flash), behavior: flash ? 'smooth' : 'instant' });
    if (!flash) return;
    const marks = this.pages.filter(q => q.state === 'done' && q.info.start < target.end && q.info.end > target.start).flatMap(q =>
      this.rects(q, target.start, target.end).map(r => q.hl.appendChild(h('div', {
        class: 'hl-rect mark',
        style: { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` },
      }))));
    flashNodes(marks);
    setTimeout(() => marks.forEach(m => m.remove()), 1700);
  }

  destroy() {
    this.generation++;
    this.observer?.disconnect();
    this.resizeObserver?.disconnect();
    document.removeEventListener('mouseup', this.endSelecting);
    this.pdf?.destroy();
  }
}
