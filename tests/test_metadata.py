"""Bibliographic details: read from the files without a connection, completed from Crossref with one.
Crossref and DataCite are replaced by canned answers, so the test needs no network."""

import asyncio, json, re
from urllib.parse import unquote
from harness import *

TATE = {
    'DOI': '10.1016/j.tate.2020.103145', 'title': ['Co-teaching and teacher self-efficacy in inclusive secondary schools'],
    'author': [{'given': 'Maria', 'family': 'Rossi'}, {'given': 'Kim', 'family': 'Lee'}],
    'issued': {'date-parts': [[2020, 11]]}, 'container-title': ['Teaching and Teacher Education'], 'volume': '96', 'page': '103145',
}
GATEKEEPERS = {
    'DOI': '10.1080/13603116.2019.1634149', 'title': ['Principals as gatekeepers of inclusive practice: <i>a</i> qualitative study'],
    'author': [{'given': 'Ana María', 'family': 'Gómez'}], 'issued': {'date-parts': [[2019, 8]]},
    'container-title': ['International Journal of Inclusive Education'], 'volume': '25', 'issue': '4', 'page': '401-417',
}
UNRELATED = {'DOI': '10.1000/other', 'title': ['Classroom acoustics and reading fluency'], 'author': [{'family': 'Brown'}], 'issued': {'date-parts': [[2015]]}}
requests = []


async def crossref(route):
    url = route.request.url
    requests.append(unquote(url))
    headers = {'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json'}
    if 'api.datacite.org' in url:
        return await route.fulfill(status=404, headers=headers, body='{}')
    if '/works/' in url:
        doi = unquote(url.split('/works/')[1]).lower()
        if doi == TATE['DOI']:
            return await route.fulfill(headers=headers, body=json.dumps({'message': TATE}))
        return await route.fulfill(status=404, headers=headers, body='Resource not found.')
    return await route.fulfill(headers=headers, body=json.dumps({'message': {'items': [UNRELATED, GATEKEEPERS]}}))


async def offline(route):
    requests.append(unquote(route.request.url))
    await route.abort('internetdisconnected')


async def project_docs(pg):
    data = await pg.evaluate("""async()=>{const d=await (await navigator.storage.getDirectory()).getDirectoryHandle('My review'); return JSON.parse(await (await (await d.getFileHandle('project.json')).getFile()).text())}""")
    return {d['file']['name']: d for d in data['documents']}


def show(docs):
    for name, d in docs.items():
        print(f"   {name}: [{d['meta']['source']}] {d['authors'] or '-'} | {d['year'] or '-'} | {d['title']} | {d['journal'] or '-'} {d['volume']} {d['issue']} {d['articlePages']} | {d['doi'] or '-'} | {d['folder']}")


