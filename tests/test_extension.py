"""The browser extension: MCdng as an extension page, and Save to MCdng from an article page or a PDF.
Pages are served from tests/fixtures on localhost:8766, standing in for a publisher's site. Like IEEE Xplore,
the site also serves a PDF at an address without .pdf (/stampPDF/getPDF.jsp) and a page that shows it in an
iframe (/stamp/stamp.jsp). It also stands in for journals whose article page is an e-reader: Open Journal
Systems (a pdf.js reader in an iframe whose address names the PDF in file=), a reader that holds a PDF no link
leads to (PDFViewerApplication), and a page whose only way to the PDF is a "Download PDF" link."""

import asyncio, functools, http.server, json, tempfile, threading
from harness import *

EXT = ROOT / 'dist' / 'extension'
SITE = 'http://localhost:8766'


class Publisher(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, body, kind):
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith('/stampPDF/getPDF.jsp'):
            name = 'long_2018.pdf' if 'arnumber=1' in self.path else 'smith2021.pdf'
            return self.send((FIXTURES / name).read_bytes(), 'application/pdf')
        if self.path.startswith('/stamp/stamp.jsp'):
            page = '<!doctype html><title>IEEE Xplore Full-Text PDF:</title><body style="margin:0">' \
                   '<iframe src="/stampPDF/getPDF.jsp?tp=&arnumber=2&ref=" style="width:100%;height:100vh;border:0"></iframe>'
            return self.send(page.encode(), 'text/html; charset=utf-8')
        if self.path.startswith('/ojs/article/view/'):
            page = ('<!doctype html><title>Article view</title><header><a href="/ojs/article/view/1">Back</a></header>'
                    '<iframe src="/ojs/plugins/generic/pdfJsViewer/pdf.js/web/viewer.html?file=%2Fojs%2Farticle%2Fdownload%2F5933%2F2131%2F12345"></iframe>')
            return self.send(page.encode(), 'text/html; charset=utf-8')
        if self.path.startswith('/ojs/plugins/'):
            return self.send(b'<!doctype html><title>PDF.js viewer</title><div id="viewer"></div>', 'text/html; charset=utf-8')
        if self.path.startswith('/ojs/article/download/'):
            # Another paper: the 30-page fixture with a comment after its end, so it is not a duplicate.
            return self.send((FIXTURES / 'long_2018.pdf').read_bytes() + b'\n% served by the journal\n', 'application/octet-stream')
        if self.path.startswith('/reader/book'):
            return self.send(b'<!doctype html><title>Reader</title><iframe src="/reader/frame.html"></iframe>', 'text/html; charset=utf-8')
        if self.path.startswith('/reader/frame.html'):
            # A reader holding a PDF that no address of the page leads to.
            script = ('<script>fetch("/reader/content.bin").then(r => r.arrayBuffer()).then(b => {'
                      'const bytes = new Uint8Array(b); globalThis.PDFViewerApplication = { url: "blob:reader", '
                      'pdfDocument: { getData: async () => bytes } }; });</script>')
            return self.send(f'<!doctype html><title>Frame</title>{script}'.encode(), 'text/html; charset=utf-8')
        if self.path.startswith('/reader/content.bin'):
            return self.send((FIXTURES / 'download.pdf').read_bytes(), 'application/octet-stream')
        if self.path.startswith('/landing/'):
            page = '<!doctype html><title>Landing</title><p>Abstract.</p><a class="btn" href="/files/getfile?id=7">Download PDF</a>'
            return self.send(page.encode(), 'text/html; charset=utf-8')
        if self.path.startswith('/files/getfile'):
            return self.send((FIXTURES / 'scan0042.pdf').read_bytes(), 'application/octet-stream')
        return super().do_GET()


server = http.server.ThreadingHTTPServer(('localhost', 8766), functools.partial(Publisher, directory=str(FIXTURES)))
threading.Thread(target=server.serve_forever, daemon=True).start()


async def project_docs(pg):
    data = await pg.evaluate("""async()=>{const d=await (await navigator.storage.getDirectory()).getDirectoryHandle('My review'); return JSON.parse(await (await (await d.getFileHandle('project.json')).getFile()).text())}""")
    return data['documents']


