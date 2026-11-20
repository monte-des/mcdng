"""Builds the PDF fixtures for test_metadata.py with headless Chromium. Run from this folder:
python3 make_metadata_fixtures.py
"""

import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

HERE = Path(__file__).parent
BODY = ' '.join(['Inclusive education asks teachers to adapt instruction to a wide range of learner needs.'] * 12)

PAGE = """<!doctype html><html><head><meta charset="utf-8"><title>{stored}</title><style>
body {{ font: 10pt/1.45 Georgia, serif; margin: 0; }}
.journal {{ font-size: 8pt; color: #444; }}
h1 {{ font: 600 20pt/1.2 Georgia, serif; margin: 28pt 0 10pt; }}
.authors {{ font-size: 11pt; margin-bottom: 18pt; }}
.small {{ font-size: 8pt; color: #444; }}
.cover {{ page-break-after: always; font-size: 9pt; }}
</style></head><body>{cover}
<p class="journal">{journal}</p>
<h1>{title}</h1>
<p class="authors">{authors}</p>
<p><b>Abstract.</b> {body}</p>
<p>{body}</p>
<p class="small">{footer}</p>
</body></html>"""

FIXTURES = {
    # A publisher's article: junk stored title, DOI and copyright on the first page, meaningless file name.
    'manuscript_final_v3.pdf': dict(
        stored='PII: S0742-051X(20)30001-5', cover='',
        journal='Teaching and Teacher Education 96 (2020) 103145',
        title='Co-teaching and teacher self-efficacy in inclusive secondary schools',
        authors='Maria Rossi, Kim Lee',
        footer='https://doi.org/10.1016/j.tate.2020.103145 · © 2020 Elsevier Ltd. All rights reserved.'),
    # No DOI anywhere: only a title search can find it.
    'scan0042.pdf': dict(
        stored='', cover='',
        journal='International Journal of Inclusive Education',
        title='Principals as gatekeepers of inclusive practice: a qualitative study',
        authors='Ana Gomez',
        footer='Received 3 March 2019; accepted 9 July 2019'),
    # A cover sheet before the article, as Taylor & Francis and JSTOR add.
    'download.pdf': dict(
        stored='', cover='<div class="cover"><p>To cite this article: Gomez, A. (2019) Principals as gatekeepers.</p><p>Full Terms &amp; Conditions of access and use can be found online.</p></div>',
        journal='International Journal of Inclusive Education',
        title='Principals as gatekeepers of inclusive practice: a qualitative study',
        authors='Ana Gomez',
        footer='Received 3 March 2019; accepted 9 July 2019'),
}


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        for name, f in FIXTURES.items():
            await page.set_content(PAGE.format(body=BODY, **f))
            await page.pdf(path=str(HERE / name), format='A4', margin={'top': '20mm', 'bottom': '20mm', 'left': '20mm', 'right': '20mm'})
            print('wrote', name)
        await browser.close()

asyncio.run(main())
