# MCdng design

The visual system of MCdng since 28 October 2026. It mixes two references the owner chose: Figma's black-and-white chrome with pill controls and almost no shadows, and Clay's soft radii; the ground was Clay's warm white until 20 November 2026, when the owner asked for a neutral near-white. Colour comes from two sources only: the codes (user data) and four pastel zone gradients, one per section, used on active states. Insights is a tab of the Codebook since the same day, so the top bar has four sections. All values live as custom properties at the top of `src/styles.css`.

## Principles

- The paper is the calmest, largest thing on the coding screen; chrome stays black, white and neutral grey.
- Every work area is a white sheet on the ground. Sheets have a 1px inset edge and no shadow.
- Shadows only on what floats: the segment editor, dialogs, toasts.
- Colour on the interface is pastel, with black text on top. No saturated chrome colour.
- One primary action per area, as a black pill.

## Tokens

| Role | Light | Dark |
| --- | --- | --- |
| Ground `--bg` | `#f6f6f8` | `#0f0f0f` |
| Sheet `--surface` | `#ffffff` | `#1a1a1a` |
| Soft fill `--surface-2` / track `--surface-3` | `#f4f4f6` / `#eaeaee` | `#232323` / `#2e2e2e` |
| Ink / secondary / muted | `#0d0d0d` / `#3a3a3f` / `#67676e` | `#f3f3f0` / `#cfcfca` / `#a3a39d` |
| Edges `--rule` / `--rule-soft` / `--rule-strong` | `#e6e6ea` / `#f0f0f3` / `#d2d2d8` | `#2b2b2b` / `#242424` / `#3d3d3d` |
| Primary (pill fill) | `#0d0d0d`, white text | `#f3f3f0`, black text |
| Memo (sticky note) | `#f6efd9` | `#312b1c` |

### Zones

Each section sets `body[data-view]`, which picks its zone. A zone has a gradient (`--zone`), a flat tint for selected rows (`--zone-tint`) and a darker ink of the same hue (`--zone-ink`).

| Section | Gradient | Tint (light) |
| --- | --- | --- |
| Documents | `#c3e5cc → #ddefb3` | `#e6f3e2` |
| Coding | `#c9b8f5 → #e8c9ef` | `#efe9fc` |
| Review | `#f7c5d6 → #ffd3b8` | `#fde8ea` |
| Codebook | `#f4dc9e → #f8c9a7` | `#fbefd8` |

Where a zone appears: the 2px edge of the current section in the top bar, the 2px edge of the selected Review card, the chosen coding approach in the Framework (filled), the drop-files overlay; tints on the selected document row, the selected code in the Codebook, the active option and the quote in the segment editor.

## Type

- Interface: **Figtree** (variable, 300–900), 14.5px body, 500 for controls and labels, 600 for titles. Titles use negative tracking: view title 28px at -0.025em, start wordmark 80px at -0.05em.
- Reading: **Source Serif 4** (variable, roman and italic) for the paper text (17.5px / 1.75), quotes on cards and segment lists.
- Both are embedded in the file by `build.py` from `vendor/fonts/` (Latin and Latin Extended subsets, SIL Open Font License).

## Shape

- Pills (999px) for buttons, segmented controls, tabs, chips, toasts and the section switch.
- Radii: 8px small rows, 12px inputs and inner blocks, 16px cards, 20px editor, 24px sheets and dialogs.
- Controls are 36px tall (28px small, 46px large). Gap between sheets and around the workspace: 16px.

## Components

- **Top bar**: the wordmark alone on the left; the four sections as an inset track (`--surface-3`) in the middle, the current one raised in white with its zone gradient as a 2px edge; save status (coloured dot and text) and the round project button on the right.
- **Segmented controls and side tabs**: the same inset track, the selected option raised in white with a hairline.
- **Buttons**: secondary is white with a 1px inset edge; primary is the black pill; subtle is text only; disabled primary is `--primary-disabled` with muted text.
- **Inputs**: white, 12px radius, 1px inset edge; focus thickens the edge to ink.
- **Cards** (Review): white, 1px edge, 16px radius; coding stripes on the left; memo as a sticky-note block.
- **Data tables** (Insights): 12.5px grey sentence-case headers on one rule, row rules in `--rule-soft`, right-aligned tabular figures, no zebra. A meter (8px pill in the zone gradient) shows a value against the largest one, with the figure beside it.
- **Heat matrix** (themes across papers): one hue, `--heat` (`#2d8db3`, dark `#4fb2d8`), mixed into the cell at up to 58% in proportion to the largest cell; empty cells stay blank so gaps read at a glance.
- **Print**: Insights prints on white without the top bar or controls, with a title line (project, page, date); table rows do not break across pages.
- **Details provenance** (Documents): a soft block (`--surface-2`, 12px radius) with where the bibliographic details came from and a small "Look up details" button. Comparisons of details ("Now / Found") are rows on hairlines in a wide dialog (860px); unchanged fields are muted, fields edited by hand carry "edited by you".
- **Document fields** (Documents): an options field is the inset track with every ticked option raised in white, as in segmented controls but several at once; a tag is a pill with its colour dot, outlined and muted when off, tinted with its colour (16% over the sheet) and edged at 50% when on; "New tag" is an outlined pill input at the end of the row. In the table, options and tags are 22px chips. In the fields dialog (600px) each field is a soft block with its options indented below.
- **Extension popup**: 320px, the wordmark, one state line in the status colour (done green, waiting amber, error red), one muted detail line and a secondary pill "Open MCdng"; a 3px top edge in the Coding zone gradient. System font, light and dark.
- **Extension icon**: an M in Figtree 700 on the Coding gradient, rounded square; no other mark, like the wordmark.
- **Touch (iPad)**: under `(pointer: coarse)` controls are 42px (small 34px), checkboxes 20px, inputs 16px; nothing appears only on hover. A finger selection shows a black pill "Code selection" below it (Safari's own menu is above). In portrait (801–900px) the status shows only its dot and the codes column is 236px. Sync status: "All changes on Drive", "Saved here · offline", "Saved here · syncing…", "Saved on this device" (project files), and a small secondary pill next to it when something is needed ("Sign in to sync", "Try again", "Choose", "Export").
- **Project menu**: the dialog lists its actions as soft rows (`--surface-2`, 12px radius), each with a muted hint line, and one primary Done.
- **Web app icon**: the extension's M on the Coding gradient, full bleed and opaque (iPadOS rounds it).
- **Start screen**: the wordmark and the project buttons on the plain ground. When a project is remembered, "Reopen" is the primary button.

## Not used

Gradients on text, buttons or grounds; coloured or offset shadows; icons in tinted squares; uppercase tracked labels; a graphic element in the logo.
