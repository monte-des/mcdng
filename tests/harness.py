"""Shared test helpers. Tests run the built dist/MCdng.html in headless Chromium through Playwright.

The File System Access folder picker is replaced by the browser's private file system (OPFS), so a
project folder named "My review" lives inside the test browser and disappears when it closes.
"""

import asyncio, subprocess, sys, json, os, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = Path(__file__).resolve().parent / "fixtures"
SHOTS = Path(__file__).resolve().parent / "screenshots"
os.chdir(FIXTURES)
from playwright.async_api import async_playwright

MOCK = """
const opfsFolder = async name => (await navigator.storage.getDirectory()).getDirectoryHandle(name, { create: true });
window.showDirectoryPicker = () => opfsFolder('My review');

// Chromium 153 crashes when it reads an OPFS folder handle back from IndexedDB, so the mock stores
// a placeholder with the folder name and turns it back into a handle when it is read.
const { put, get } = IDBObjectStore.prototype;
IDBObjectStore.prototype.put = function (value, ...rest) {
  return put.call(this, value instanceof FileSystemDirectoryHandle ? { opfsFolder: value.name } : value, ...rest);
};
IDBObjectStore.prototype.get = function (...args) {
  const request = get.apply(this, args);
  const fake = { result: undefined, error: null, onsuccess: null, onerror: null };
  request.onsuccess = async () => {
    const value = request.result;
    fake.result = value?.opfsFolder ? await opfsFolder(value.opfsFolder) : value;
    fake.onsuccess?.();
  };
  request.onerror = () => { fake.error = request.error; fake.onerror?.(); };
  return fake;
};
"""
errors = []
server = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '-d', str(ROOT / 'dist')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
import atexit, time; atexit.register(server.terminate); time.sleep(0.8)
async def setup(p, width=1440, height=900, dark=False):
    b = await p.chromium.launch()
    ctx = await b.new_context(viewport={'width': width, 'height': height}, color_scheme='dark' if dark else 'light', accept_downloads=True)
    await ctx.add_init_script(MOCK)
    # Tests never reach Crossref or DataCite: by default MCdng sees no connection. test_metadata.py answers them.
    await ctx.route(re.compile(r'https://api\.(crossref|datacite)\.org/.*'), lambda route: route.abort('internetdisconnected'))
    pg = await ctx.new_page()
    pg.on('console', lambda m: m.type in ('error','warning') and errors.append(f'{m.type}: {m.text[:300]}'))
    pg.on('pageerror', lambda e: errors.append(f'PAGEERROR: {str(e)[:500]}'))
    await pg.goto('http://localhost:8765/MCdng.html')
    return b, pg

async def select_text(pg, root_sel, needle, occurrence=0):
    """Select a substring by searching [data-s] spans inside root and dispatching mouseup on reader host."""
    return await pg.evaluate("""([rootSel, needle, occ]) => {
      const root = document.querySelector(rootSel);
      const spans = [...root.querySelectorAll('[data-s]')];
      // build concatenated text of spans with node mapping
      let text = '', map = [], prevEnd = null;
      for (const s of spans) {
        const start = +s.dataset.s;
        if (prevEnd !== null && start > prevEnd) text += ' ';
        map.push([s.firstChild, text.length]); text += s.textContent.split(String.fromCharCode(10)).join(' '); prevEnd = start + s.textContent.length;
      }
      let idx = -1; for (let i=0;i<=occ;i++) idx = text.indexOf(needle, idx+1);
      if (idx < 0) return 'NOTFOUND';
      const loc = off => { let k = map.length-1; while (k>0 && map[k][1] > off) k--; return [map[k][0], off - map[k][1]]; };
      const r = document.createRange(); r.setStart(...loc(idx)); r.setEnd(...loc(idx+needle.length));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      const rect = r.getBoundingClientRect();
      document.querySelector('.reader-host').dispatchEvent(new MouseEvent('mouseup', {bubbles:true, button:0, clientX: rect.right, clientY: rect.bottom}));
      return 'OK';
    }""", [root_sel, needle, occurrence])


async def newproject(pg):
    await pg.click('text=New project')
    await pg.wait_for_selector('dialog .input'); await pg.fill('dialog .input', 'Inclusive education review'); await pg.keyboard.press('Enter')
    await pg.wait_for_selector('.view-documents:not([hidden])')
    await pg.set_input_files('.view-documents input[type=file]', ['smith2021.pdf','rossi2019.docx','notes_2020.txt'])
    await pg.wait_for_function("document.querySelectorAll('.doc-table tbody tr').length === 3", timeout=30000)
async def code(pg, needle, codes, occ=0, memo=None):
    r = await select_text(pg, '.reader-host', needle, occ); assert r == 'OK', (needle, r)
    await pg.wait_for_selector('.editor .input')
    for c in codes:
        await pg.fill('.editor input.input', c); await pg.keyboard.press('Enter')
    if memo: await pg.fill('.editor textarea', memo)
    await pg.keyboard.press('Control+Enter')
    await pg.wait_for_timeout(300)


TREE = """async()=>{const out=[]; const walk=async(d,p)=>{for await (const [n,h] of d.entries()){ if(h.kind==='directory') await walk(h,p+n+'/'); else out.push(p+n);}}; await walk(await (await navigator.storage.getDirectory()).getDirectoryHandle('My review'),''); return out.sort();}"""


def shot(name):
    return str(SHOTS / name)
