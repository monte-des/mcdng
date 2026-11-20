// Utilities shared by every module.

// MCdng runs on Safari 15 and later (iPadOS 15): the two newer built-ins it uses are filled in where missing
// (both arrived in Safari 15.4). Its code has no regular expressions with lookbehind, which Safari reads only
// from 16.4: one in the app's code stops the whole page there.
if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, 'at', {
    value(index) {
      const i = Math.trunc(index) || 0;
      return this[i < 0 ? this.length + i : i];
    },
    configurable: true,
    writable: true,
  });
}
globalThis.structuredClone ??= value => JSON.parse(JSON.stringify(value));

// The first year from 1900 to 2099 in a text, not part of a longer number; '' when there is none.
function yearIn(text) {
  return /(?:^|\D)((?:19|20)\d{2})(?!\d)/.exec(text ?? '')?.[1] ?? '';
}

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key === 'style' && typeof value === 'object') {
        for (const [prop, v] of Object.entries(value)) {
          if (prop.startsWith('--')) el.style.setProperty(prop, v); else el.style[prop] = v;
        }
      }
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else if (key in el) el[key] = value;
      else el.setAttribute(key, value === true ? '' : value);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function uid() {
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), b => ID_CHARS[b % 36]).join('');
}

const nowISO = () => new Date().toISOString();

const DATE_TIME = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const DATE_ONLY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function fmtDate(iso, withTime = true) {
  return iso ? (withTime ? DATE_TIME : DATE_ONLY).format(new Date(iso)) : '';
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function plural(n, word, wordPlural = `${word}s`) {
  return `${n} ${n === 1 ? word : wordPlural}`;
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const byText = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base', numeric: true });

function sameJSON(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Colors

const CODE_PALETTE = [
  '#E5484D', '#0090FF', '#46A758', '#F76B15', '#8E4EC6', '#12A594',
  '#D6409F', '#FFB224', '#3E63DD', '#AD7F58', '#29A383', '#E54666',
  '#5EB1EF', '#7D66D9', '#99D52A', '#00A2C7', '#FF8DCC', '#978365',
];

function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// One color fills the span; several colors become diagonal stripes of equal width.
function paint(colors, alpha) {
  if (colors.length === 1) return rgba(colors[0], alpha);
  const band = 5;
  const stops = colors.map((c, i) => `${rgba(c, alpha)} ${i * band}px ${(i + 1) * band}px`);
  return `repeating-linear-gradient(135deg, ${stops.join(', ')})`;
}

// Text

function trimRange(text, start, end) {
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return [start, end];
}

// Binary search: index of the last element whose key is <= value, or -1.
function lastAtOrBefore(list, value, key) {
  let lo = 0, hi = list.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(list[mid]) <= value) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

// CSV

function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(s) && Number.isNaN(Number(s))) s = ` ${s}`;
  return /[",;\r\n\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCSV(header, rows, delimiter) {
  return '\uFEFF' + [header, ...rows].map(row => row.map(csvCell).join(delimiter)).join('\r\n');
}

// Saves a file made by MCdng. On a touch screen (iPad) the share sheet saves it to Files or Drive, or sends it,
// since a download link is unreliable in a Home Screen app; elsewhere, or when sharing is refused, a download.
async function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const file = typeof File === 'function' && new File([blob], filename, { type });
  if (touchFirst() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Whether the main input is a finger or a pen (iPad), rather than a mouse or trackpad.
function touchFirst() {
  return matchMedia('(pointer: coarse)').matches;
}