async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(tempfile.mkdtemp(), channel='chromium', headless=True,
            args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'], viewport={'width': 1440, 'height': 900})
        await ctx.add_init_script(MOCK)
        await ctx.route(re.compile(r'https://api\.(crossref|datacite)\.org/.*'), lambda route: route.abort('internetdisconnected'))
        sw = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker')
        ext_id = sw.url.split('/')[2]
        print('extension loaded:', ext_id)

        async def save(url):
            tab = await ctx.new_page()
            try:
                await tab.goto(url)
            except Exception as err:
                print('   could not open', url, str(err).splitlines()[0])
            tab_id = await sw.evaluate("async u => (await chrome.tabs.query({ url: u }))[0]?.id", url)
            result = await sw.evaluate("id => saveTab(id).catch(err => ({ state: 'error', error: err.message }))", tab_id)
            await tab.close()
            return result

        app = await ctx.new_page()
        app.on('pageerror', lambda e: errors.append(f'PAGEERROR: {e}'))
        app.on('console', lambda m: m.type == 'error' and 'ERR_INTERNET_DISCONNECTED' not in m.text and errors.append(m.text[:200]))
        await app.goto(f'chrome-extension://{ext_id}/app.html')
        await app.click('text=New project')
        await app.wait_for_selector('dialog .input'); await app.fill('dialog .input', 'Extension review'); await app.keyboard.press('Enter')
        await app.wait_for_selector('.view-documents:not([hidden])')
        print('app runs as an extension page:', await app.title())

        # From an article page: the PDF linked by the publisher, with the publisher's details.
        print('article page:', await save(f'{SITE}/article.html'))
        await app.wait_for_function("document.querySelectorAll('.doc-table tbody tr').length === 1", timeout=20000)
        await app.wait_for_timeout(1200)
        doc = (await project_docs(app))[0]
        print('  ', doc['meta']['source'], '|', doc['authors'], '|', doc['year'], '|', doc['title'], '|', doc['journal'], doc['volume'], doc['articlePages'], '|', doc['doi'], '|', doc['folder'])
        assert doc['meta']['source'] == 'publisher' and doc['authors'] == 'Rossi, M.; Lee, K.' and doc['year'] == '2020' and doc['articlePages'] == '103145'

        # The same article again is recognised by its DOI.
        print('same article again:', await save(f'{SITE}/article.html'))

        # A page without a PDF.
        print('page without a PDF:', await save(f'{SITE}/nopdf.html'))

        # A PDF opened directly: details come from the file.
        result = await save(f'{SITE}/scan0042.pdf')
        print('PDF tab:', result)
        if result['state'] == 'saved':
            await app.wait_for_timeout(1200)
            print('  ', [d['title'] for d in await project_docs(app)])

        # A PDF whose address does not end in .pdf, opened in the browser's viewer.
        result = await save(f'{SITE}/stampPDF/getPDF.jsp?tp=&arnumber=1&ref=')
        print('PDF at an address without .pdf:', result)
        assert result['state'] == 'saved', result

        # A page that shows the PDF in an iframe, as IEEE Xplore does.
        result = await save(f'{SITE}/stamp/stamp.jsp?tp=&arnumber=2')
        print('PDF inside the page:', result)
        assert result['state'] == 'saved', result

        # E-readers: Open Journal Systems, a reader holding its PDF, a page with only a Download PDF link.
        for label, url in [('Open Journal Systems reader', f'{SITE}/ojs/article/view/5933/2131'),
                           ('reader holding the PDF', f'{SITE}/reader/book/1'),
                           ('Download PDF link', f'{SITE}/landing/7')]:
            result = await save(url)
            print(f'{label}:', result)
            assert result['state'] == 'saved', result
        await app.wait_for_timeout(1200)
        titles = [d['title'] for d in await project_docs(app)]
        print('  ', titles)
        await app.screenshot(path=shot('s37-extension-app.png'))

        # With no project open, the paper waits and is offered when a project opens.
        await app.click('.project-button'); await app.click('dialog >> text=Close project'); await app.wait_for_selector('.start-panel')
        result = await save(f'{SITE}/download.pdf')
        print('no project open:', result)
        await app.click('text=Reopen'); await app.wait_for_selector('dialog >> text=waiting', timeout=20000)
        print('offered:', (await app.inner_text('dialog')).replace('\n', ' | '))
        await app.screenshot(path=shot('s38-extension-waiting.png'))
        await app.click('dialog .btn.primary'); await app.wait_for_timeout(1500)
        print('after adding:', len(await project_docs(app)), 'documents')

        popup = await ctx.new_page()
        await popup.set_viewport_size({'width': 320, 'height': 200})
        await popup.goto(f'chrome-extension://{ext_id}/popup.html'); await popup.wait_for_timeout(500)
        print('popup:', (await popup.inner_text('main')).replace('\n', ' | '))
        await popup.screenshot(path=shot('s39-extension-popup.png'))
        print('ERRORS', errors)
        await ctx.close()

asyncio.run(main())
