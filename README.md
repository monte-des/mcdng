# MCdng

A local tool for qualitative coding of papers in a literature review. It runs in Google Chrome or Microsoft Edge, works offline and keeps every project in a folder on your computer. It comes in two forms built from the same source:

- `dist/MCdng.html`: a single HTML file, opened with a double click.
- `dist/extension/`: the same app as a browser extension, which adds a **Save to MCdng** button to the toolbar.

Both open the same project folders.

## Using it

Open `dist/MCdng.html` in Chrome or Edge, or click the MCdng button and choose **Open MCdng** when the extension is installed. Choose **New project** and pick an empty folder, or **Open project** and pick an existing project folder. The browser asks once for permission to edit the folder.

A project folder contains:

- `README.txt`: a short description of the folder
- `project.json`: document metadata, codes, segments, framework, journal and history
- `documents/Authors Year - Title/`: one folder per paper with `original.pdf` (or `.docx`, `.txt`) and `extracted-text.json`; the folder is renamed when the paper's authors, year or title change
- `backups/`: a copy of `project.json` from each day the project was opened

Copy the folder to back up or move a project.

### Installing the extension

1. Open `chrome://extensions` (in Edge, `edge://extensions`) and turn on **Developer mode**.
2. Choose **Load unpacked** and select the `extension` folder.
3. Pin MCdng to the toolbar.

On the page of an article, or on its PDF (also a PDF shown inside a page, as on IEEE Xplore), click the MCdng button: the PDF is downloaded with your own access and saved to the project open in MCdng, with the details the publisher's page declares. With no project open, the paper waits and is offered when one opens.

## Sections

- **Documents**: import PDF, Word (.docx) and text files. Titles, authors, journal, year and DOI are read from the file; with a connection, Crossref (or DataCite) completes them. Edit details and custom fields: text, options ticked in any number (such as Q1, Q2, Q3, SB) or coloured tags; options and tags also filter the Review.
- **Coding**: read a document as pages or as text, select a passage and assign codes and a memo.
- **Review**: filter and group coded segments; export them as CSV with their document metadata and the code hierarchy split into level columns (one row per segment, one row per segment and code, or a code matrix).
- **Codebook**: code definitions, framework, journal and the full change history. Nothing is deleted: codes are archived or merged, and every saved change is kept.
- **Insights**: an overview of the emerging themes and the keywords of the coded segments. Every table exports to CSV and the page prints or saves as PDF.

## Building

The app is written in plain JavaScript and CSS under `src/`. `build.py` writes both forms:

```
python3 build.py
```

Files in `src/js/` are concatenated in name order into one module:

| File | Role |
| --- | --- |
| `01-util.js` | DOM helper, formatting, colors, CSV |
| `02-disk.js` | Project folder access (File System Access API) |
| `03-project.js` | State, autosave, queries and all changes with the history log |
| `04-extract.js` | PDF, DOCX and TXT text extraction, and what a PDF says about itself |
| `05-metadata.js` | Bibliographic details: from the file, and from Crossref or DataCite |
| `06-library.js` | Document folders: import, naming, renaming, upgrades |
| `07-ui.js` | Dialogs, toasts, chips, coding stripes |
| `08-reader.js` | Page and text readers, highlights and margin bars |
| `09-editor.js` | Segment editor |
| `10-documents.js` | View base class and Documents section |
| `11-coding.js` | Coding section |
| `12-review.js` | Review section and CSV export |
| `13-codebook.js` | Codebook section |
| `14-text.js` | Tokens, English stopwords and the Porter stemmer (no dependencies) |
| `15-analysis.js` | Keyword statistics, distinctiveness, theme overview, co-occurrence and similarity |
| `16-insights.js` | Insights section: Overview and Keywords |
| `17-inbox.js` | Papers saved from the browser by the extension |
| `18-main.js` | App shell and project lifecycle |

`src/extension/` holds the extension's own files: `background.js` (Save to MCdng), the popup, and the icons with the script that draws them.

`vendor/pdfjs/` holds the pdf.js 5.6.205 legacy build (Apache License 2.0). `vendor/fonts/` holds Figtree and Source Serif 4 (SIL Open Font License), which `build.py` embeds as `@font-face` rules.

`PRODUCT.md` describes the product and its user; `DESIGN.md` describes the visual system (tokens, section zones, type, components).

## Tests

`tests/` holds Playwright tests that drive the built app in headless Chromium, with the folder picker replaced by the browser's private file system and Crossref replaced by canned answers. `test_extension.py` loads the extension and saves papers from pages served on localhost. Install Playwright (`pip install playwright` and `playwright install chromium`), build, then run:

```
python3 tests/run_all.py
```

`HANDOFF.md` describes the project's context, decisions, data model and roadmap in detail.
