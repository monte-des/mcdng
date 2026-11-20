"""Coding on a touch screen, as on the iPad: the Apple Pencil draws over text to select and code it (Text and Pages
views) and taps a segment to open it; a finger taps a segment, and a selection made with a finger gets a Code
button. Pencil strokes are dispatched as pen pointer events, which is what Safari sends for the Pencil."""

import asyncio
from harness import *

# Pointer events of a Pencil stroke from the start of one phrase to the end of another, inside the reader.
STROKE = """async ([fromText, toText, tap]) => {
  const host = document.querySelector('.reader-host');
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const find = text => { for (let n = walker.currentNode = host; (n = walker.nextNode());) { const i = n.data.indexOf(text); if (i >= 0) return [n, i]; } };
  const point = (text, atEnd) => {
    const [node, i] = find(text); const r = document.createRange();
    r.setStart(node, atEnd ? i + text.length - 1 : i); r.setEnd(node, atEnd ? i + text.length : i + 1);
    const b = r.getClientRects()[0]; return [atEnd ? b.right - 1 : b.left + 1, b.top + b.height / 2];
  };
  const [x0, y0] = point(fromText, false), [x1, y1] = tap ? [x0, y0] : point(toText, true);
  const fire = (type, x, y) => document.elementFromPoint(x, y).dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerType: 'pen', pointerId: 7, isPrimary: true, button: type === 'pointermove' ? -1 : 0,
    buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y, pressure: 0.5 }));
  fire('pointerdown', x0, y0);
  if (!tap) for (let k = 1; k <= 6; k++) { fire('pointermove', x0 + (x1 - x0) * k / 6, y0 + (y1 - y0) * k / 6); await new Promise(r => setTimeout(r, 16)); }
  fire('pointerup', x1, y1);
}"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 810, 'height': 1080}, has_touch=True, accept_downloads=True)
        await ctx.add_init_script(MOCK)
        await ctx.route(re.compile(r'https://api\.(crossref|datacite)\.org/.*'), lambda route: route.abort('internetdisconnected'))
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(f'PAGEERROR: {str(e)[:500]}'))
        await pg.goto('http://localhost:8765/MCdng.html')
        await newproject(pg)
        await pg.tap('.nav >> text=Coding')
        await pg.select_option('.doc-picker', label=await pg.evaluate("[...document.querySelectorAll('.doc-picker option')].find(o=>o.text.startsWith('notes')).text"))
        await pg.wait_for_selector('.text-body .block')

        # Pencil: a stroke over a passage opens the editor with it, without the keyboard.
        await pg.evaluate(STROKE, ['Teachers valued', 'planning time', False])
        await pg.wait_for_selector('.editor')
        quote = await pg.inner_text('.editor .quote, .editor .popover-quote, .editor blockquote')
        focused = await pg.evaluate("document.activeElement.tagName")
        print('pencil stroke:', repr(quote), '| focus on', focused)
        assert quote.startswith('Teachers valued') and quote.rstrip('.').endswith('planning time') and focused != 'INPUT'
        await pg.fill('.editor input.input', 'Planning'); await pg.keyboard.press('Enter')
        await pg.tap('.editor .btn.primary')
        await pg.wait_for_timeout(300)
        count = await pg.evaluate("MCdng.project.segments.length")
        print('segments:', count)
        assert count == 1

        # Pencil tap on the coded passage opens its segment.
        await pg.evaluate(STROKE, ['valued shared', None, True])
        await pg.wait_for_selector('.editor >> text=Delete segment')
        print('pencil tap: segment opened')
        await pg.tap('.editor .btn.subtle >> text=Cancel')

        # Finger tap on the coded passage opens it too.
        box = await pg.evaluate("""() => { const n = [...document.querySelectorAll('.text-body .block')].find(b => b.textContent.includes('valued shared')); const r = document.createRange();
          const t = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); let x; while ((x = t.nextNode())) { const i = x.data.indexOf('shared'); if (i >= 0) { r.setStart(x, i); r.setEnd(x, i + 3); break; } }
          const b = r.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }""")
        await pg.touchscreen.tap(*box)
        await pg.wait_for_selector('.editor >> text=Delete segment')
        print('finger tap: segment opened')
        await pg.tap('.editor .btn.subtle >> text=Cancel')

        # A selection made with a finger (long press) gets a Code selection button below it.
        await pg.evaluate("""() => { const n = [...document.querySelectorAll('.text-body .block')].at(-1); const t = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
          const x = t.nextNode(); const r = document.createRange(); r.setStart(x, 0); r.setEnd(x, Math.min(40, x.data.length)); getSelection().removeAllRanges(); getSelection().addRange(r); }""")
        await pg.wait_for_selector('.code-float:not([hidden])')
        await pg.screenshot(path=shot('t01-finger-selection.png'))
        await pg.tap('.code-float')
        await pg.wait_for_selector('.editor')
        print('finger selection → Code selection → editor:', repr((await pg.inner_text('.editor'))[:40]))
        await pg.tap('.editor .btn.subtle >> text=Cancel')

        # Pages view of a PDF: the Pencil draws over the text layer.
        await pg.select_option('.doc-picker', label=await pg.evaluate("[...document.querySelectorAll('.doc-picker option')].find(o=>o.text.startsWith('Smith')).text"))
        await pg.tap('.view-coding .segmented >> text=Pages')
        await pg.wait_for_selector('.text-layer span', timeout=20000)
        await pg.wait_for_timeout(800)
        await pg.evaluate(STROKE, ['Previous research', 'self-efficacy', False])
        await pg.wait_for_selector('.editor')
        quote = await pg.inner_text('.editor .quote, .editor .popover-quote, .editor blockquote')
        print('pencil on a PDF page:', repr(quote[:80]))
        assert quote.startswith('Previous research')
        await pg.screenshot(path=shot('t02-pencil-pdf.png'))
        print('ERRORS', errors)
        assert not errors
        await b.close()

asyncio.run(main())
