import asyncio, csv, io
from harness import *


async def export(pg, layout):
    await pg.click('.view-review .btn >> text=Export CSV')
    await pg.click(f'dialog >> text={layout}'); await pg.click('dialog >> text=Comma')
    async with pg.expect_download() as dl:
        await pg.click('dialog .btn.primary')
    d = await dl.value
    await d.save_as(SHOTS / d.suggested_filename)
    rows = list(csv.reader(io.StringIO((await d.path()).read_text(encoding='utf-8-sig'))))
    print(f'== {layout}: {d.suggested_filename}')
    for row in rows:
        print('  ', ' | '.join(cell[:40] for cell in row))
    return rows


async def main():
    async with async_playwright() as p:
        b, pg = await setup(p)
        await newproject(pg)
        # Framework level names become part of the level column names
        await pg.click('.nav >> text=Codebook'); await pg.click('.view-codebook .segmented >> text=Framework')
        await pg.click('text=Add level'); await pg.fill('.list-row >> nth=0 >> input >> nth=0', 'Theme')
        await pg.click('text=Add level'); await pg.fill('.list-row >> nth=1 >> input >> nth=0', 'Category')
        await pg.click('text=Save framework'); await pg.wait_for_timeout(200)
        await pg.click('.nav >> text=Coding')
        await pg.select_option('.doc-picker', label=await pg.evaluate("[...document.querySelectorAll('.doc-picker option')].find(o=>o.text.startsWith('Rossi')).text"))
        await pg.wait_for_selector('.text-body .block')
        await code(pg, 'time constraints and limited resources', ['Barriers'])
        await code(pg, 'Support from school leadership', ['Collaboration'])
        # Co-planning as a subcode of Collaboration, then a segment with a subcode and a top-level code
        await pg.click('.nav >> text=Codebook'); await pg.click('.view-codebook .segmented >> text=Codes')
        await pg.click('.cb-code >> text=Collaboration'); await pg.click('text=New subcode')
        await pg.fill('.cb-detail input >> nth=0', 'Co-planning'); await pg.click('text=Create code'); await pg.wait_for_timeout(200)
        await pg.click('.nav >> text=Coding')
        await code(pg, 'Professional development is often described as fragmented', ['Co-planning', 'Barriers'], memo='Fragmentation, see also Smith')
        await pg.click('.nav >> text=Review'); await pg.wait_for_timeout(300)

        rows = await export(pg, 'One row per segment and code')
        head = rows[0]
        assert head[head.index('code'):head.index('text')] == ['code', 'code_path', 'level_1_theme', 'level_2_category', 'code_level', 'analytical_dimension', 'origin'], head
        coplanning = next(r for r in rows if r[head.index('code')] == 'Co-planning')
        assert coplanning[head.index('level_1_theme')] == 'Collaboration' and coplanning[head.index('level_2_category')] == 'Co-planning' and coplanning[head.index('code_level')] == '2'
        assert len(rows) == 1 + 4, 'one row per segment and code'

        rows = await export(pg, 'One row per segment')
        head = rows[0]
        assert head[:10] == ['segment_id', 'document', 'authors', 'year', 'title', 'journal', 'volume', 'issue', 'article_pages', 'doi'] and head[-4:] == ['text', 'memo', 'created', 'modified']
        mixed = next(r for r in rows if r[head.index('code_count')] == '2')
        assert mixed[head.index('level_1_theme')] == 'Barriers; Collaboration' and mixed[head.index('level_2_category')] == 'Co-planning', mixed
        assert mixed[head.index('memo')] == 'Fragmentation, see also Smith'

        rows = await export(pg, 'Code matrix')
        head = rows[0]
        assert head[head.index('page') + 1:head.index('text')] == ['Barriers', 'Collaboration', 'Collaboration › Co-planning'], head
        mixed = next(r for r in rows if r[head.index('Collaboration › Co-planning')] == '1')
        assert mixed[head.index('Collaboration')] == '1' and mixed[head.index('Barriers')] == '1'

        # The choice is remembered after a reload
        await pg.reload(); await pg.click('text=Reopen'); await pg.wait_for_selector('.view-coding:not([hidden])')
        await pg.click('.nav >> text=Review'); await pg.click('.view-review .btn >> text=Export CSV')
        print('remembered layout:', await pg.eval_on_selector('dialog input[name=layout]:checked', 'i => i.value'))
        await pg.screenshot(path=shot('s33-export-dialog.png'))
        print('ERRORS', errors)
        await b.close()

asyncio.run(main())
