# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One researcher, the owner, coding the papers of a literature review. Sessions are long and focused: reading a paper, selecting passages, assigning codes, then reviewing and exporting the coded segments. Used on a desktop or laptop in Chrome or Edge, by day and in the evening; the theme follows the system setting, and light and dark are equally important.

## Product Purpose

MCdng is a personal, offline tool for qualitative coding of academic papers, in the spirit of Taguette and MAXQDA. It turns PDFs, Word files and text files into coded segments that can be filtered, reviewed, exported to CSV and grounded in a codebook whose history is never lost. Success means the owner can code a paper quickly, find any coded passage again, and trust that nothing is lost.

## Positioning

A single HTML file that keeps each project as a readable folder on the owner's own computer, with no server, account or internet connection. Every codebook change is kept in an append-only history.

## Operating Context

- Sections: Documents (import, metadata, and custom fields: text, options such as Q1–Q3 and SB, coloured tags), Coding (Pages and Text views of a paper, selection and the segment editor), Review (filters, grouped segment cards, document preview, CSV export), Codebook (codes, framework, journal, history).
- Papers are in English. The interface is entirely in English; conversation with the owner is in Italian.
- Codes carry one of 18 palette colours; overlapping codes show as diagonal stripes; coding stripes sit in the reader's margin.
- Insights (themes and keywords, Phase 2) is the last tab of the Codebook since 20 November 2026. Phase 3 so far: bibliographic details from Crossref and the Save to MCdng browser extension; Zotero and BibTeX/RIS import are possible next steps.

## Capabilities and Constraints

- On a computer: Chrome and Edge (File System Access API); opens from `file://`, as a browser extension or from its web address. On the iPad (8th generation, Apple Pencil 1st generation, from 20 November 2026): the web app on the Home Screen, with projects on Google Drive mirrored on the device; the same project folder is used on the Mac through Google Drive for desktop, one device at a time; works fully offline, so only fonts inlined into the file. With a connection, Crossref and DataCite complete bibliographic details; without one, MCdng behaves the same and the details come from the file or by hand (owner's requirement, 31 October 2026).
- Save to MCdng (extension): saves the PDF of the article open in the browser, downloaded with the owner's own access, into the project open in MCdng. Highlighting on publishers' pages was considered and not chosen.
- Built by `build.py` from plain JavaScript and CSS, no framework, as one HTML file and as an extension folder.
- Code colours are user data and must stay legible as highlights over reading text in both themes.

## Brand Commitments

- Name: MCdng.
- Nothing of the previous look is binding (owner's answer, 28 October 2026); the coding stripes concept may be kept or replaced.
- The owner asked for gradient details on buttons and active states, and elsewhere at the designer's discretion, while staying clean and clear in use.
- Must not feel cold and corporate, unintuitive, or visually dated even if practical.

## Evidence on Hand

Test fixtures in `tests/fixtures/` (a two-column PDF, a 30-page PDF, a DOCX, a TXT) are the only sample content. No real user data, logos or other assets exist.

## Product Principles

- Reading comes first: the paper's text is the largest, calmest thing on the coding screen.
- Every action is obvious from its control; no hidden gestures beyond selecting text.
- Nothing is lost: history and autosave are visible and trustworthy.
- One personal tool, not a team product: no accounts, no sharing chrome.