async def main():
    async with async_playwright() as p:
        b, pg = await setup(p)
        await pg.route(re.compile(r'https://api\.(crossref|datacite)\.org/.*'), offline)
        await pg.click('text=New project')
        await pg.wait_for_selector('dialog .input'); await pg.fill('dialog .input', 'Metadata'); await pg.keyboard.press('Enter')
        await pg.wait_for_selector('.view-documents:not([hidden])')

        # Without a connection: details come from the files, and nothing complains.
        await pg.set_input_files('.view-documents input[type=file]', ['manuscript_final_v3.pdf', 'scan0042.pdf', 'smith2021.pdf'])
        await pg.wait_for_function("document.querySelectorAll('.doc-table tbody tr').length === 3", timeout=30000)
        await pg.wait_for_timeout(1500)
        docs = await project_docs(pg)
        print('offline, from the files:'); show(docs)
        tate = docs['manuscript_final_v3.pdf']
        assert tate['title'] == 'Co-teaching and teacher self-efficacy in inclusive secondary schools', tate['title']
        assert tate['doi'] == '10.1016/j.tate.2020.103145' and tate['year'] == '2020' and tate['meta']['source'] == 'file'
        assert docs['scan0042.pdf']['title'].startswith('Principals as gatekeepers'), docs['scan0042.pdf']['title']
        toasts = await pg.eval_on_selector_all('.toast-error', 'els => els.map(e => e.textContent)')
        print('error toasts offline:', toasts, '| lookups attempted:', len(requests))
        assert not toasts
        await pg.click('.doc-table tbody tr >> text=Co-teaching')
        print('detail offline:', await pg.inner_text('.meta-source-text'))
        await pg.click('text=Look up details'); await pg.wait_for_selector('.toast-error')
        print('look up offline:', await pg.inner_text('.toast-error'))

        # The cover page is skipped: the title comes from the article's first page.
        await pg.set_input_files('.view-documents input[type=file]', ['download.pdf'])
        await pg.wait_for_function("document.querySelectorAll('.doc-table tbody tr').length === 4", timeout=30000)
        await pg.wait_for_timeout(1200)
        print('cover page:', (await project_docs(pg))['download.pdf']['title'])
        assert (await project_docs(pg))['download.pdf']['title'].startswith('Principals as gatekeepers')
        await pg.evaluate("document.querySelectorAll('.toast').forEach(t => t.remove())")

        # With a connection: Find details online looks every document up and asks before applying.
        await pg.unroute(re.compile(r'https://api\.(crossref|datacite)\.org/.*'))
        await pg.route(re.compile(r'https://api\.(crossref|datacite)\.org/.*'), crossref)
        requests.clear()
        await pg.click('text=Find details online'); await pg.wait_for_selector('dialog .meta-picks', timeout=20000)
        picks = await pg.eval_on_selector_all('.meta-pick', 'rows => rows.map(r => (r.querySelector("input").checked ? "[x] " : "[ ] ") + r.innerText.replace(/\\s+/g, " "))')
        print('review:'); [print('  ', x) for x in picks]
        print('requests:', requests)
        await pg.screenshot(path=shot('s34-find-details.png'))
        await pg.click('dialog .btn.primary'); await pg.wait_for_timeout(2500)
        docs = await project_docs(pg)
        print('after review:'); show(docs)
        tate = docs['manuscript_final_v3.pdf']
        assert tate['authors'] == 'Rossi, M.; Lee, K.' and tate['journal'] == 'Teaching and Teacher Education' and tate['volume'] == '96' and tate['meta']['source'] == 'crossref'
        assert tate['folder'].startswith('Rossi & Lee 2020 - Co-teaching and teacher'), tate['folder']
        gk = docs['scan0042.pdf']
        assert gk['authors'] == 'Gómez, A. M.' and gk['title'] == 'Principals as gatekeepers of inclusive practice: a qualitative study' and gk['articlePages'] == '401–417'
        assert docs['smith2021.pdf']['meta']['source'] == 'file', 'a document with no record keeps its details'

        # A field edited by hand is kept; Look up details compares and lets the user choose.
        await pg.click('.doc-table tbody tr >> text=Principals as gatekeepers >> nth=0')
        await pg.fill('.doc-detail label:has-text("Journal") input', 'Int. J. Inclusive Educ.'); await pg.keyboard.press('Tab')
        await pg.click('text=Look up details'); await pg.wait_for_selector('dialog .meta-compare')
        rows = await pg.eval_on_selector_all('.meta-row:not(.meta-head)', 'rows => rows.map(r => (r.querySelector("input").checked ? "[x] " : "[ ] ") + r.innerText.replace(/\\s+/g, " "))')
        print('compare:'); [print('  ', x) for x in rows]
        await pg.screenshot(path=shot('s35-look-up.png'))
        await pg.click('dialog >> text=Cancel')
        print('detail online:', await pg.inner_text('.meta-source-text'))
        await pg.screenshot(path=shot('s36-document-details.png'))

        # A newly imported paper is completed in the background.
        await pg.set_input_files('.view-documents input[type=file]', ['long_2018.pdf'])
        await pg.wait_for_function("document.querySelectorAll('.doc-table tbody tr').length === 5", timeout=30000)
        await pg.wait_for_timeout(1500)
        print('ERRORS', errors)
        await b.close()

asyncio.run(main())
