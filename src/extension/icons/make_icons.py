"""Draws the extension icons (an M in Figtree on the Coding zone's pastel gradient) with headless Chromium.
Run from this folder: python3 make_icons.py"""

import asyncio, base64
from pathlib import Path
from playwright.async_api import async_playwright

HERE = Path(__file__).parent
FONT = base64.b64encode((HERE.parents[2] / 'vendor' / 'fonts' / 'figtree-latin-wght-normal.woff2').read_bytes()).decode()
PAGE = """<!doctype html><style>
@font-face {{ font-family: Figtree; font-weight: 300 900; src: url(data:font/woff2;base64,{font}) format('woff2'); }}
html, body {{ margin: 0; background: transparent; }}
div {{ width: {s}px; height: {s}px; border-radius: {r}px; background: linear-gradient(135deg, #c9b8f5, #f7c5d6);
  display: grid; place-items: center; font: 700 {f}px/1 Figtree; letter-spacing: -0.04em; color: #0d0d0d; }}
span {{ transform: translateY({dy}px); }}
</style><div><span>M</span></div>"""


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        for size in (16, 32, 48, 128):
            await page.set_viewport_size({'width': size, 'height': size})
            await page.set_content(PAGE.format(font=FONT, s=size, r=round(size * 0.24), f=round(size * 0.66), dy=round(size * 0.02, 2)))
            await page.evaluate('document.fonts.ready')
            await page.screenshot(path=str(HERE / f'icon-{size}.png'), omit_background=True)
            print('wrote', f'icon-{size}.png')
        await browser.close()

asyncio.run(main())
