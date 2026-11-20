"""Projects carried between devices as a zip through Files (iCloud Drive or anywhere), with no account: the Mac
exports its folder, the iPad opens the file as a project kept on the device, codes it and exports it again, and
the Mac brings the changes back; a change on both sides asks which version to keep; a zip made by the Finder's
Compress opens too, and the project reopens from the device after a reload."""

import asyncio, io, json, zipfile
from harness import *

SCRATCH = SHOTS


async def menu(pg, item):
    await pg.click('.project-button')
    await pg.click(f'dialog .pick-row >> text={item}')


async def export(pg, name):
    async with pg.expect_download() as dl:
        await menu(pg, 'Export project file')
    path = SCRATCH / name
    await (await dl.value).save_as(path)
    return path


async def choose_file(pg, trigger, path):
    async with pg.expect_file_chooser() as fc:
        await trigger()
    await (await fc.value).set_files(str(path))


async def ipad(b):
    ctx = await b.new_context(viewport={'width': 1080, 'height': 810}, has_touch=True, accept_downloads=True)
    await ctx.route(re.compile(r'https://api\.(crossref|datacite)\.org/.*'), lambda route: route.abort('internetdisconnected'))
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(f'PAGEERROR: {str(e)[:500]}'))
    await pg.goto('http://localhost:8765/web/?storage=drive')
    return ctx, pg


async def main():
    async with async_playwright() as p:
        b, mac = await setup(p)
        await newproject(mac)
        await mac.click('.nav >> text=Coding')
        await mac.select_option('.doc-picker', label=await mac.evaluate("[...document.querySelectorAll('.doc-picker option')].find(o=>o.text.startsWith('notes')).text"))
        await mac.wait_for_selector('.text-body .block')
        await code(mac, 'Teachers valued shared planning time', ['Planning'])
        await mac.wait_for_timeout(800)
        zip1 = await export(mac, 'transfer-1.zip')
        names = zipfile.ZipFile(zip1).namelist()
        print('Mac export:', len(names), 'files', [n for n in names if not n.startswith('documents/')])
        assert 'project.json' in names and 'mcdng-transfer.json' in names and not any(n.startswith('backups/') for n in names)

        # iPad: open the file, without Google.
        ctx, pad = await ipad(b)
        print('iPad start:', await pad.eval_on_selector_all('.start-actions button', 'bs => bs.map(b => b.textContent)'))
        await choose_file(pad, lambda: pad.click('text=Open project file'), zip1)
        await pad.wait_for_selector('.nav')
        print('iPad opened:', await pad.evaluate("MCdng.project.name"), await pad.evaluate("MCdng.project.documents.length"), 'documents |', await pad.inner_text('.save-status'))
        await pad.click('.nav >> text=Coding')
        await pad.select_option('.doc-picker', label=await pad.evaluate("[...document.querySelectorAll('.doc-picker option')].find(o=>o.text.startsWith('Smith')).text"))
        await pad.click('.view-coding .segmented >> text=Pages')
        await pad.wait_for_selector('.text-layer span', timeout=20000)
        await pad.click('.view-coding .segmented >> text=Text'); await pad.wait_for_selector('.text-body .block')
        snippet = await pad.evaluate("document.querySelector('.text-body .block').textContent.trim().split(/\\s+/).slice(0, 4).join(' ')")
        await code(pad, snippet, ['Planning'])
        await pad.wait_for_timeout(800)
        status = await pad.inner_text('.save-status'), await pad.inner_text('.status-action')
        print('iPad after coding:', status)
        assert status == ('Saved on this device', 'Export')
        await pad.screenshot(path=shot('x01-ipad-device-project.png'))
        async with pad.expect_download() as dl:
            await pad.click('.status-action')
        zip2 = SCRATCH / 'transfer-2.zip'
        await (await dl.value).save_as(zip2)
        await pad.wait_for_timeout(300)
        print('iPad after export:', await pad.inner_text('.save-status'), '| action hidden:', await pad.evaluate("document.querySelector('.status-action').hidden"))

        # Mac: bring the changes in, without a question (the Mac did not change meanwhile).
        await choose_file(mac, lambda: menu(mac, 'Import changes from a file'), zip2)
        await mac.wait_for_timeout(800)
        segs = await mac.evaluate("MCdng.project.segments.length")
        print('Mac after import:', segs, 'segments |', (await mac.inner_text('.toast >> nth=-1')))
        assert segs == 2

        # Both change: the Mac is asked, and keeps the file's version with its own copied into backups.
        await mac.evaluate("MCdng.project.name = 'Changed on the Mac'; MCdng.commit('meta')")
        await pad.evaluate("MCdng.project.name = 'Changed on the iPad'; MCdng.commit('meta')")
        await mac.wait_for_timeout(800); await pad.wait_for_timeout(800)
        async with pad.expect_download() as dl:
            await pad.click('.status-action')
        zip3 = SCRATCH / 'transfer-3.zip'
        await (await dl.value).save_as(zip3)
        await choose_file(mac, lambda: menu(mac, 'Import changes from a file'), zip3)
        await mac.wait_for_selector('dialog >> text=Changed on two devices')
        await mac.screenshot(path=shot('x02-mac-import-conflict.png'))
        await mac.click("dialog >> text=Use the file’s version")
        await mac.wait_for_timeout(800)
        backups = [f for f in await mac.evaluate(TREE) if 'conflict' in f]
        print('Mac kept:', await mac.evaluate("MCdng.project.name"), '| backup:', backups)
        assert await mac.evaluate("MCdng.project.name") == 'Changed on the iPad' and backups

        # A zip made by the Finder (the folder inside, __MACOSX, deflated) opens on a new device.
        finder = SCRATCH / 'finder.zip'
        with zipfile.ZipFile(zip1) as src, zipfile.ZipFile(finder, 'w', zipfile.ZIP_DEFLATED) as out:
            for n in src.namelist():
                if n != 'mcdng-transfer.json':
                    out.writestr(f'My review/{n}', src.read(n))
                    out.writestr(f'__MACOSX/My review/._{n.replace("/", "_")}', b'junk')
            out.writestr('My review/backups/project-2026-11-20.json', b'{}')
        ctx2, pad2 = await ipad(b)
        await choose_file(pad2, lambda: pad2.click('text=Open project file'), finder)
        await pad2.wait_for_selector('.nav')
        print('Finder zip:', await pad2.evaluate("MCdng.project.name"), await pad2.evaluate("MCdng.project.documents.length"), 'documents')
        assert await pad2.evaluate("MCdng.project.documents.length") == 3

        # After a reload, the project reopens from the device.
        await pad.reload()
        await pad.click('.start-actions .btn.primary')
        await pad.wait_for_selector('.nav')
        print('iPad reopened:', await pad.evaluate("MCdng.project.name"), await pad.evaluate("MCdng.project.segments.length"), 'segments')
        assert await pad.evaluate("MCdng.project.segments.length") == 2
        print('ERRORS', [e for e in errors if 'fake worker' not in e and 'ERR_INTERNET_DISCONNECTED' not in e])
        await b.close()

asyncio.run(main())
