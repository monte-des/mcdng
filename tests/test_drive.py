"""Projects on Google Drive, as on the iPad: sign-in, a new project, import and coding synced to Drive, a renamed
document folder copied by Drive, changes made on the other device, a conflict, working offline, a second device,
and an expired sign-in. Google is the fake in fakedrive.py; the app runs with ?storage=drive in an iPad-sized
touch window."""

import asyncio, json
from harness import *
from fakedrive import FakeDrive

APP = 'http://localhost:8765/MCdng.html?storage=drive'
INIT = "globalThis.MCDNG_CLIENT_ID = 'test-client';"


async def device(b, drive, width=1080, height=810):
    ctx = await b.new_context(viewport={'width': width, 'height': height}, has_touch=True, accept_downloads=True)
    await ctx.add_init_script(INIT)
    await drive.attach(ctx)
    await ctx.route(re.compile(r'https://api\.(crossref|datacite)\.org/.*'), lambda route: route.abort('internetdisconnected'))
    pg = await ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and errors.append(f'{m.type}: {m.text[:300]}'))
    pg.on('pageerror', lambda e: errors.append(f'PAGEERROR: {str(e)[:500]}'))
    await pg.goto(APP)
    return ctx, pg


async def status(pg):
    return await pg.inner_text('.save-status')


async def synced(pg, timeout=20000):
    await pg.wait_for_function("document.querySelector('.save-status')?.textContent === 'All changes on Drive'", timeout=timeout)


