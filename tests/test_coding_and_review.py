import asyncio
from harness import *
async def main():
    async with async_playwright() as p:
        b, pg = await setup(p)
        await newproject(pg)
        await pg.click('.nav >> text=Coding')
        await pg.select_option('.doc-picker', label=await pg.evaluate("[...document.querySelectorAll('.doc-picker option')].find(o=>o.text.startsWith('Smith')).text"))
        await pg.wait_for_selector('.text-layer span', timeout=20000); await pg.wait_for_timeout(400)
        await code(pg, 'teacher self-efficacy is a strong predictor', ['Self-efficacy'], memo='Key claim')
        await code(pg, 'is a strong predictor of the willingness to implement inclusive practices', ['Inclusive practice'])
        await code(pg, 'insufficient training, large class sizes', ['Barriers', 'Training'])
        await pg.click('.segmented >> text=Text'); await pg.wait_for_selector('.text-body .block'); await pg.wait_for_timeout(500)
        print('scrollTop after switch', await pg.evaluate("document.querySelector('.reader-host').scrollTop"))
        await pg.screenshot(path=shot('s07-text-top.png'))
        await pg.evaluate("""()=>{const el=[...document.querySelectorAll('.text-body .hl')].find(e=>e.textContent.includes('strong predictor')); const t=el.firstChild; const r=document.createRange(); r.setStart(t,3); r.collapse(true); const s=getSelection(); s.removeAllRanges(); s.addRange(r); const b=el.getBoundingClientRect(); document.querySelector('.reader-host').dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,clientX:b.left+5,clientY:b.top+5}));}""")
        await pg.wait_for_timeout(300)
        await pg.click('.choice >> nth=0'); await pg.wait_for_timeout(200)
        await pg.screenshot(path=shot('s08-edit.png'))
        await pg.keyboard.press('Escape')
        # word doc
        await pg.select_option('.doc-picker', label=await pg.evaluate("[...document.querySelectorAll('.doc-picker option')].find(o=>o.text.startsWith('Rossi')).text"))
        await pg.wait_for_selector('.text-body .block'); await pg.wait_for_timeout(300)
        await code(pg, 'time constraints and limited resources', ['Barriers'])
        await code(pg, 'Support from school leadership', ['Leadership support'])
        await pg.screenshot(path=shot('s09-docx.png'))
        await pg.click('.side-tabs >> text=Codes'); await pg.wait_for_timeout(200)
        await pg.screenshot(path=shot('s09b-codes.png'), clip={'x':1100,'y':50,'width':340,'height':300})
        # Review
        await pg.click('.nav >> text=Review'); await pg.wait_for_timeout(400)
        await pg.screenshot(path=shot('s10-review.png'))
        await pg.click('.btn >> text=Export CSV')
        await pg.click('text=One row per segment and code'); await pg.click('text=Semicolon')
        async with pg.expect_download() as dl:
            await pg.click('dialog .btn.primary')
        d = await dl.value; path = await d.path(); print('CSV', d.suggested_filename); print(open(path, encoding='utf-8-sig').read()[:900])
        print('ERRORS', errors)
        await b.close()
asyncio.run(main())
