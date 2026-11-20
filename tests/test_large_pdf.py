import asyncio, time
from harness import *
async def main():
    async with async_playwright() as p:
        b, pg = await setup(p)
        await pg.click('text=New project'); await pg.wait_for_selector('dialog .input'); await pg.keyboard.press('Enter')
        await pg.wait_for_selector('.view-documents:not([hidden])')
        t=time.time(); await pg.set_input_files('.view-documents input[type=file]', ['long_2018.pdf'])
        await pg.wait_for_function("document.querySelectorAll('.doc-table tbody tr').length === 1", timeout=60000)
        print('import s', round(time.time()-t,1))
        t=time.time(); await pg.click('.nav >> text=Coding'); await pg.wait_for_selector('.text-layer span', timeout=30000); print('open s', round(time.time()-t,1))
        print('rendered pages', await pg.evaluate("document.querySelectorAll('.page canvas').length"), 'of', await pg.evaluate("document.querySelectorAll('.page').length"))
        await pg.evaluate("document.querySelector('.reader-host').scrollTop = 99999"); await pg.wait_for_timeout(1500)
        print('rendered after scroll', await pg.evaluate("document.querySelectorAll('.page canvas').length"))
        await pg.click('.segmented >> text=Text'); await pg.wait_for_timeout(800)
        print('text blocks', await pg.evaluate("document.querySelectorAll('.text-body .block').length"))
        print('ERRORS', errors)
        await b.close()
asyncio.run(main())
