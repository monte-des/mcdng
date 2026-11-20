"""Custom document fields of the three types: text, options (Q1, Q2, Q3, SB) and coloured tags. Ticking in the
detail panel, the table chips, search, the Review filter, the CSV column, and removing an option. Also the hint
under Parent code when a new project has coding levels but no codes yet."""

import asyncio, csv, io
from harness import *

PROJECT = """async()=>{const d=await (await navigator.storage.getDirectory()).getDirectoryHandle('My review'); return JSON.parse(await (await (await d.getFileHandle('project.json')).getFile()).text())}"""


async def saved(pg):
    await pg.wait_for_timeout(900)
    return await pg.evaluate(PROJECT)


def values(data, title_start, field_name):
    field = next(f for f in data['fields'] if f['name'] == field_name)
    doc = next(d for d in data['documents'] if d['title'].startswith(title_start) or d['file']['name'].startswith(title_start))
    names = {o['id']: o['name'] for o in field['options']}
    return [names[i] for i in doc['fields'].get(field['id'], [])]


async def open_doc(pg, file_start):
    await pg.click('.nav >> text=Documents')
    rows = pg.locator('.doc-table tbody tr')
    for i in range(await rows.count()):
        await rows.nth(i).click()
        if file_start in await pg.inner_text('.doc-detail .detail-meta >> nth=0'):
            return
    raise AssertionError(file_start)


