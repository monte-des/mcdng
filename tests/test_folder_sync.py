"""A project folder kept in sync by an app such as Google Drive for desktop: when project.json is replaced by a
version saved on another device, MCdng reloads it if nothing changed here, and asks which version to keep when
both changed, copying the other one into backups."""

import asyncio, json
from harness import *

WRITE = """async text => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('My review');
  const w = await (await dir.getFileHandle('project.json')).createWritable(); await w.write(text); await w.close();
}"""
READ = """async () => {
  const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('My review');
  return (await (await dir.getFileHandle('project.json')).getFile()).text();
}"""


async def main():
    async with async_playwright() as p:
        b, pg = await setup(p)
        await newproject(pg)
        await pg.wait_for_timeout(1000)

        # Saved on the iPad, nothing changed here: coming back to MCdng reloads it.
        other = json.loads(await pg.evaluate(READ))
        other['name'] = 'Renamed on the iPad'
        await pg.evaluate(WRITE, json.dumps(other, indent=1))
        await pg.evaluate("MCdng.App.refresh(true)")
        await pg.wait_for_timeout(500)
        name = await pg.evaluate("MCdng.project.name")
        print('reloaded:', name, '|', await pg.inner_text('.toast >> nth=-1'))
        assert name == 'Renamed on the iPad'

        # Changed on both sides: the save stops and MCdng asks.
        await pg.evaluate("MCdng.project.name = 'Renamed on the Mac'; MCdng.commit('meta')")
        other['name'] = 'Renamed on the iPad again'
        await pg.evaluate(WRITE, json.dumps(other, indent=1))
        await pg.wait_for_selector('dialog >> text=Changed on two devices', timeout=5000)
        on_disk = json.loads(await pg.evaluate(READ))['name']
        print('while asking, on disk:', on_disk, '| status:', await pg.inner_text('.save-status'))
        assert on_disk == 'Renamed on the iPad again'
        await pg.click('dialog >> text=Keep the other version')
        await pg.wait_for_timeout(500)
        files = await pg.evaluate(TREE)
        backup = [f for f in files if 'conflict' in f]
        print('kept:', await pg.evaluate("MCdng.project.name"), '| backup:', backup, '| status:', await pg.inner_text('.save-status'))
        assert await pg.evaluate("MCdng.project.name") == 'Renamed on the iPad again' and backup

        # Keeping this version overwrites the other, which goes to backups.
        await pg.evaluate("MCdng.project.name = 'Mac wins'; MCdng.commit('meta')")
        other['name'] = 'iPad loses'
        await pg.evaluate(WRITE, json.dumps(other, indent=1))
        await pg.wait_for_selector('dialog >> text=Changed on two devices', timeout=5000)
        await pg.click('dialog >> text=Keep this version')
        await pg.wait_for_timeout(800)
        print('on disk now:', json.loads(await pg.evaluate(READ))['name'], '| backups:', [f for f in await pg.evaluate(TREE) if 'conflict' in f])
        assert json.loads(await pg.evaluate(READ))['name'] == 'Mac wins'

        # Ordinary saves after that go on without asking.
        await pg.evaluate("MCdng.project.name = 'Mac again'; MCdng.commit('meta')")
        await pg.wait_for_timeout(1200)
        assert json.loads(await pg.evaluate(READ))['name'] == 'Mac again'
        print('ERRORS', [e for e in errors if 'fake worker' not in e and 'ERR_INTERNET_DISCONNECTED' not in e])
        await b.close()

asyncio.run(main())
