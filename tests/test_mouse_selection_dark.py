import asyncio, time
from harness import *
async def main():
    async with async_playwright() as p:
        b, pg = await setup(p, dark=True)
        await newproject(pg)
        await pg.click('.nav >> text=Coding')
        await pg.select_option('.doc-picker', label=await pg.evaluate("[...document.querySelectorAll('.doc-picker option')].find(o=>o.text.startsWith('Smith')).text"))
        await pg.wait_for_selector('.text-layer span', timeout=20000); await pg.wait_for_timeout(500)
        # real mouse drag across two lines in the left column
        boxes = await pg.evaluate("""()=>{const sp=[...document.querySelectorAll('.page .text-layer span')].filter(s=>s.textContent.includes('In this study we interviewed'))[0]; const r=sp.getBoundingClientRect(); return [r.left+2, r.top+r.height/2, r.width, r.height];}""")
        x,y,w,hh = boxes
        await pg.mouse.move(x, y); await pg.mouse.down(); await pg.mouse.move(x+200, y+hh*1.6, steps=8); await pg.mouse.up()
        await pg.wait_for_selector('.editor', timeout=3000)
        print('quote:', await pg.inner_text('.popover-quote'))
        await pg.keyboard.type('Methods'); await pg.keyboard.press('Enter'); await pg.keyboard.press('Control+Enter')
        await pg.wait_for_timeout(400)
        await pg.screenshot(path=shot('s17-dark-pages.png'))
        await pg.click('.segmented >> text=Text'); await pg.wait_for_timeout(600)
        await pg.screenshot(path=shot('s18-dark-text.png'))
        # real drag in text view
        r = await pg.evaluate("""()=>{const b=[...document.querySelectorAll('.text-body .block')].find(e=>e.textContent.startsWith('Several teachers')); const r=b.getBoundingClientRect(); return [r.left+3, r.top+12, r.width];}""")
        await pg.mouse.move(r[0], r[1]); await pg.mouse.down(); await pg.mouse.move(r[0]+r[2]*0.7, r[1]+30, steps=8); await pg.mouse.up()
        await pg.wait_for_selector('.editor', timeout=3000)
        print('quote2:', await pg.inner_text('.popover-quote'))
        await pg.screenshot(path=shot('s19-dark-editor.png'))
        await pg.keyboard.press('Escape')
        await pg.click('.nav >> text=Review'); await pg.click('.btn >> text=Export CSV'); await pg.wait_for_timeout(200)
        await pg.screenshot(path=shot('s20-dark-export.png'))
        print('ERRORS', errors)
        await b.close()
asyncio.run(main())