async def main():
    async with async_playwright() as p:
        b, pg = await setup(p)
        await newproject(pg)

        # Coding levels but no codes yet: the parent list is empty, and the hint says how to reach level 2.
        await pg.click('.nav >> text=Codebook'); await pg.click('.view-codebook .segmented >> text=Framework')
        await pg.click('text=Add level'); await pg.fill('.list-row >> nth=0 >> input >> nth=0', '01. Broader topic')
        await pg.click('text=Add level'); await pg.fill('.list-row >> nth=1 >> input >> nth=0', '02. Aspects')
        await pg.click('text=Save framework'); await pg.wait_for_timeout(200)
        await pg.click('.view-codebook .segmented >> text=Codes'); await pg.click('.view-codebook .btn.primary >> text=New code')
        hint = await pg.inner_text('.cb-detail .field:has-text("Parent code") .field-hint')
        print('parent hint, no codes:', hint)
        assert '02. Aspects' in hint and 'New subcode' in hint
        await pg.fill('.cb-detail input >> nth=0', 'Generative AI'); await pg.click('text=Create code'); await pg.wait_for_timeout(200)
        await pg.click('.view-codebook .btn.primary >> text=New code')
        options = await pg.eval_on_selector_all('.cb-detail select >> nth=0 >> option', 'os => os.map(o => o.text.trim())')
        hint = await pg.inner_text('.cb-detail .field:has-text("Parent code") .field-hint')
        print('parent options with one code:', options, '| hint:', hint)
        assert options == ['None, top-level code', 'Generative AI'] and 'New subcode' not in hint
        await pg.select_option('.cb-detail select >> nth=0', label='Generative AI')
        print('   level with a parent:', await pg.inner_text('.cb-detail .field:has-text("Parent code") .field-hint'))
        await pg.click('.cb-detail .btn.subtle >> text=Cancel')

        # Define the fields: an options field with four options at once, and a tags field.
        await open_doc(pg, 'smith2021')
        await pg.click('text=Edit document fields')
        await pg.fill('dialog .field-new .input', 'Research question'); await pg.click('dialog .field-new >> text=Options'); await pg.click('dialog >> text=Add field')
        focused = await pg.evaluate("document.activeElement.dataset.field && document.activeElement.placeholder")
        print('new options field focuses its option box:', focused)
        await pg.keyboard.type('Q1, Q2, Q3, SB'); await pg.keyboard.press('Enter')
        await pg.fill('dialog .field-new .input', 'Tags'); await pg.click('dialog .field-new >> text=Tags'); await pg.click('dialog >> text=Add field')
        await pg.keyboard.type('method, review'); await pg.keyboard.press('Enter')
        await pg.fill('dialog .field-new .input', 'Country'); await pg.click('dialog .field-new >> text=Text'); await pg.click('dialog >> text=Add field')
        # The same name twice in one field adds nothing.
        await pg.fill('dialog input[data-field] >> nth=0', 'q1'); await pg.keyboard.press('Enter')
        await pg.screenshot(path=shot('s40-document-fields-dialog.png'))
        data = await saved(pg)
        print('fields:', [(f['name'], f['type'], [o['name'] for o in f['options']]) for f in data['fields']])
        assert [o['name'] for o in data['fields'][0]['options']] == ['Q1', 'Q2', 'Q3', 'SB']
        assert all(o['color'] for o in data['fields'][1]['options']) and not data['fields'][0]['options'][0]['color']
        await pg.click('dialog >> text=Done')

        # Tick Q1 and SB, a tag, and add a new tag from the panel.
        await pg.click('.doc-detail .toggles >> text=Q1'); await pg.click('.doc-detail .toggles >> text=SB')
        await pg.click('.doc-detail .tag-toggle >> text=review')
        await pg.fill('.doc-detail .tag-new', 'to reread'); await pg.keyboard.press('Enter')
        refocused = await pg.evaluate("document.activeElement.classList.contains('tag-new')")
        await pg.keyboard.type('review'); await pg.keyboard.press('Enter')  # an existing tag: ticked, not duplicated
        await pg.fill('.doc-detail .field:has-text("Country") .input', 'Italy'); await pg.keyboard.press('Tab')
        pressed = await pg.eval_on_selector_all('.doc-detail [aria-pressed="true"]', 'bs => bs.map(b => b.textContent)')
        print('ticked in the panel:', pressed, '| new-tag box keeps focus:', refocused)
        await pg.screenshot(path=shot('s41-document-fields-panel.png'))
        data = await saved(pg)
        print('saved:', values(data, 'smith2021', 'Research question'), values(data, 'smith2021', 'Tags'))
        assert values(data, 'smith2021', 'Research question') == ['Q1', 'SB']
        assert sorted(values(data, 'smith2021', 'Tags')) == ['review', 'to reread'] and len(data['fields'][1]['options']) == 3
        assert refocused

        # Untick SB again.
        await pg.click('.doc-detail .toggles >> text=SB')
        data = await saved(pg)
        assert values(data, 'smith2021', 'Research question') == ['Q1']

        await open_doc(pg, 'notes_2020')
        await pg.click('.doc-detail .toggles >> text=Q2')
        heads = await pg.eval_on_selector_all('.doc-table th', 'ths => ths.map(t => t.textContent)')
        cells = await pg.eval_on_selector_all('.doc-table tbody tr', "trs => trs.map(tr => [...tr.querySelectorAll('.cell-chips')].map(c => c.textContent))")
        print('table columns:', heads, '| chips:', cells)
        assert 'Research question' in heads and 'Tags' in heads and 'Country' not in heads
        await pg.fill('.view-documents .input.search', 'to reread')
        found = await pg.locator('.doc-table tbody tr').count()
        print('search "to reread":', found, 'document')
        assert found == 1
        await pg.fill('.view-documents .input.search', '')
        await pg.screenshot(path=shot('s42-document-fields-table.png'))

        # A segment in each paper; the Review filter on Q1 keeps only the first paper's.
        await pg.click('.nav >> text=Coding')
        await pg.select_option('.doc-picker', label=await pg.evaluate("[...document.querySelectorAll('.doc-picker option')].find(o=>o.text.startsWith('notes')).text"))
        await pg.wait_for_selector('.text-body .block')
        await code(pg, 'Teachers valued shared planning time', ['Planning'])
        await pg.select_option('.doc-picker', label=await pg.evaluate("[...document.querySelectorAll('.doc-picker option')].find(o=>o.text.startsWith('Smith')).text"))
        await pg.click('.view-coding .segmented >> text=Text'); await pg.wait_for_selector('.text-body .block')
        snippet = await pg.evaluate("document.querySelector('.text-body .block').textContent.trim().split(/\\s+/).slice(0, 4).join(' ')")
        await code(pg, snippet, ['Planning'])
        await pg.click('.nav >> text=Review'); await pg.wait_for_timeout(300)
        before = await pg.locator('.view-review .card').count()
        await pg.click('.review-filters .filter-section:has-text("Research question") .check:has-text("Q1")')
        after = await pg.locator('.view-review .card').count()
        print('Review cards, all / Q1:', before, after)
        assert before == 2 and after == 1
        await pg.screenshot(path=shot('s43-document-fields-review.png'))

        await pg.click('.view-review .btn >> text=Export CSV')
        await pg.click('dialog >> text=One row per segment'); await pg.click('dialog >> text=Comma')
        async with pg.expect_download() as dl:
            await pg.click('dialog .btn.primary')
        rows = list(csv.reader(io.StringIO((await (await dl.value).path()).read_text(encoding='utf-8-sig'))))
        head = rows[0]
        row = dict(zip(head, rows[1]))
        print('CSV:', {k: row[k] for k in ('document', 'Research question', 'Tags', 'Country')})
        assert row['Research question'] == 'Q1' and set(row['Tags'].split('; ')) == {'review', 'to reread'} and row['Country'] == 'Italy'

        # Removing an option takes it off the documents too.
        await pg.click('.nav >> text=Documents'); await pg.click('.doc-table tbody tr >> nth=0'); await pg.click('text=Edit document fields')
        await pg.click('dialog [aria-label="Remove review"]'); await pg.click('dialog >> nth=-1 >> .btn.danger')
        await pg.click('dialog >> text=Done')
        data = await saved(pg)
        print('after removing "review":', values(data, 'smith2021', 'Tags'))
        assert values(data, 'smith2021', 'Tags') == ['to reread']

        # Reopening keeps everything.
        await pg.reload(); await pg.wait_for_timeout(500); await pg.click('text=Reopen'); await pg.wait_for_selector('.nav')
        await open_doc(pg, 'smith2021')
        reopened = await pg.eval_on_selector_all('.doc-detail [aria-pressed="true"]', 'bs => bs.map(b => b.textContent)')
        print('after reopening:', reopened)
        assert reopened == ['Q1', 'to reread']

        await pg.emulate_media(color_scheme='dark'); await pg.wait_for_timeout(200)
        await pg.screenshot(path=shot('s44-document-fields-dark.png'))
        print('ERRORS', [e for e in errors if 'fake worker' not in e and 'ERR_INTERNET_DISCONNECTED' not in e])
        await b.close()

asyncio.run(main())
