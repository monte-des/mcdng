# MCdng

This tool has been developed with Claude Opus 5.5, with the only purpose of being helpful through the master's thesis of the owner. It is not intended to harm or overstep existing coding tols (either open source or not), but to be tailored to the owner's needs. 
[M. Monterisi]

A local tool for qualitative coding of papers in a literature review. It works offline and keeps every project in a folder: on the computer in Google Chrome or Microsoft Edge, or on Google Drive from the iPad. It comes in three forms built from the same source:

- `dist/MCdng.html`: a single HTML file, opened with a double click.
- `dist/extension/`: the same app as a browser extension, which adds a **Save to MCdng** button to the toolbar.
- `dist/web/`: the same app as a web app, published at https://monte-des.github.io/mcdng/ by `.github/workflows/pages.yml` at every push to `main`. On the iPad it is added to the Home Screen and opens projects from Google Drive.

All three open the same projects. A project folder on Google Drive is opened on the computer through Google Drive for desktop and on the iPad through the web app.

## Using it

Open `dist/MCdng.html` in Chrome or Edge, or click the MCdng button and choose **Open MCdng** when the extension is installed. Choose **New project** and pick an empty folder, or **Open project** and pick an existing project folder. The browser asks once for permission to edit the folder.

A project folder contains:

- `README.txt`: a short description of the folder
- `project.json`: document metadata, codes, segments, framework, journal and history
- `documents/Authors Year - Title/`: one folder per paper with `original.pdf` (or `.docx`, `.txt`) and `extracted-text.json`; the folder is renamed when the paper's authors, year or title change
- `backups/`: a copy of `project.json` from each day the project was opened

Copy the folder to back up or move a project.

### On the iPad

Open https://monte-des.github.io/mcdng/ in Safari, then Share → **Add to Home Screen**. Projects open in two ways:

- **Open from Google Drive**: sign in with Google and choose the project folder, the same one the computer opens through Google Drive for desktop. Every file of the project is kept on the iPad too, so it works without a connection; changes go to Google Drive by themselves when there is one.
- **Open project file**: no account needed, and it works with iCloud Drive or anything the Files app reaches. On the computer, choose **Export project file** in the project menu (the folder button) and save the zip, for example on iCloud Drive; on the iPad, open it with Open project file. The project is then kept on the iPad. When you are done, tap **Export** next to the status and save the file; on the computer, choose **Import changes from a file**. A zip of the project folder made with the Finder's Compress opens too.

With the Apple Pencil, draw over a passage to select it and code it, or tap a coded passage to open it. With a finger, scroll as usual; a long press selects text, and **Code selection** codes it.

Close the project on one device before opening it on the other. If a project was changed on both, MCdng asks which version to keep and copies the other into `backups/`.

### Installing the extension

1. Open `chrome://extensions` (in Edge, `edge://extensions`) and turn on **Developer mode**.
2. Choose **Load unpacked** and select the `extension` folder.
3. Pin MCdng to the toolbar.

On the page of an article, or on its PDF (also a PDF shown inside a page or in a journal's e-reader, as on IEEE Xplore or Open Journal Systems), click the MCdng button: the PDF is downloaded with your own access and saved to the project open in MCdng, with the details the publisher's page declares. With no project open, the paper waits and is offered when one opens.

## Sections

- **Documents**: import PDF, Word (.docx) and text files. Titles, authors, journal, year and DOI are read from the file; with a connection, Crossref (or DataCite) completes them. Edit details and custom fields: text, options ticked in any number (such as Q1, Q2, Q3, SB) or coloured tags; options and tags also filter the Review.
- **Coding**: read a document as pages or as text, select a passage and assign codes and a memo.
- **Review**: filter and group coded segments; export them as CSV with their document metadata and the code hierarchy split into level columns (one row per segment, one row per segment and code, or a code matrix).
- **Codebook**: code definitions, framework, journal, the full change history and Insights. Nothing is deleted: codes are archived or merged, and every saved change is kept.
  - **Insights** (the last tab): an overview of the emerging themes and the keywords of the coded segments. Every table exports to CSV and the page prints or saves as PDF.

## Building

The app is written in plain JavaScript and CSS under `src/`. `build.py` writes both forms:

```
python3 build.py
```

Files in `src/js/` are concatenated in name order into one module:

| File | Role |
| --- | --- |
| `01-util.js` | DOM helper, formatting, colors, CSV |
| `02-disk.js` | Where projects are stored: folders on the computer (File System Access API), and the `Disk` interface |
| `01-zip.js` | Reading and writing zip files (Word documents, project files) |
| `02-drive.js` | Projects on the device: Google Drive sign-in, the Drive API, the copy on the device and its sync |
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
| `16-insights.js` | Insights, a tab of the Codebook: Overview and Keywords |
| `17-inbox.js` | Papers saved from the browser by the extension |
| `17-transfer.js` | Project files: carrying a project between devices as a zip |
| `18-main.js` | App shell and project lifecycle |

`src/web/` holds the web app's service worker, manifest and Home Screen icons (with the script that draws them). `src/extension/` holds the extension's own files: `background.js` (Save to MCdng), the popup, and the icons with the script that draws them.

`vendor/pdfjs/` holds the pdf.js 5.6.205 legacy build (Apache License 2.0). `vendor/fonts/` holds Figtree and Source Serif 4 (SIL Open Font License), which `build.py` embeds as `@font-face` rules.

`PRODUCT.md` describes the product and its user; `DESIGN.md` describes the visual system (tokens, section zones, type, components).

## Tests

`tests/` holds Playwright tests that drive the built app in headless Chromium, with the folder picker replaced by the browser's private file system and Crossref replaced by canned answers. `test_extension.py` loads the extension and saves papers from pages served on localhost. `test_drive.py` uses a fake Google Drive (`fakedrive.py`); `test_touch.py` codes with a simulated Apple Pencil and finger in an iPad-sized window. Install Playwright (`pip install playwright` and `playwright install chromium`), build, then run:

```
python3 tests/run_all.py
```

`HANDOFF.md` describes the project's context, decisions, data model and roadmap in detail.
