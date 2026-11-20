"""Draws the Home Screen icons of the web app: the M of the extension icon on the Coding zone's gradient, full
bleed and opaque, because iPadOS rounds the corners itself and turns transparency black.
Run from this folder: python3 make_icons.py"""

import asyncio, base64
from pathlib import Path
from playwright.async_api import async_playwright

HERE = Path(__file__).parent
FONT = base64.b64encode((HERE.parents[2] / 'vendor' / 'fonts' / 'figtree-latin-wght-normal.woff2').read_bytes()).decode()
PAGE = """<!doctype html><style>
@font-face {{ font-family: Figtree; font-weight: 300 900; src: url(data:font/woff2;base64,{font}) format('woff2'); }}
html, body {{ margin: 0; }}
div {{ width: {s}px; height: {s}px; background: linear-gradient(135deg, #c9b8f5, #f7c5d6);
  display: grid; place-items: center; font: 700 {f}px/1 Figtree; letter-spacing: -0.04em; color: #0d0d0d; }}
span {{ transform: translateY({dy}px); }}
</style><div><span>M</span></div>"""


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        for size in (180, 192, 512):
            await page.set_viewport_size({'width': size, 'height': size})
            # The letter stays inside the middle 60%, the safe zone of maskable icons.
            await page.set_content(PAGE.format(font=FONT, s=size, f=round(size * 0.5), dy=round(size * 0.015, 2)))
            await page.evaluate('document.fonts.ready')
            await page.screenshot(path=str(HERE / f'icon-{size}.png'))
            print('wrote', f'icon-{size}.png')
        await browser.close()

asyncio.run(main())
