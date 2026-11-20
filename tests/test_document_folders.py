import asyncio
from harness import *
TO_LEGACY = """async()=>{
  const root=await (await navigator.storage.getDirectory()).getDirectoryHandle('My review');
  const pf=await root.getFileHandle('project.json'); const p=JSON.parse(await (await pf.getFile()).text());
  const docs=await root.getDirectoryHandle('documents');
  const write=async(dir,name,blob)=>{const w=await (await dir.getFileHandle(name,{create:true})).createWritable(); await w.write(blob); await w.close();};
  for (const d of p.documents) {
    const f=await docs.getDirectoryHandle(d.folder); const nd=await docs.getDirectoryHandle(d.id,{create:true});
    await write(nd,'source.'+d.file.ext, await (await f.getFileHandle('original.'+d.file.ext)).getFile());
    await write(nd,'content.json', await (await f.getFileHandle('extracted-text.json')).getFile());
    await docs.removeEntry(d.folder,{recursive:true}); delete d.folder;
  }
  p.format='marginalia/1'; await write(root,'project.json', JSON.stringify(p));
  await root.removeEntry('README.txt');
}"""
async def main():
    async with async_playwright() as p:
        b, pg = await setup(p)
        await newproject(pg)
        print('AFTER IMPORT'); [print('  ', f) for f in await pg.evaluate(TREE)]
        # The copy has the same DOI and would be refused as the same paper: clear the original's DOI first.
        await pg.click('.doc-table tbody tr >> text=Smith'); await pg.fill('.doc-detail label:has-text("DOI") input', ''); await pg.keyboard.press('Tab')
        await pg.set_input_files('.view-documents input[type=file]', ['smith_copy.pdf'])
        await pg.wait_for_function("document.querySelectorAll('.doc-table tbody tr').length === 4", timeout=30000)
        # code a segment in Rossi, then rename metadata
        await pg.click('.nav >> text=Coding')
        await pg.select_option('.doc-picker', label=await pg.evaluate("[...document.querySelectorAll('.doc-picker option')].find(o=>o.text.startsWith('Rossi')).text"))
        await pg.wait_for_selector('.text-body .block'); await code(pg, 'time constraints', ['Barriers'])
        await pg.click('.nav >> text=Documents'); await pg.click('.doc-table tbody tr >> text=Rossi')
        await pg.fill('.doc-detail label:has-text("Authors") input', 'Rossi, M.; Bianchi, L.'); await pg.keyboard.press('Tab')
        await pg.fill('.doc-detail label:has-text("Year") input', '2020'); await pg.keyboard.press('Tab')
        await pg.wait_for_timeout(2500)
        print('AFTER RENAME'); [print('  ', f) for f in await pg.evaluate(TREE)]
        await pg.wait_for_timeout(300); print('detail:', await pg.inner_text('.doc-detail .folder-path'))
        await pg.click('.nav >> text=Coding'); await pg.wait_for_timeout(500)
        print('coded pieces in renamed doc:', await pg.evaluate("document.querySelectorAll('.text-body .hl').length"))
        await pg.click('.nav >> text=Documents'); await pg.click('.doc-table tbody tr >> text=notes'); await pg.click('text=Remove document'); await pg.click('dialog .btn.danger'); await pg.wait_for_timeout(1500)
        # make it a legacy project and reopen
        await pg.evaluate(TO_LEGACY)
        print('LEGACY'); [print('  ', f) for f in await pg.evaluate(TREE)]
        await pg.reload(); await pg.wait_for_timeout(500); await pg.click('text=Reopen')
        await pg.wait_for_selector('.view-coding:not([hidden]), .view-documents:not([hidden])', timeout=15000); await pg.wait_for_timeout(800)
        print('UPGRADED'); [print('  ', f) for f in await pg.evaluate(TREE)]
        await pg.click('.nav >> text=Coding')
        await pg.select_option('.doc-picker', label=await pg.evaluate("[...document.querySelectorAll('.doc-picker option')].find(o=>o.text.startsWith('Rossi')).text"))
        await pg.wait_for_timeout(600)
        print('coded pieces after upgrade:', await pg.evaluate("document.querySelectorAll('.text-body .hl').length"))
        await pg.select_option('.doc-picker', label=await pg.evaluate("[...document.querySelectorAll('.doc-picker option')].find(o=>o.text.startsWith('Smith')).text"))
        await pg.wait_for_selector('.text-layer span', timeout=15000); print('pdf renders after upgrade')
        print(await pg.evaluate("""async()=>{const r=await (await navigator.storage.getDirectory()).getDirectoryHandle('My review'); return (await (await (await r.getFileHandle('README.txt')).getFile()).text()).slice(0,120)}"""))
        print('ERRORS', errors)
        await b.close()
asyncio.run(main())
