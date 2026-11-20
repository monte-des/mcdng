import asyncio
from harness import *
async def main():
    async with async_playwright() as p:
        b, pg = await setup(p)
        await newproject(pg)
        await pg.click('.doc-table tbody tr >> text=Rossi'); await pg.click('text=Edit document fields'); await pg.fill('dialog input[aria-label="New field name"]', 'Study design'); await pg.keyboard.press('Enter')
        await pg.fill('dialog input[aria-label="New field name"]', 'Country'); await pg.keyboard.press('Enter')
        await pg.screenshot(path=shot('s21-fields.png')); await pg.click('dialog >> text=Done')
        await pg.click('.doc-table tbody tr >> text=Rossi')
        await pg.fill('.doc-detail label:has-text("Study design") input', 'Systematic review'); await pg.keyboard.press('Tab')
        await pg.fill('.doc-detail label:has-text("Journal") input', 'Teaching and Teacher Education'); await pg.keyboard.press('Tab')
        print('focus after tab:', await pg.evaluate("document.activeElement.closest('label')?.innerText.split('\\n')[0]"))
        # txt doc coding
        await pg.click('.nav >> text=Coding')
        await pg.select_option('.doc-picker', label=await pg.evaluate("[...document.querySelectorAll('.doc-picker option')].find(o=>o.text.startsWith('notes')).text"))
        await pg.wait_for_selector('.text-body .block'); await code(pg, 'shared planning time', ['Collaboration'])
        # subcode + filter
        await pg.click('.nav >> text=Codebook'); await pg.click('.cb-code >> text=Collaboration'); await pg.click('text=New subcode')
        await pg.fill('.cb-detail input >> nth=0', 'Co-planning'); await pg.click('text=Create code'); await pg.wait_for_timeout(200)
        await pg.click('.nav >> text=Coding'); await code(pg, 'Teachers valued', ['Co-planning'])
        await pg.click('.nav >> text=Review'); await pg.click('.check:has-text("Collaboration") input'); await pg.wait_for_timeout(200)
        print('with subcodes:', await pg.inner_text('.view-review .view-count'))
        await pg.click('.check:has-text("Include subcodes") input'); await pg.wait_for_timeout(200)
        print('without subcodes:', await pg.inner_text('.view-review .view-count'))
        # remove document
        await pg.click('.nav >> text=Documents'); await pg.click('.doc-table tbody tr >> text=notes'); await pg.click('text=Remove document'); await pg.click('dialog .btn.danger'); await pg.wait_for_timeout(300)
        print('docs left', await pg.evaluate("document.querySelectorAll('.doc-table tbody tr').length"))
        await pg.set_viewport_size({'width':900,'height':800}); await pg.click('.nav >> text=Coding'); await pg.wait_for_timeout(600)
        await pg.screenshot(path=shot('s22-narrow.png'))
        await pg.click('.nav >> text=Codebook'); await pg.click('.view-codebook .segmented >> text=History')
        print((await pg.inner_text('.cb-log'))[:300])
        print('ERRORS', errors)
        await b.close()
asyncio.run(main())
