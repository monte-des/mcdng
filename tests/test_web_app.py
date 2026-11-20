"""The web app for the Home Screen (dist/web): the manifest and icons, and the service worker that keeps MCdng
opening without a connection, in an iPad-sized touch window."""

import asyncio, json
from harness import *

URL = 'http://localhost:8765/web/'


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1080, 'height': 810}, has_touch=True)
        await ctx.add_init_script("globalThis.MCDNG_CLIENT_ID = 'test-client';")
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(f'PAGEERROR: {str(e)[:500]}'))
        await pg.goto(URL)
        manifest = await pg.evaluate("fetch('manifest.webmanifest').then(r => r.json())")
        print('manifest:', manifest['name'], manifest['display'], [i['src'] for i in manifest['icons']])
        heads = await pg.eval_on_selector_all('link[rel=apple-touch-icon], meta[name^=apple]', 'els => els.map(e => e.outerHTML)')
        print('head:', heads)
        await pg.wait_for_function("navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(() => true)", timeout=10000)
        await pg.reload()
        await pg.wait_for_function("!!navigator.serviceWorker.controller", timeout=10000)
        cached = await pg.evaluate("caches.keys()")
        print('caches:', cached)

        # Without a connection, the page and its icon still open, from the cache.
        await ctx.set_offline(True)
        await pg.goto(URL + '?storage=drive#from-home-screen')
        await pg.wait_for_selector('.start-title')
        icon = await pg.evaluate("fetch('icons/icon-180.png').then(r => r.status)")
        start = await pg.eval_on_selector_all('.start-actions button', 'bs => bs.map(b => b.textContent)')
        print('offline:', await pg.inner_text('.start-title'), start, '| icon', icon)
        assert start == ['Open from Google Drive', 'New project on Google Drive'] and icon == 200
        print('ERRORS', errors)
        await b.close()

asyncio.run(main())
