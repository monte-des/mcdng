import asyncio
from harness import *

# Reference pairs from the Porter stemmer's published vocabulary, plus the plural the user cares about.
PORTER = {
    'caresses': 'caress', 'ponies': 'poni', 'ties': 'ti', 'cats': 'cat', 'agreed': 'agre', 'plastered': 'plaster',
    'motoring': 'motor', 'conflated': 'conflat', 'hopping': 'hop', 'filing': 'file', 'happy': 'happi', 'relational': 'relat',
    'conditional': 'condit', 'digitizer': 'digit', 'vietnamization': 'vietnam', 'decisiveness': 'decis', 'hopefulness': 'hope',
    'sensibiliti': 'sensibl', 'electrical': 'electr', 'adjustable': 'adjust', 'adoption': 'adopt', 'homologous': 'homolog',
    'generalizations': 'gener', 'oscillators': 'oscil', 'controll': 'control', 'teachers': 'teacher', 'teaching': 'teach',
}


async def main():
    async with async_playwright() as p:
        b, pg = await setup(p)
        source = (ROOT / 'src' / 'js' / '14-text.js').read_text(encoding='utf-8')
        stems = await pg.evaluate("([src, words]) => { const { stemWord } = new Function(src + '; return { stemWord };')(); return words.map(stemWord); }", [source, list(PORTER)])
        wrong = [(w, s) for w, s in zip(PORTER, stems) if PORTER[w] != s]
        print('porter mismatches:', wrong)
        assert not wrong

        await newproject(pg)
        await pg.click('.nav >> text=Insights')
        print('empty:', await pg.inner_text('.view-insights .empty-title'))
        await pg.click('.nav >> text=Coding')
        await pg.select_option('.doc-picker', label=await pg.evaluate("[...document.querySelectorAll('.doc-picker option')].find(o=>o.text.startsWith('Smith')).text"))
        await pg.wait_for_selector('.text-layer span', timeout=20000); await pg.wait_for_timeout(400)
        await code(pg, 'insufficient training, large class sizes and a lack of support staff', ['Barriers'])
        await code(pg, 'insufficient training', ['Training'])
        await code(pg, 'collaboration with special education colleagues increased their confidence', ['Collaboration'])
        await code(pg, 'collaboration with special education colleagues increased their confidence', ['Collaboration', 'Self-efficacy'], occ=1)
        await code(pg, 'teacher self-efficacy is a strong predictor', ['Self-efficacy'])
        await code(pg, 'teacher self-efficacy is a strong predictor', ['Self-efficacy'], occ=1)
        await pg.select_option('.doc-picker', label=await pg.evaluate("[...document.querySelectorAll('.doc-picker option')].find(o=>o.text.startsWith('Rossi')).text"))
        await pg.wait_for_selector('.text-body .block')
        await code(pg, 'time constraints and limited resources hinder inclusive practice', ['Barriers'])
        await code(pg, 'Support from school leadership', ['Collaboration'])

        # Overview
        await pg.click('.nav >> text=Insights'); await pg.wait_for_selector('.insight')
        print('sections:', await pg.eval_on_selector_all('.insight-title', 'els => els.map(e => e.textContent)'))
        themes = await pg.eval_on_selector_all('.insight:nth-of-type(1) tbody tr', 'rows => rows.map(r => [...r.cells].map(c => c.innerText.trim()).join(" | "))')
        print('themes:'); [print('  ', t) for t in themes]
        matrix = await pg.eval_on_selector_all('.matrix tbody tr, .matrix tfoot tr', 'rows => rows.map(r => [...r.cells].map(c => c.innerText.trim() || "·").join(" | "))')
        print('matrix:'); [print('  ', m) for m in matrix]
        pairs = await pg.eval_on_selector_all('.insight:nth-of-type(3) tbody tr', 'rows => rows.map(r => [...r.cells].map(c => c.innerText.trim()).join(" | "))')
        print('coded together:', pairs)
        assert any('Barriers' in r and 'Training' in r for r in pairs), 'overlap pair missing'
        assert any('Collaboration' in r and 'Self-efficacy' in r for r in pairs), 'same-segment pair missing'
        similar = await pg.eval_on_selector_all('.insight:nth-of-type(4) tbody tr, .insight:nth-of-type(4) .insight-empty', 'rows => rows.map(r => r.innerText.replace(/\\s+/g, " ").trim())')
        print('similar vocabulary:', similar)
        await pg.screenshot(path=shot('s29-insights-overview.png'))
        async with pg.expect_download() as dl:
            await pg.click('.insight:nth-of-type(2) .insight-head .btn'); await pg.click('dialog .btn.primary')
        print('matrix csv:', (await (await dl.value).path()).read_text(encoding='utf-8-sig').splitlines()[:3])

        # Keywords
        await pg.click('.view-insights .segmented >> text=Keywords'); await pg.wait_for_selector('.keywords')
        print('summary:', await pg.inner_text('.keyword-summary'))
        top = await pg.eval_on_selector_all('.keywords tbody tr', 'rows => rows.slice(0, 8).map(r => r.cells[0].innerText.replace(/\\n/g, " / ") + " = " + r.cells[1].innerText)')
        print('top words:', top)
        assert 'teacher' in await pg.eval_on_selector_all('.keywords .term-label', 'els => els.map(e => e.textContent)')
        await pg.click('.keyword-tools .segmented >> text=Phrases'); await pg.wait_for_timeout(200)
        phrases = await pg.eval_on_selector_all('.keywords tbody tr', 'rows => rows.map(r => r.cells[0].innerText.replace(/\\n/g, " / ") + " = " + r.cells[1].innerText)')
        print('phrases:', phrases)
        assert any('special education' in t for t in phrases)
        await pg.click('.keyword-tools .segmented >> text=Words')
        await pg.select_option('.keyword-tools .scope', label='Self-efficacy'); await pg.wait_for_timeout(200)
        distinct = await pg.eval_on_selector_all('.keywords tbody tr', 'rows => rows.slice(0, 6).map(r => r.cells[0].innerText.split("\\n")[0] + " " + r.cells[4].innerText)')
        print('distinctive for Self-efficacy:', distinct)
        await pg.screenshot(path=shot('s30-keywords.png'))

        # Exclude a word, then restore it from the dialog
        before = await pg.eval_on_selector_all('.keywords tbody tr', 'rows => rows.length')
        first = await pg.inner_text('.keywords tbody tr >> nth=0 >> .term-label')
        await pg.hover('.keywords tbody tr >> nth=0'); await pg.click('.keywords tbody tr >> nth=0 >> text=Exclude'); await pg.wait_for_timeout(200)
        after = await pg.eval_on_selector_all('.keywords tbody tr', 'rows => rows.length')
        print(f'excluded "{first}": rows {before} -> {after};', await pg.inner_text('.keyword-tools .btn >> nth=0'))
        assert after == before - 1
        await pg.click('.keyword-tools >> text=Excluded words'); await pg.fill('dialog textarea', ''); await pg.click('dialog .btn.primary'); await pg.wait_for_timeout(200)
        assert await pg.eval_on_selector_all('.keywords tbody tr', 'rows => rows.length') == before

        # From a keyword to the segments that contain it
        await pg.select_option('.keyword-tools .scope', label='All coded segments'); await pg.wait_for_timeout(200)
        row = pg.locator('.keywords tbody tr', has=pg.locator('.term-label', has_text='teacher')).first
        await row.locator('.link-btn').click(); await pg.wait_for_selector('.view-review:not([hidden])')
        print('review:', await pg.inner_text('.view-review .view-count'), '|', await pg.inner_text('.review-filters .filter-chip'))
        marks = await pg.eval_on_selector_all('.view-review mark.term', 'ms => ms.map(m => m.textContent)')
        print('marked:', marks)
        assert marks
        await pg.screenshot(path=shot('s31-review-keyword.png'))

        # Print
        await pg.click('.nav >> text=Insights'); await pg.click('.view-insights .segmented >> text=Overview')
        await pg.evaluate("window.print = () => {}"); await pg.click('text=Print or save as PDF')
        await pg.emulate_media(media='print'); await pg.wait_for_timeout(200)
        await pg.screenshot(path=shot('s32-print.png'), full_page=True)
        pdf = await pg.pdf(path=str(SHOTS / 'insights-print.pdf'))
        print('print pdf bytes:', len(pdf), '| print title:', await pg.inner_text('.print-title'))
        await pg.emulate_media(media='screen')
        print('ERRORS', errors)
        await b.close()

asyncio.run(main())
