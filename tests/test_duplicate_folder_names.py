import asyncio
from harness import *
async def main():
    async with async_playwright() as p:
        b, pg = await setup(p)
        await newproject(pg)
        # The copy has the same DOI and would be refused as the same paper: clear the original's DOI first.
        await pg.click('.doc-table tbody tr >> text=Smith'); await pg.fill('.doc-detail label:has-text("DOI") input', ''); await pg.keyboard.press('Tab')
        await pg.set_input_files('.view-documents input[type=file]', ['smith_2021_v2.pdf'])
        await pg.wait_for_function("document.querySelectorAll('.doc-table tbody tr').length === 4", timeout=30000)
        [print('  ', f) for f in await pg.evaluate(TREE) if 'Smith' in f]
        await pg.click('.doc-table tbody tr >> text=Rossi'); await pg.wait_for_timeout(200)
        await pg.screenshot(path=shot('s23-detail.png'), clip={'x':1020,'y':110,'width':420,'height':200})
        print('ERRORS', errors); await b.close()
asyncio.run(main())