async def main():
    drive = FakeDrive()
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx, pg = await device(b, drive)
        print('start:', await pg.eval_on_selector_all('.start-actions button', 'bs => bs.map(b => b.textContent)'))
        await pg.screenshot(path=shot('d01-start.png'))

        # A new project: sign in with Google, come back, name it.
        await pg.click('.start-actions >> text=New project')
        await pg.click('dialog button >> text=On Google Drive')
        await pg.wait_for_selector('dialog .input')
        print('signed in with:', {k: drive.signins[0][k] for k in ('client_id', 'redirect_uri', 'response_type', 'scope')})
        await pg.fill('dialog .input', 'Literature review'); await pg.keyboard.press('Enter')
        await pg.wait_for_selector('.view-documents:not([hidden])')
        await pg.set_input_files('.view-documents input[type=file]', ['smith2021.pdf', 'notes_2020.txt'])
        await pg.wait_for_function("document.querySelectorAll('.doc-table tbody tr').length === 2", timeout=30000)
        await synced(pg)
        root = next(f['id'] for f in drive.files.values() if f['name'] == 'Literature review')
        print('on Drive:', drive.paths(root))
        assert 'project.json' in drive.paths(root) and any(p.endswith('original.pdf') for p in drive.paths(root))
        assert json.loads(drive.read('project.json', root))['name'] == 'Literature review'

        # Coding goes to Drive.
        await pg.click('.nav >> text=Coding')
        await pg.select_option('.doc-picker', label=await pg.evaluate("[...document.querySelectorAll('.doc-picker option')].find(o=>o.text.startsWith('notes')).text"))
        await pg.wait_for_selector('.text-body .block')
        await code(pg, 'Teachers valued shared planning time', ['Planning'])
        await synced(pg)
        data = json.loads(drive.read('project.json', root))
        print('segments on Drive:', len(data['segments']), '| codes:', [c['name'] for c in data['codes']])
        assert len(data['segments']) == 1

        # A changed title renames the document folder; Drive copies the files instead of a new upload.
        await pg.click('.nav >> text=Documents')
        await pg.click('.doc-table tbody tr:has-text("notes")')
        uploads = drive.calls.count(('POST', 'upload'))
        await pg.fill('.doc-detail textarea >> nth=0', 'Planning notes'); await pg.keyboard.press('Tab')
        await pg.wait_for_timeout(2500); await synced(pg)
        paths = drive.paths(root)
        print('after renaming:', [p for p in paths if p.startswith('documents/')])
        print('   uploads for it:', drive.calls.count(('POST', 'upload')) - uploads, '| copies:', drive.calls.count(('POST', 'copy')), '| bin:', drive.calls.count(('PATCH', 'trash')))
        assert any('Planning notes' in p for p in paths) and not any('notes 2020' in p for p in paths)
        assert drive.calls.count(('POST', 'copy')) == 2

        # The other device adds a code; coming back to MCdng picks it up.
        other = json.loads(drive.read('project.json', root))
        other['codes'].append({**other['codes'][0], 'id': 'mac-code', 'name': 'Added on the Mac'})
        drive.set_content(drive.find('project.json', root)['id'], json.dumps(other, indent=1))
        await pg.evaluate("MCdng.App.refresh(true)")
        await pg.wait_for_timeout(800)
        names = await pg.evaluate("MCdng.project.codes.map(c => c.name)")
        print('after the other device:', names)
        assert 'Added on the Mac' in names

        # Both sides change while offline: MCdng asks which version to keep and keeps the other in backups.
        await ctx.set_offline(True)
        await pg.evaluate("MCdng.project.name = 'Review on the iPad'; MCdng.commit('meta')")
        await pg.wait_for_timeout(1500)
        offline_status = await status(pg)
        other = json.loads(drive.read('project.json', root))
        other['name'] = 'Review on the Mac'
        drive.set_content(drive.find('project.json', root)['id'], json.dumps(other, indent=1))
        await ctx.set_offline(False)
        await pg.evaluate("MCdng.App.refresh(true)")
        await pg.wait_for_selector('dialog >> text=Changed on two devices')
        await pg.screenshot(path=shot('d02-conflict.png'))
        await pg.click('dialog >> text=Keep this version')
        await synced(pg)
        backups = [p for p in drive.paths(root) if 'conflict' in p]
        print('offline status:', offline_status, '| kept on Drive:', json.loads(drive.read('project.json', root))['name'], '| backup:', backups)
        assert offline_status == 'Saved here · offline' and json.loads(drive.read('project.json', root))['name'] == 'Review on the iPad'
        assert json.loads(drive.read(backups[0], root))['name'] == 'Review on the Mac'

        # Offline, the project reopens from the device, with its PDF.
        await pg.wait_for_function("!MCdng.Sync.downloads", timeout=20000)
        await ctx.set_offline(True)
        await pg.evaluate("MCdng.App.close()")
        await pg.wait_for_selector('.start-actions')
        await pg.click('.start-actions .btn.primary')
        await pg.wait_for_selector('.nav')
        await pg.click('.nav >> text=Coding')
        await pg.select_option('.doc-picker', label=await pg.evaluate("[...document.querySelectorAll('.doc-picker option')].find(o=>o.text.startsWith('Smith')).text"))
        await pg.wait_for_selector('.pdf-page canvas, .page canvas', timeout=20000)
        print('offline reopen:', await status(pg), '| PDF pages shown:', await pg.locator('canvas').count())
        await ctx.set_offline(False)

        # A second device with nothing on it: open from Drive, the project and its papers come down.
        ctx2, pg2 = await device(b, drive, 810, 1080)
        await pg2.click('text=Open from Google Drive')
        await pg2.wait_for_selector('.pick-row')
        await pg2.screenshot(path=shot('d03-pick.png'))
        await pg2.click('.pick-row >> nth=0')
        await pg2.wait_for_selector('.nav')
        await synced(pg2)
        docs = await pg2.evaluate("MCdng.project.documents.map(d => d.title)")
        print('second device:', await pg2.evaluate("MCdng.project.name"), docs)
        await pg2.wait_for_function("!MCdng.Sync.downloads", timeout=20000)
        await pg2.click('.nav >> text=Review'); await pg2.wait_for_timeout(500)
        await pg2.screenshot(path=shot('d04-second-device.png'))
        assert len(docs) == 2

        # An expired sign-in: changes stay on the device and the status offers to sign in.
        await pg2.evaluate("localStorage.setItem('mcdng.google', JSON.stringify({ ...JSON.parse(localStorage.getItem('mcdng.google')), expires: 0 }))")
        await pg2.evaluate("MCdng.project.name = 'Renamed on the second device'; MCdng.commit('meta')")
        await pg2.wait_for_selector('.status-action:not([hidden])', timeout=10000)
        print('expired:', await status(pg2), '|', await pg2.inner_text('.status-action'))
        await pg2.click('.status-action')
        await pg2.wait_for_selector('.nav')
        await synced(pg2)
        print('after signing in again:', json.loads(drive.read('project.json', root))['name'], '| section:', await pg2.evaluate('MCdng.App.current'))
        assert json.loads(drive.read('project.json', root))['name'] == 'Renamed on the second device'

        print('ERRORS', [e for e in errors if 'fake worker' not in e and 'ERR_INTERNET_DISCONNECTED' not in e])
        await b.close()

asyncio.run(main())
