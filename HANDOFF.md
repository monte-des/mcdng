# MCdng: documento di passaggio di consegne

Questo documento riassume tutto il lavoro svolto su MCdng nella prima chat, per continuare il progetto in una nuova conversazione senza perdere contesto. Va letto insieme al pacchetto dei sorgenti `mcdng-source.zip`.

Stato al 28 ottobre 2026: **Fase 1 completata e testata**, più quattro giri di modifiche richieste dall'utente e un **restyling completo** (seconda chat, vedi sezione 9 e `DESIGN.md`). **Fase 2 completata** (sezione Insights, vedi sezione 8). Fase 3 avviata il 31 ottobre 2026 (terza chat): **metadati automatici** da file e Crossref, ed **estensione del browser** con "Save to MCdng" (sezioni 5 e 8). Il resto della Fase 3 è da fare.

---

## 1. Scopo e contesto

L'utente sta svolgendo una **literature review** e vuole un tool personale, usabile in locale, per la **codifica qualitativa dei paper** che legge, sul modello di Taguette (open source) e MAXQDA.

Requisiti originali dell'utente, tutti da soddisfare nell'arco delle tre fasi:

1. Evidenziare parti di testo da documenti PDF, Word e TXT.
2. Assegnare a ogni parte evidenziata uno o più tag (nel tool si chiamano **codes**).
3. Un colore per ogni code, gestendo il caso di più colori sullo stesso pezzo di testo.
4. Una sezione per rivedere solo i pezzi estratti, divisi per code o altri filtri.
5. Esportare i risultati in CSV.
6. Una sezione che conti automaticamente le **keyword tematizzanti** ricorrenti nei pezzi evidenziati (**Fase 2, da fare**).
7. Una pagina riassuntiva con tutti i dati utili alla ricerca e all'attività di coding (**Fase 2, da fare**).
8. Un logbook/codebook per livelli, metodologia (inductive/deductive/hybrid), analytical dimension e altre informazioni di codifica, che si aggiorna in continuo e **non elimina mai** le versioni vecchie o sostituite.

## 2. Preferenze dell'utente (da rispettare)

- **Lingue:** la conversazione è in **italiano**. Il tool è interamente **in inglese** (interfaccia, testi, codice, commenti, nomi di file).
- **Qualità del codice:** codice pulito e ordinato, nessuna stringa inutile, logica pensata bene, attenzione a come le sezioni comunicano tra loro. L'utente ha chiesto esplicitamente: "lavoro preciso e dettagliato, non avere fretta".
- **Modo di lavorare:** lavorare per fasi, fare domande quando serve chiarire, testare prima di consegnare.
- **Uso:** apertura semplice (doppio clic). Ha VS Code installato. Gli piacerebbe in futuro tenerlo aperto "in background tipo Zotero" e lavorare su fonti online senza scaricare i PDF.
- **Paper:** in inglese.
- **Viste dei PDF:** l'utente ha scelto di avere **entrambe**, impaginata (Pages) e testo (Text).
- **Nomi chiari:** tutto ciò che il tool crea su disco deve avere nomi leggibili e un'organizzazione comprensibile.
- **Nome del tool:** **MCdng** (scelto dall'utente; inizialmente si chiamava "Marginalia").
- **Stile grafico:** mix di due riferimenti scelti dall'utente (DESIGN di Figma e di Clay): interfaccia bianco e nero, pulsanti a pillola, niente ombre invasive, colori pastello e non forzati. Il logo è solo la scritta, senza elementi grafici. Dettagli in `DESIGN.md`.
- **Keyword (Fase 2):** l'utente preferisce il raggruppamento prudente, cioè lo stemming di Porter.
- **Export:** l'export che conta è quello della Review (i pezzi codificati con metadati e gerarchia dei code). Insights è secondaria e personale.
- **Rete:** MCdng deve funzionare allo stesso modo con e senza connessione. Senza rete i dati si leggono solo dal file o si scrivono a mano; Crossref è solo un arricchimento.
- **Fonti online:** scelta la strada "Save to MCdng" (salvare il PDF nella cartella del progetto aperto), non l'evidenziazione sulle pagine degli editori.

## 3. Cosa c'è da consegnare all'utente

- `MCdng.html`: il tool pronto all'uso, un unico file di circa 2,3 MB, offline.
- `MCdng-extension.zip`: la cartella dell'estensione per Chrome ed Edge (stessa app + pulsante "Save to MCdng"), da installare con "Load unpacked".
- `mcdng-source.zip`: sorgenti, script di build, librerie, test e questo documento.
- **Dal 20 novembre 2026 il codice sta su GitHub**: repository pubblico `monte-des/mcdng` (account dell'utente). Ogni push su `main` ricostruisce e pubblica la web app su **https://monte-des.github.io/mcdng/** (`.github/workflows/pages.yml`, GitHub Pages con sorgente "GitHub Actions"). È l'indirizzo da aggiungere alla schermata Home dell'iPad. L'app Claude di GitHub ha accesso a quel repository.

Le librerie sono dentro il file: non serve internet per usarlo.

## 4. Come si usa (lato utente)

1. Aprire `MCdng.html` con doppio clic in **Chrome o Edge**. Firefox e Safari non sono supportati, perché non permettono a una pagina di scrivere in una cartella del computer (File System Access API).
2. **New project** → scegliere una cartella vuota → dare un nome al progetto. Chrome chiede una volta il permesso di modificare la cartella.
3. Le volte successive: **Reopen "nome cartella"** dalla schermata iniziale, oppure **Open project**.
4. Importare i paper in **Documents** (pulsante o trascinamento), codificare in **Coding**, rivedere ed esportare in **Review**, gestire codici e metodologia in **Codebook**.

Il salvataggio è automatico. In alto a destra lo stato mostra "All changes saved", "Saving…" oppure "Not saved".

**Estensione (facoltativa):** `chrome://extensions` (o `edge://extensions`) → attivare "Modalità sviluppatore" → "Carica estensione non pacchettizzata" → scegliere la cartella `extension`, poi fissare l'icona MCdng nella barra. "Open MCdng" dal popup apre l'app in una scheda; sulla pagina di un articolo o sul suo PDF, un clic sull'icona salva il PDF nel progetto aperto. La versione estensione e `MCdng.html` aprono le stesse cartelle di progetto, ma ognuna ricorda la propria "ultima cartella" (la prima volta va usato "Open project").

## 5. Architettura tecnica

### Scelte di fondo
- **Un solo file HTML** generato da uno script di build, che inlinea CSS, pdf.js e il codice dell'app. Funziona aprendo il file da `file://`.
- **Nessun server, nessuna dipendenza esterna a runtime.** JavaScript e CSS puri, niente framework.
- **Dati su disco** tramite File System Access API (`showDirectoryPicker`): il progetto è una cartella vera, che si può copiare, sincronizzare o versionare.
- **IndexedDB** serve solo a ricordare l'handle dell'ultima cartella aperta, per il pulsante "Reopen".

### pdf.js
- Versione **5.6.205, build "legacy"**, salvata in `vendor/pdfjs/` con la sua licenza (Apache 2.0).
- Si usa la build legacy perché quella moderna usa `Map.prototype.getOrInsertComputed`, non ancora disponibile in Chrome stabile.
- Il worker gira nel **thread principale** ("fake worker"): il modulo del worker viene inlineato e registra `globalThis.pdfjsWorker`. Da `file://` un worker reale creato da blob si blocca, è stato verificato.
- Conseguenze accettate:
  - In console compare il warning "Setting up fake worker", innocuo.
  - L'import di un PDF lungo può bloccare l'interfaccia per poco tempo. Un PDF di 30 pagine si importa in meno di un secondo.
- Il build trasforma l'`export {…}` finale di `pdf.min.mjs` in `globalThis.pdfjsLib = {…}`.

### DOCX
Mammoth non era disponibile, quindi c'è un **lettore DOCX interno senza dipendenze** (`04-extract.js`):
- un mini lettore ZIP che usa `DecompressionStream('deflate-raw')`;
- il parsing di `word/document.xml` con `DOMParser`;
- titoli riconosciuti dai nomi di stile in `styles.xml` ("heading N", "title");
- elenchi riconosciuti da `numPr` oppure da stili il cui nome inizia con "list";
- i paragrafi annidati nelle caselle di testo e i blocchi `mc:Fallback` vengono saltati per evitare duplicati;
- titolo e autore letti da `docProps/core.xml`.

### Build
```
python3 build.py        →  dist/MCdng.html,  dist/extension/  e  dist/web/
```
`dist/web/` è la web app per GitHub Pages e per la schermata Home dell'iPad: `index.html` (la stessa pagina di `MCdng.html` con manifest, icona per la Home e registrazione del service worker), `sw.js` (da `src/web/sw.js`, con il nome della cache legato all'hash della pagina), `manifest.webmanifest`, `icons/` (disegnate da `src/web/icons/make_icons.py`: piene e opache, perché iPadOS arrotonda da sé e rende nera la trasparenza).
`src/template.html` contiene i segnaposto `/* @inline … */`. Per `MCdng.html` tutto viene inlineato. Per l'estensione gli script diventano file separati (`app.js`, `pdf.min.js`, `pdf.worker.min.js`) perché le pagine delle estensioni non eseguono script inline; gli stili restano inline; vengono copiati `src/extension/*`, le icone, le licenze, e viene scritto `manifest.json` (versione in `VERSION` dentro `build.py`). `/* @inline fonts */` genera le regole `@font-face` con i caratteri di `vendor/fonts/` in base64 (Figtree e Source Serif 4, sottoinsiemi Latin e Latin Extended, circa 0,3 MB). I file in `src/js/` vengono concatenati **in ordine di nome** in un unico modulo, quindi condividono lo stesso scope. Il build si ferma se un file inlineato contiene `</script` o `</style`.

### Struttura dei sorgenti
```
mcdng/
  build.py
  README.md                 guida tecnica breve (inglese)
  HANDOFF.md                questo documento
  PRODUCT.md                profilo del prodotto (utente, scopo, vincoli), in inglese
  DESIGN.md                 sistema visivo: token, zone, tipografia, componenti, in inglese
  src/
    template.html
    styles.css              token chiaro/scuro, layout, componenti
    js/
      01-util.js            h() per creare il DOM, uid, date, colori, paint() a strisce, CSV, download
      02-disk.js            Memory (IndexedDB) e Disk (lettura, scrittura, copia e rimozione nella cartella)
      03-project.js         stato, bus, Saver, Contents, query (Docs, Codes, Segs), Actions con log
      04-extract.js         estrazione PDF, DOCX e TXT nel formato canonico; pdfMetadata (XMP, Info, titolo stampato)
      05-metadata.js        fileMetadata, Lookup (Crossref, DataCite), Metadata.enrich in background
      06-library.js         cartelle dei documenti: import, nomi leggibili, rinomina, upgrade
      07-ui.js              Dialog, Toast, placeFloating, swatch, codeChip, stripes, emptyState, field
      08-reader.js          buildAtoms, mappatura offset↔DOM, barre nel margine, TextReader, PageReader, zoomControl
      09-editor.js          popover Editor per creare o modificare un segmento
      10-documents.js       classe base View e sezione Documents (con Look up details e Find details online)
      11-coding.js          sezione Coding
      12-review.js          SegmentPreview, sezione Review, export CSV
      13-codebook.js        sezione Codebook: Codes, Framework, Journal, History
      14-text.js            token, stopword inglesi, stemmer di Porter (senza dipendenze, testabile da solo)
      15-analysis.js        Analysis: statistiche delle keyword, distintività, temi, co-occorrenze, somiglianze
      16-insights.js        sezione Insights: Overview e Keywords, export CSV, stampa
      17-inbox.js           Inbox: paper salvati dall'estensione (attivo solo dentro l'estensione)
      18-main.js            App: shell, navigazione, apertura/creazione/chiusura progetto
    extension/
      background.js         service worker: Save to MCdng (lettura pagina, download PDF, inbox)
      popup.html/.js/.css   il popup del pulsante
      icons/                icone PNG e make_icons.py che le disegna
  vendor/pdfjs/             pdf.min.mjs, pdf.worker.min.mjs, LICENSE
  vendor/fonts/             Figtree e Source Serif 4 (woff2) con le licenze OFL
  dist/MCdng.html
  dist/extension/           l'estensione pronta da caricare
  tests/                    vedi sezione 10
```

### Flusso dei dati
- `project` è lo stato globale, caricato da `project.json`.
- **Ogni modifica passa da `Actions`**: aggiorna lo stato, scrive nel log se è un'entità del codebook, chiama `commit(...topics)`.
- `commit` avvia il salvataggio (`Saver`, con 600 ms di attesa) ed emette i topic sul `bus`.
  - Topic usati: `project`, `documents`, `codes`, `segments`, `fields`, `framework`, `journal`, `log`, `save`, `meta`, `keywords`.
- **Viste:** ogni sezione estende `View`.
  - Si ri-renderizza solo se visibile; i cambiamenti avvenuti mentre è nascosta vengono applicati quando torna visibile.
  - Più topic emessi dalla stessa azione vengono raggruppati in un solo aggiornamento con `queueMicrotask`.
- **Moduli e campi dei form:** dove l'utente scrive, il form non viene ricostruito mentre ha il focus o modifiche non salvate. Così non si perdono focus e testo, per esempio tabbando tra i campi.
- **Library:** le operazioni sulle cartelle dei documenti sono serializzate in una coda (`Library.run`), e le letture aspettano `Library.idle()`. Una rinomina non può quindi incrociare una lettura.

### Metadati bibliografici (terza chat)
- **Dal file, sempre e offline** (`pdfMetadata` in `04-extract.js`, `fileMetadata` in `05-metadata.js`):
  - XMP (`dc:title`, `dc:creator`, `prism:publicationName`, `prism:volume`, `prism:number`, `prism:coverDate`, `prism:doi`) e dizionario Info. Vengono scartati i titoli spazzatura come "Microsoft Word - …", "PII: …", nomi di file e titoli senza spazi.
  - **Titolo stampato:** il blocco con il carattere più grande nella parte alta della prima pagina (1-4 righe, almeno 1,25 volte la dimensione tipica della pagina), escluse le righe tipiche di testata ("journal", "doi", "©", "received"…). Le copertine (Taylor & Francis, JSTOR, "To cite this article") vengono saltate e si usa la pagina 2. Se titolo memorizzato e stampato divergono, vince quello stampato.
  - Rivista, volume e anno anche dal campo Subject in stile Elsevier ("Journal, 96 (2020) 103145"). Anno da ©, poi da "Published online", poi dal nome del file. DOI da XMP, Subject e prime 20.000 battute; ID arXiv → DOI `10.48550/arXiv.<id>`.
  - Un titolo preso dal nome del file è segnato in `meta.guessed` e non si usa mai per cercare online.
- **Online** (`Lookup`):
  - con il DOI: Crossref `api.crossref.org/works/{doi}`, poi DataCite `api.datacite.org/dois/{doi}`;
  - senza DOI: ricerca Crossref `query.bibliographic` (titolo + cognome del primo autore), con somiglianza dei titoli (coefficiente di Dice sulle parole): da 0,9 è "sicura", da 0,6 è "possibile", con -0,15 se l'anno differisce di più di 1;
  - un DOI trovato nel testo è accettato solo se il titolo del record somiglia almeno 0,5 a quello stampato, perché potrebbe essere il DOI di un riferimento citato;
  - timeout 10 secondi; ogni mancata risposta è un `OfflineError`, mai un errore mostrato durante l'import.
- **Applicazione:**
  - dopo l'import, `Metadata.enrich` lavora in background, un documento alla volta. Applica solo i match sicuri, mai sui campi modificati a mano (`meta.edited`), e si ferma al primo segno di assenza di rete;
  - "Look up details" (scheda del documento) e "Find details online" (barra di Documents) mostrano sempre un confronto prima di applicare;
  - le cartelle vengono rinominate come per le modifiche manuali.
- I documenti con lo stesso DOI di uno già presente non vengono importati.

### Estensione del browser (terza chat)
- **Manifest V3**, permessi `scripting` e `tabs`, `host_permissions: <all_urls>`. Nessuno script gira sulle pagine finché l'utente non clicca il pulsante.
- **`app.html`** è la stessa app di `MCdng.html`. Il File System Access API funziona anche nelle pagine delle estensioni.
- **Save to MCdng** (`background.js`):
  1. legge dalla pagina i meta tag Highwire/Dublin Core (`citation_title`, `citation_author`, `citation_publication_date`, `citation_journal_title`, `citation_volume`, `citation_issue`, `citation_firstpage`, `citation_lastpage`, `citation_doi`, `citation_pdf_url`);
  2. prova in ordine tre candidati e prende il primo i cui byte iniziano con `%PDF-`: il `citation_pdf_url` della pagina; l'indirizzo della scheda stessa; i PDF mostrati dentro la pagina (`iframe`, `embed`, `object` con "pdf" nell'indirizzo). Il PDF si riconosce dal contenuto e non dall'indirizzo: molti editori (IEEE Xplore `stamp.jsp` → iframe `getPDF.jsp`, proxy delle biblioteche) servono il PDF da indirizzi senza `.pdf`, e il visualizzatore di Chrome non dichiara `application/pdf` (bug segnalato dall'utente il 31 ottobre 2026, corretto);
  3. scarica ogni candidato dentro la pagina (con i cookie e l'accesso dell'utente) oppure, in alternativa, dal service worker;
  4. se nessun candidato è un PDF, il popup dice "No PDF found in this tab" (o, se l'editore dichiara un link, che il link ha restituito una pagina web); una scheda `file://` è un PDF già sul computer, da importare trascinandolo in Documents;
  5. il nome del file è quello dell'indirizzo se finisce in `.pdf`, altrimenti il DOI, altrimenti "Paper from <sito> <data>.pdf" (usato come titolo solo se né l'editore né il file ne danno uno);
  6. lo mette nell'**inbox**: l'IndexedDB `mcdng-inbox` dell'estensione, condivisa con `app.html`;
  7. avvisa l'app con `chrome.runtime.sendMessage({type:'inbox'})`.
- **Lato app** (`17-inbox.js`):
  - con un progetto aperto, importa subito con `Library.import(file, details)`. I dettagli dell'editore hanno `meta.source = 'publisher'`; poi Crossref completa in background;
  - senza progetto, il paper aspetta e viene proposto con un dialogo all'apertura di un progetto;
  - gli elementi vengono "presi" in un'unica transazione, così due schede di MCdng non importano lo stesso paper.
- **Popup:** stati "Saved to “Progetto”", "Saved, waiting for a project", "Not saved" (con il motivo) e il pulsante "Open MCdng".

### iPad e Google Drive (quinta chat, 20 novembre 2026)
Richiesta dell'utente: usare MCdng anche sull'iPad (8ª generazione, 2020, Apple Pencil di 1ª generazione), lavorando **sugli stessi dati del Mac, non in contemporanea**. Il progetto dell'utente sta sul suo **Google Drive personale** e il Mac lo apre attraverso Google Drive for desktop.
- **Perché Drive:** sull'iPad ogni browser usa WebKit, che non ha `showDirectoryPicker` (verificato su caniuse a novembre 2026). Un'app nativa che apre la cartella dall'app File è stata scartata: l'integrazione di Google Drive con File è fragile, e l'installazione con Xcode scade ogni 7 giorni senza Developer Program.
- **Due store, una interfaccia** (`02-disk.js`): `FolderStore` (File System Access, come prima) e `DeviceStore` (`02-drive.js`: i file del progetto sul dispositivo, in step con Drive oppure solo locali, vedi sotto). `Disk.mode` è `'folder'` dove esiste `showDirectoryPicker`, altrimenti `'drive'`; `?storage=drive` forza Drive (test). Il resto dell'app usa solo `Disk.*` con percorsi relativi alla cartella del progetto.
- **Accesso a Google** (`Google` in `02-drive.js`): flusso OAuth implicito con redirect (`response_type=token`), scope `https://www.googleapis.com/auth/drive` (serve tutto Drive perché i file del progetto li ha creati Drive for desktop, non MCdng). Il token dura un'ora e sta in `localStorage` (`mcdng.google`). All'apertura di un progetto si tenta un accesso silenzioso (`prompt=none`); quando scade, la barra mostra "Sign in to sync", che ricarica la pagina e torna nella stessa sezione. Google sconsiglia il flusso implicito per le SPA ma lo mantiene; il flusso con codice e PKCE richiederebbe un client secret per i client di tipo Web. Il client ID è pubblico per natura: Google lo accetta solo dall'origine e dal redirect registrati (`https://monte-des.github.io` e `https://monte-des.github.io/mcdng/`). `GOOGLE_CLIENT_ID` in `02-drive.js` contiene il client ID creato dall'utente il 20 novembre 2026 (progetto Google Cloud "MCdng", modalità Testing, la sua Gmail come utente di prova). Vuoto, sull'iPad il pulsante "Open from Google Drive" non compare.
- **Copia sul dispositivo** (`Mirror`, IndexedDB `mcdng-drive`): una voce per file e cartella con id su Drive, md5 dell'ultima versione in pari, contenuto (Blob o null se è solo su Drive), `dirty`, `rev`, `copyOf`; più la coda `trash`. Si salva sempre prima qui, poi si sincronizza: MCdng funziona offline come sul Mac.
- **Sincronizzazione** (`Sync`), un passo alla volta:
  - `pull`: elenca la cartella su Drive per livelli (gruppi di 40 cartelle per richiesta) e aggiorna la copia; i file rimossi sull'altro dispositivo spariscono, quelli cambiati là vengono riscaricati, e se `project.json` è cambiato su entrambi i lati segnala il conflitto;
  - `push`: invia i file cambiati (project.json per ultimo), crea le cartelle mancanti, sposta nel cestino di Drive (30 giorni) ciò che è stato rimosso; prima di sovrascrivere `project.json` controlla che su Drive l'md5 sia ancora quello noto;
  - le cartelle dei documenti rinominate usano la **copia lato Drive** (`files.copy`), quindi i PDF non vengono ricaricati;
  - `prefetch` scarica in background tutto ciò che manca (prima i testi estratti, poi i paper, mai `backups/`), così il progetto funziona offline.
- **Conflitti** (anche sul Mac): se `project.json` è cambiato sia qui sia sull'altro dispositivo, il dialogo "Changed on two devices" chiede quale versione tenere; l'altra viene copiata in `backups/conflict-<data>-other-device.json` o `-this-device.json`. Sul Mac (`Saver.unchanged` in `03-project.js`) prima di ogni salvataggio si confronta data e dimensione di `project.json` con l'ultima lettura o scrittura; se è cambiato ma il testo è identico si prosegue. Tornando in primo piano (`App.refresh`), se il file è stato cambiato altrove e qui non c'è nulla da salvare, il progetto si ricarica da solo con il messaggio "Updated with the changes saved on your other device".
- **Regola per l'utente:** chiudere il progetto su un dispositivo prima di aprirlo sull'altro, e lasciare a Drive for desktop il tempo di sincronizzare.
- **Web app** (`dist/web/`): service worker stale-while-revalidate (la versione nuova arriva all'apertura successiva); ignora le richieste a Google. Manifest `standalone`.
- **Tocco e Apple Pencil** (`11-coding.js`): la Pencil fa da evidenziatore (eventi `pointer` con `pointerType: 'pen'`; un `touchstart` con `touchType === 'stylus'` viene bloccato per fermare scroll e selezione di Safari solo per la penna); un tocco della Pencil o del dito su un passaggio codificato apre il segmento (`caretAt` + `pointIn`); una selezione fatta col dito (pressione lunga) mostra sotto il pulsante "Code selection". Sul touch l'editor non mette il fuoco nel campo di ricerca, per non aprire la tastiera sopra l'elenco dei code. Gli export usano il foglio di condivisione (`navigator.share` con file) e ripiegano sul download.
- **CSS:** `@media (pointer: coarse)` alza i controlli (42px, piccoli 34px), i campi a 16px (Safari non zooma), niente evidenziazione al tocco né selezione del testo dell'interfaccia; `@media (max-width: 900px) and (min-width: 801px)` per l'iPad in verticale (barra in alto con solo il pallino di stato, colonna dei code 236px).
- **Progetti via File, senza account** (`17-transfer.js`, `01-zip.js`; richiesta dell'utente: "vorrei entrambe le opzioni", anche con iCloud Drive). Dal browser non si può scrivere in iCloud Drive, quindi il progetto viaggia come **zip** attraverso l'app File (iCloud, Google Drive, AirDrop):
  - sul Mac, menu del progetto → **Export project file** (zip di `project.json`, `README.txt`, cartelle dei documenti e `mcdng-transfer.json`; niente `backups/`) e **Import changes from a file** (scrive i file nuovi, rimuove le cartelle di documenti che il progetto in arrivo non ha più, poi `project.json`, e ricarica);
  - sull'iPad, nella schermata iniziale **Open project file**: il progetto diventa un progetto "solo su questo dispositivo" (`DeviceStore` con `device: true`, id `device:<uid>`, nessuna sincronizzazione; la corrispondenza progetto→copia è in `Memory` sotto `device:<created>`). Riaprire lo stesso file su un progetto già presente ne porta dentro le modifiche. La barra mostra "Saved on this device" e il pulsante **Export** quando ci sono modifiche non ancora esportate;
  - **"in step"**: ogni dispositivo ricorda per progetto (`Memory`, chiave `step:<created>`) il `modified` dell'ultima versione in comune (dopo un export o un import). Lo zip porta questo valore come `base`. All'import, se la copia locale è cambiata dopo `base` e diversa da quella in arrivo, si chiede quale tenere ("Use the file's version" / "Keep this version"); l'altra va in `backups/conflict-…`;
  - funziona anche con uno zip fatto dal Finder (Comprimi): cartella in cima, `__MACOSX` e `.DS_Store` ignorati, voci deflate lette con `DecompressionStream`. Lo stesso lettore zip (`Zip.read`) serve ora anche per i DOCX (la vecchia classe in `04-extract.js` è stata tolta);
  - "New project" sull'iPad chiede dove: su Google Drive o solo su questo dispositivo.
- Il menu del progetto (pulsante con la cartella) è ora un elenco di azioni: Export project file, Import changes from a file (cartelle e progetti sul dispositivo, non Drive), Rename project, Close project.
- `globalThis.MCdng` espone `App`, `Sync`, `Saver`, `commit` e `project` per la console e i test.

### Modello del testo e delle codifiche
- Ogni documento viene convertito in un **testo canonico** (`content.text`). I segmenti sono intervalli `[start, end)` di offset in quel testo, e questo vale per entrambe le viste.
- `content.blocks`: elenco di `[start, end, type]`, con type tra `p`, `h1`…`h4`, `li`.
- `content.pages`, solo per i PDF: per ogni pagina `{w, h, start, end, items}`.
  - Ogni item è `[start, length, a, b, c, d, e, f, width, ascent]`, cioè la trasformazione pdf.js più larghezza e ascent.
  - Il testo dell'item non viene salvato una seconda volta: si ricava da `content.text`.
- `content.reflow = true` per i PDF: nella vista Text i singoli `\n` diventano spazi, mentre `\n\n` separa i paragrafi.
- **Ricostruzione del testo dai PDF:**
  - tra item sulla stessa riga si aggiunge uno spazio se c'è uno spazio visivo;
  - tra righe si mette `\n`; per un salto verticale ampio o un ritorno verso l'alto (nuova colonna) si mette `\n\n`;
  - le parole spezzate con trattino a fine riga vengono riunite senza a capo;
  - tra una pagina e l'altra si mette `\n\n`.
- **Mappatura DOM↔offset:** ogni elemento di testo ha l'attributo `data-s`, cioè l'offset del suo primo carattere.
  - `offsetAtPoint` converte un punto di una selezione in un offset.
  - `pointAt` converte un offset in un punto del DOM, con ricerca binaria.
  - I separatori (spazi o a capo tra item) non appartengono a nessuno span; le selezioni vengono ripulite dagli spazi iniziali e finali (`trimRange`).

### Sovrapposizioni e colori
- `buildAtoms` divide i segmenti sovrapposti in intervalli disgiunti, ciascuno con l'unione dei code che lo coprono.
- Un code solo dà uno sfondo semitrasparente. Più code danno **strisce diagonali** (`repeating-linear-gradient`) con tutti i colori.
- **Barre nel margine** (coding stripes): una per ogni coppia segmento-code. Vengono disposte in corsie, così i segmenti sovrapposti stanno affiancati. Cliccando una barra si modifica il segmento.
- Ordine dei code: sempre l'ordine dell'albero (`Codes.rank()`), così colori e chip sono stabili ovunque.
- Palette: 18 colori (`CODE_PALETTE`). Ogni nuovo code riceve il colore meno usato.

### Lettori
- **TextReader:** il testo dei blocchi viene spezzato in "pezzi" agli estremi degli atomi; i pezzi codificati hanno lo sfondo inline.
  - La selezione in attesa (testo selezionato, editor aperto) è disegnata come overlay separato. Così il testo non viene ricostruito mentre l'utente sta selezionando.
  - Le barre vengono ricalcolate quando cambia la dimensione (ResizeObserver).
- **PageReader:** le pagine vengono disegnate in modo pigro (IntersectionObserver con margine di 1200 px) e ciascuna ha:
  - canvas pdf.js;
  - `hl-layer` con rettangoli di evidenziazione (`mix-blend-mode: multiply`);
  - un **text layer ricostruito da MCdng**, con span trasparenti e selezionabili posizionati sopra i glifi.
  - Lo zoom va da "Fit width" a 75–200% e mantiene la posizione di lettura.
- **Insidia risolta (importante):** Chrome perde le selezioni col mouse su span compressi con `scaleX` minore di 1. Per questo, quando il testo va ristretto, il text layer usa una dimensione del carattere ridotta con `scaleY(1/ratio)` invece di `scaleX(ratio < 1)`.
  - Si usa `scaleX` solo se ≥ 1.
  - Il problema è stato isolato con bisezione su uno snapshot statico della pagina. Il text layer di pdf.js non lo mostrava solo perché, per caso, i suoi fattori erano maggiori di 1.
- `.page-reader` ha `width: max-content; min-width: 100%`, così con zoom alti si può scorrere fino al bordo sinistro.

## 6. Struttura di una cartella di progetto (lato utente)

```
<Cartella progetto>/
  README.txt                spiega il contenuto (scritto alla creazione o apertura se manca)
  project.json              tutto lo stato di MCdng
  backups/
    project-AAAA-MM-GG.json copia di project.json per ogni giorno in cui il progetto viene aperto
  documents/
    Smith & Lee 2021 - Teacher self-efficacy in inclusive classrooms/
      original.pdf          il file importato, intatto (oppure .docx, .txt, .md)
      extracted-text.json   il contenuto canonico (vedi sezione 5)
```

**Nomi delle cartelle:** "Autori Anno - Titolo".
- Gli autori seguono la forma della citazione: "Smith", "Smith & Lee", "Smith et al."; senza autori resta solo "Anno - Titolo".
- Caratteri non validi su Windows o macOS: `:` diventa `, `; `/` e `\` diventano `-`; gli altri vengono rimossi. Anche i punti e gli spazi finali vengono rimossi.
- Lunghezza massima 70 caratteri, tagliata a fine parola. Ai nomi riservati di Windows (CON, PRN…) si aggiunge " document".
- Se il nome è già usato si aggiunge " (2)", " (3)" e così via.
- **Rinomina automatica** circa 1,2 secondi dopo una modifica di autori, anno o titolo. Sequenza: copia nella nuova cartella → aggiornamento di `doc.folder` → salvataggio immediato di `project.json` → rimozione della vecchia cartella. Se fallisce, il documento resta nella cartella precedente e compare un avviso.
- Se cambiano **solo maiuscole e minuscole** la cartella non viene rinominata: su file system che non distinguono le maiuscole, la copia sovrascriverebbe i file.
- **Upgrade automatico** dei progetti creati con versioni precedenti (`documents/<id>/source.<ext>` e `content.json`) alla prima apertura.
- Vengono accettati anche i progetti con formato `marginalia/1`, il nome precedente del tool; vengono salvati come `mcdng/1`.

## 7. Schema di `project.json` (formato `mcdng/1`)

```js
{
  format: 'mcdng/1', name, created, modified,          // date in ISO 8601
  documents: [{
    id, folder,                                        // id interno; folder = nome cartella in documents/
    title, authors, year, journal, doi,                // authors: "Smith, J.; Lee, K."
    fields: { [fieldId]: value },                      // campi personalizzati: stringa (text) o array di id di opzioni (options, tags)
    memo, type: 'pdf'|'docx'|'txt',
    file: { name, ext, size },                         // nome originale del file importato
    pages,                                             // numero di pagine (solo PDF), altrimenti null
    added,
    volume, issue, articlePages,                       // terza chat; articlePages = intervallo di pagine dell'articolo ("401–417")
    meta: {                                            // provenienza dei dati bibliografici (terza chat)
      source: 'file'|'crossref'|'datacite'|'publisher',
      checked,                                         // ultima consultazione online, o null
      edited: [field],                                 // campi corretti a mano: mai sovrascritti in background
      guessed: [field]                                 // ['title'] se il titolo viene dal nome del file
    }
  }],
  fields: [{ id, name, type, options: [{ id, name, color }] }], // campi personalizzati; type 'text' | 'options' | 'tags'; color solo per i tag
  codes: [{
    id, name, color, parentId,                         // gerarchia: il livello è la profondità + 1
    origin: ''|'deductive'|'inductive',
    dimensionId,                                       // riferimento a framework.dimensions
    definition, inclusion, exclusion, example, notes,  // inclusion = "When to use", exclusion = "When not to use"
    archived, mergedInto, created, modified
  }],
  segments: [{
    id, docId, start, end,                             // offset nel testo canonico
    text,                                              // citazione salvata (PDF: righe riunite)
    page, pageEnd,                                     // solo PDF
    codes: [codeId], memo, created, modified
  }],
  framework: {
    questions, approach: ''|'inductive'|'deductive'|'hybrid', rationale, unit,
    levels: [{ id, name, description }],               // l'indice corrisponde al livello
    dimensions: [{ id, name, description }],
    notes, modified
  },
  journal: [{ id, category: 'decision'|'method'|'memo'|'issue', title, body, archived, created, modified }],
  keywords: { excluded: [string] },                    // parole o frasi escluse dalle keyword (Fase 2); i progetti vecchi la ricevono vuota
  log: [{                                              // registro append-only: non si cancella mai
    id, ts, kind: 'code'|'framework'|'journal'|'document',
    action: 'create'|'update'|'archive'|'restore'|'merge'|'import'|'remove',
    ref, label, before, after, note,
    segments                                           // solo nei merge: id dei segmenti ricodificati
  }]
}
```

Regole importanti:
- **I code non si cancellano mai.**
  - *Archive* nasconde il code dalla codifica. I segmenti che hanno solo code archiviati restano nel progetto ma vengono nascosti finché il code non viene ripristinato.
  - *Merge* ricodifica i segmenti sul code di destinazione, sposta i sottocodici e archivia il code d'origine con `mergedInto`.
  - Non si può archiviare un code con sottocodici attivi.
- **Le voci del journal** si archiviano, non si cancellano. Ogni modifica salva la versione precedente nel log.
- **Il framework** è salvato come snapshot completo a ogni salvataggio. Una dimensione analitica usata da almeno un code non si può rimuovere.
- **Modificare un segmento** dall'editor mantiene i code archiviati presenti sul segmento, anche se non vengono mostrati.
- **I segmenti** non vengono registrati nel log, per volume; si registrano solo i loro effetti nei merge. I documenti vengono registrati all'import e alla rimozione.

## 8. Funzionalità per sezione (stato attuale)

### Documents
- Tabella ordinabile con colonne **Reference** ("Smith & Lee (2021)"), **Authors** (elenco completo), Title, Journal or source, Type, Segments, Added. C'è una ricerca su tutti i metadati.
- Import da pulsante o trascinando i file sulla pagina, anche più file insieme. Formati accettati: `.pdf`, `.docx`, `.txt`, `.md`.
  - I dati bibliografici vengono letti dal file e poi, con la rete, completati da Crossref in background (sezione 5, "Metadati bibliografici"). Un toast dice quanti documenti sono stati completati.
  - Un file con stesso nome e stessa dimensione, o con lo stesso DOI, di uno già importato viene segnalato e non reimportato.
- **Find details online** (barra in alto): consulta Crossref per tutti i documenti con dati letti solo dal file. Poi mostra un elenco "Now / Found" in cui i match sicuri sono spuntati e quelli possibili no, e applica solo le righe spuntate.
  - Per i PDF senza testo selezionabile (scansioni) compare un errore che suggerisce l'OCR.
- **Scheda del documento** (pannello a destra):
  - citazione, file d'origine, numero di pagine, data di aggiunta e la riga "Stored in documents/…";
  - "Open for coding" e il numero di segmenti;
  - riquadro della provenienza ("Read from the file.", "From Crossref, 31 Oct 2026.") con **Look up details**: confronto campo per campo "Now / Found", con i campi corretti a mano non spuntati e una scelta tra più record se la corrispondenza non è sicura;
  - campi Title, Authors (separati da punto e virgola), Year, Journal, Volume, Issue, Pages, DOI con link, i campi personalizzati e il Memo;
  - campi personalizzati di tre tipi (quarta chat, 1 novembre 2026): **Text**; **Options**, una lista fissa a scelta multipla mostrata come binario con le opzioni attive in bianco (per esempio Q1, Q2, Q3, SB per domanda di ricerca e snowballing); **Tags**, tag colorati a scelta multipla, che si creano anche dalla scheda del documento (casella "New tag", Invio). Options e tags compaiono come colonne a chip nella tabella dei documenti, entrano nella ricerca, diventano filtri nella Review (un documento passa se ha almeno una delle opzioni spuntate; tra campi diversi valgono tutti) e nel CSV sono i nomi separati da punto e virgola. Nel dialogo dei campi le opzioni si aggiungono anche tutte insieme separate da virgole; un nome uguale (senza distinguere maiuscole) non si duplica; rimuovere un'opzione la toglie dai documenti, con conferma se usata;
  - in fondo **Edit document fields** (gestione dei campi personalizzati, che diventano anche colonne del CSV) e **Remove document**, con conferma; la rimozione cancella anche i segmenti del documento e viene registrata nella cronologia.
  - I campi si salvano quando escono dal focus.

### Coding
- Selettore del documento.
- Per i PDF, interruttore **Pages/Text** che mantiene la posizione di lettura passando da una vista all'altra, e zoom.
- **Selezione → editor:**
  - ricerca o creazione di un code (Invio crea; frecce per muoversi nell'elenco);
  - più code per segmento, mostrati come chip;
  - memo; Ctrl/Cmd+Invio salva; Esc chiude.
  - Se si seleziona esattamente un segmento già esistente, i code vengono uniti invece di creare un doppione.
- **Clic su testo codificato** apre il segmento in modifica (Delete segment, con conferma). Se nel punto ci sono più segmenti sovrapposti, compare prima una scelta.
- **Barra laterale:**
  - *Codes*: albero dei code con i conteggi nel documento. Il quadratino colorato mostra o nasconde le evidenziazioni di quel code; il nome filtra i segmenti; c'è un campo per creare nuovi code.
  - *Segments*: elenco dei segmenti del documento. Clic per scorrere al segmento ed evidenziarlo brevemente; pulsante Edit.
- I code creati durante la codifica hanno origin "inductive".

### Review
- **Filtri:**
  - testo (cerca nel testo e nel memo);
  - code, con Any/All e "Include subcodes";
  - documenti;
  - anno da/a;
  - "Only segments with a memo";
  - "Clear filters".
- Raggruppamento per code, per documento o nessuno.
- **Card del segmento:** strisce colorate, citazione (in serif), memo, **autori completi con anno e pagina**, **titolo**, chip dei code, pulsanti Open ed Edit.
- **Anteprima:** cliccando una card si apre un pannello a destra con il documento posizionato sul segmento evidenziato.
  - Si apre in Text; per i PDF si può passare a Pages, con zoom.
  - Mostra solo il segmento scelto. Cambiando segmento nello stesso documento scorre senza ricaricare.
  - Si aggiorna dopo le modifiche e si chiude con × o Esc. "Open in Coding" porta al punto esatto.
  - Selezionare testo dentro una card per copiarlo non apre l'anteprima.
- **Export CSV** dei segmenti filtrati. È **l'export principale del tool** per l'utente: i pezzi codificati con i metadati di base e la struttura corretta di codici e sottocodici (seconda chat). Insights è secondaria.
  - La gerarchia è sempre divisa in colonne per livello: `level_1`, `level_2`, … (tante quante la profondità massima dei code esportati). Se il Framework dà un nome al livello, diventa per esempio `level_1_theme`, `level_2_category`.
  - **One row per segment** (predefinito): `codes` (percorsi completi separati da "; "), `code_count` e, per ogni livello, i code del segmento a quel livello (separati da "; ").
  - **One row per segment and code** (formato "tidy", il più corretto per filtri e tabelle pivot): `code`, `code_path`, `level_1…n` (il percorso del code), `code_level`, `analytical_dimension`, `origin`.
  - **Code matrix**: una colonna per code usato, con i suoi antenati, in ordine di codebook; vale 1 se il segmento ha il code o un suo sottocodice, altrimenti 0.
  - formato e separatore restano memorizzati nel browser (`localStorage`, chiave `mcdng.csv`);
  - separatore virgola o punto e virgola (per Excel con impostazioni italiane);
  - UTF-8 con BOM; i valori che iniziano con = + - @ ricevono uno spazio davanti, per evitare che Excel li interpreti come formule;
  - colonne: `segment_id, document, authors, year, title, journal, doi, <campi personalizzati>, page, …codici…, text, memo, created, modified`.

### Codebook
- **Codes:**
  - elenco ad albero con ricerca, conteggi e "Show archived codes"; i code archiviati appaiono barrati con l'etichetta "Archived" o "Merged";
  - scheda con Name, Color, Parent code (il livello è mostrato con il nome del framework, per esempio "Level 2: Category"), Origin, Analytical dimension, Definition, When to use, When not to use, Example, Notes;
  - Save changes / Discard changes, con conferma se si lascia la scheda con modifiche non salvate;
  - azioni: Review N segments (apre Review filtrata), New subcode, Merge into another code, Archive / Restore code;
  - **History** del code con il prima/dopo di ogni campo;
  - **Export codebook CSV**.
- **Framework:** domande di ricerca, approccio (Inductive / Deductive / Hybrid, con spiegazione), motivazione, unit of analysis, **coding levels** (nomi per livello), **analytical dimensions**, note. Save framework salva una nuova versione; sotto c'è la cronologia con i confronti.
- **Journal:**
  - voci con categoria (Decision, Methodological note, Analytic memo, Open issue), titolo e testo;
  - una modifica conserva la versione precedente, visibile in "N earlier versions";
  - Archive/Restore e "Show archived entries".
- **History:** cronologia completa del progetto, filtrabile (code, framework, journal, documenti), con dettaglio espandibile del prima/dopo.

### Insights (Fase 2; dal 20 novembre 2026 ultima scheda del Codebook)
Sezione con due schede. Tutto è calcolato dai segmenti visibili (con almeno un code attivo) e non viene salvato, quindi i numeri coincidono sempre con Review e Codebook.
- **Overview**, centrata sui temi che affiorano (l'utente non voleva numeri di avanzamento):
  - *Themes*: per ogni code, con i sottocodici, segmenti, paper in cui compare ("2 of 12"), quota sui segmenti codificati (barra) e le parole più tipiche. Il nome apre le keyword del tema; il numero apre la Review filtrata.
  - *Themes across papers*: matrice code × documento con tinta proporzionale; le celle vuote mostrano le lacune; totali per riga e per documento.
  - *Themes coded together*: coppie di code sullo stesso passaggio, cioè sullo stesso segmento o su segmenti sovrapposti. Un passaggio è un tratto continuo in cui valgono entrambi i code (calcolato con `buildAtoms`). Mostra le prime 15 coppie.
  - *Themes with similar vocabulary*: coppie di code con vocabolario simile (coseno su vettori TF-IDF, un vettore per code dai suoi segmenti; soglia 0,1; massimo 12 coppie), con le parole condivise e i passaggi codificati insieme. Esclude le coppie padre-figlio.
- **Keywords**:
  - ambito: tutti i segmenti codificati oppure un code, con o senza sottocodici;
  - *Words*: radici di Porter, con la forma più frequente come etichetta e le varianti sotto;
  - *Phrases*: 2-3 parole consecutive senza stopword né punteggiatura in mezzo, mostrate solo se compaiono almeno 2 volte;
  - colonne: occorrenze (con barra), segmenti (apre la Review), paper e *Distinctiveness*;
  - *Distinctiveness*: z-score del log-odds ratio con prior di Dirichlet informativo (Monroe, Colaresi e Quinn 2008), calcolato contro tutti gli altri segmenti codificati. Sopra 2 il termine è chiaramente tipico del tema. È stato scelto al posto del TF-IDF perché è più stabile con pochi segmenti; il TF-IDF resta per la somiglianza tra temi;
  - ordinamento "Most frequent" oppure "Most distinctive" (quest'ultimo solo con un code scelto);
  - ricerca del termine; mostra i primi 200 termini, mentre il CSV li contiene tutti;
  - **Exclude** su ogni riga ed **Excluded words** (una voce per riga) salvati in `project.keywords.excluded`. Una parola esclusa conta come stopword ed esclude anche le sue varianti; una frase esclusa toglie solo quella frase.
- **Collegamento con la Review:** cliccando il numero di segmenti di un termine si apre la Review filtrata ("Keyword: teacher", rimovibile), con le occorrenze sottolineate nelle card.
- **Uscita:** export CSV per ogni tabella (separatore a scelta, come nella Review). "Print or save as PDF" stampa la scheda visibile su carta bianca, con titolo, nome del progetto e data.

### Shell
- Barra in alto: marchio con tre barrette colorate, nome del progetto (clic → Rename o Close project), navigazione, stato del salvataggio.
- Tema chiaro e scuro automatico, layout utilizzabile fino a circa 800 px di larghezza, `prefers-reduced-motion` rispettato.

## 9. Design

Restyling completo nella seconda chat (28 ottobre 2026); il riferimento è `DESIGN.md`, che va aggiornato a ogni cambiamento visivo durevole.

- **Riferimenti:** mix dei file DESIGN di Figma (bianco e nero, pillole, ombre quasi assenti, blocchi pastello) e Clay (fondo caldo, raggi morbidi), scelto dall'utente.
- **Struttura:** fondo caldo `#f5f4f0`; ogni area di lavoro è un foglio bianco arrotondato (24 px) con bordo sottile, senza ombra. Nessun cambiamento di layout rispetto alla Fase 1: stesse classi, stessi pannelli.
- **Barra in alto:** scritta "MCdng" a sinistra; le cinque sezioni (con Insights) al centro in una traccia incavata, quella attiva in bianco con il bordo nel gradiente della sua zona; a destra lo stato del salvataggio e il pulsante rotondo del progetto (Rename, Close). Il nome del progetto è nel titolo della scheda del browser.
- **Zone:** ogni sezione imposta `body[data-view]` e ha un gradiente pastello, una tinta e un inchiostro: Documents verde, Coding lilla, Review rosa-pesca, Codebook ambra. I colori dei code restano i dati e non si toccano.
- **Caratteri:** Figtree per l'interfaccia, Source Serif 4 per il testo dei paper e le citazioni, incorporati nel file.
- **Pulsanti:** primario nero a pillola; secondario bianco con bordo sottile. Le ombre restano solo su editor, finestre di dialogo e toast.
- **Schermata iniziale:** solo la scritta e i pulsanti; "Reopen" è il primario quando c'è un progetto da riaprire.
- **Metodo usato:** anteprime applicate al tool vero e scelte dall'utente in più giri (le prime proposte "Segnaletica" e "Prisma" sono state giudicate troppo simili all'originale). `PRODUCT.md` è stato scritto con l'utente all'inizio del restyling.

## 10. Test

- `tests/` contiene `harness.py`, le fixture (PDF a due colonne di 3 pagine, PDF di 30 pagine, DOCX con titoli ed elenchi, TXT, copie per i test sui nomi) e diciannove script `test_*.py`. `test_transfer.py` prova il giro Mac → iPad → Mac con gli zip, il conflitto, uno zip del Finder e la riapertura dal dispositivo. `test_drive.py` prova Google Drive con un Drive finto (`fakedrive.py`, che risponde via route di Playwright all'OAuth e all'API v3): nuovo progetto, import e codifica sincronizzati, cartella rinominata copiata da Drive, modifiche dall'altro dispositivo, conflitto, apertura offline con il PDF, secondo dispositivo vuoto, token scaduto. `test_folder_sync.py` prova i conflitti sul Mac con una cartella sincronizzata. `test_web_app.py` prova manifest, icone e service worker offline. `test_touch.py` prova Pencil (tratto e tocco, vista Text e Pages), tocco col dito e selezione col dito, in una finestra 810×1080 con touch. `test_document_fields.py` prova i tre tipi di campo (scheda, tabella, ricerca, filtro della Review, CSV, rimozione di un'opzione, riapertura) e il suggerimento sotto Parent code. `test_metadata.py` (fixture generate da `fixtures/make_metadata_fixtures.py`) verifica l'estrazione offline e il completamento da Crossref con risposte simulate. `test_extension.py` carica davvero l'estensione in Chromium e salva paper da pagine servite su `localhost:8766` (`fixtures/article.html`, `nopdf.html`, e due indirizzi che imitano IEEE Xplore: un PDF a un indirizzo senza `.pdf` e una pagina che lo mostra in un iframe). Il harness blocca per default ogni richiesta a Crossref e DataCite, così i test non dipendono dalla rete. `test_review_export.py` controlla con asserzioni i tre formati dell'export della Review, con un sottocodice e i nomi dei livelli. `test_insights.py` controlla anche lo stemmer di Porter sui casi di riferimento eseguendo `14-text.js` da solo, ed è un vero test con asserzioni.
- Avvio: `python3 tests/run_all.py`, dopo aver eseguito `python3 build.py`.
  - Servono Python, `pip install playwright` e `playwright install chromium`.
- **Come funzionano:**
  - servono `dist/` su `localhost:8765`;
  - sostituiscono `showDirectoryPicker` con il file system privato del browser (OPFS), perché OPFS non funziona su `file://`;
  - pilotano Chromium headless e salvano screenshot in `tests/screenshots/`.
- Sono **smoke test**: falliscono se c'è un'eccezione e stampano i risultati da controllare (conteggi, file su disco, CSV). Non sono asserzioni complete.
- **Chromium 153 e IndexedDB (28 ottobre 2026, seconda chat):** leggere da IndexedDB un handle di cartella OPFS fa crashare il browser (SIGTRAP), anche in una pagina vuota. Il mock in `harness.py` salva quindi in IndexedDB un segnaposto `{ opfsFolder: nome }` e lo riconverte in handle alla lettura. Il codice dell'app non cambia; con cartelle vere scelte da `showDirectoryPicker` il bug non è stato osservato (non si può verificare in headless).
- Il helper `select_text` crea selezioni programmatiche. `test_mouse_selection_dark.py` usa invece il **trascinamento reale del mouse**: è il test che ha scoperto il bug di `scaleX`.
- **Copertura:** creazione e riapertura del progetto, import dei tre formati, codifica in entrambe le viste, sovrapposizioni, editor, scelta tra segmenti sovrapposti, Review con filtri, raggruppamenti e anteprima, CSV, codebook completo (framework, merge, archive, journal, history), cartelle leggibili, rinomina, nomi duplicati, upgrade dei progetti vecchi, PDF lungo, tema scuro.
- I test sono stati eseguiti in un browser automatico, **non da una persona su Chrome reale**: al primo uso vero potrebbero emergere dettagli di interazione.

## 11. Limiti noti

- Cartelle sul computer: solo Chrome ed Edge desktop. Altrove (iPad, Safari) solo progetti su Google Drive, dalla web app.
- iPad: provato solo in Chromium con touch emulato e una Pencil simulata da eventi `pointer`, e con un Google Drive finto; il primo uso vero su iPad e con Google reale può far emergere dettagli (accesso nella web app a schermo intero, comportamento della Pencil con Safari). Il token di Google dura un'ora: dopo, "Sign in to sync" ricarica la pagina. La web app non ha l'estensione Save to MCdng: sull'iPad i PDF si salvano in File e si importano.
- I PDF scansionati vanno prima passati con l'OCR (fuori da MCdng).
- Nella vista Text dei PDF compaiono anche intestazioni, piè di pagina e numeri di pagina, perché sono testo del file. Con impaginazioni complesse l'ordine dei paragrafi può essere imperfetto; la vista Pages resta sempre fedele.
- I limiti di un segmento non si possono modificare: va cancellato e ricodificato.
- Non è possibile codificare selezionando il testo da tastiera, solo col mouse.
- Non c'è un "annulla" generale. Per i dati del codebook esiste lo storico; per i segmenti no.
- Due dispositivi aperti insieme sullo stesso progetto: `project.json` è protetto (dialogo "Changed on two devices", la versione scartata finisce in `backups/`), ma non c'è fusione automatica delle modifiche; due finestre sullo stesso computer non sono protette.
- Non c'è un'interfaccia per ripristinare un backup: si fa a mano copiando un file da `backups/` su `project.json`. Un backup precedente all'upgrade delle cartelle non è compatibile con la nuova struttura.
- La Review crea tutte le card insieme: con molte migliaia di segmenti potrebbe rallentare.
- Metadati online: Crossref non è stato provato dal vivo, perché l'ambiente di sviluppo non raggiunge la rete; le risposte sono simulate nei test con il formato reale dell'API. Senza DOI, la ricerca per titolo dipende dalla qualità del titolo letto dal PDF.
- Save to MCdng: alcuni editori dichiarano come `citation_pdf_url` una pagina-visualizzatore HTML invece del PDF (per esempio Wiley `epdf`). In quel caso il popup chiede di aprire il PDF e cliccare di nuovo. L'estensione si installa in modalità sviluppatore (nessuna pubblicazione sul Chrome Web Store).
- Insights: lo stemmer e le stopword sono solo per l'inglese. Con molti paper la matrice temi × documenti scorre in orizzontale sullo schermo, ma in stampa le colonne in eccesso vengono tagliate (meglio il CSV). La distintività e la somiglianza sono indicative con pochi segmenti.

## 12. Backup e GitHub (consiglio già dato)

- L'autosave e i backup giornalieri proteggono dagli errori, ma stanno sullo stesso disco.
- **Consigliato:** cartella del progetto dentro OneDrive, Google Drive o Dropbox, per avere una copia automatica e la cronologia delle versioni.
- **In aggiunta, facoltativo:** cartella come **repository GitHub privato** (contiene PDF protetti da copyright), con commit da VS Code o GitHub Desktop.
  - `project.json` è indentato apposta per avere differenze leggibili.
  - Attenzione al pull prima di lavorare su un altro computer.
- **Non** integrare GitHub dentro l'HTML: richiederebbe di conservare un token nel browser. Più avanti, con il server locale della Fase 3, si potranno fare commit Git automatici in modo sicuro.

## 13. Cosa resta da fare

### Fase 2: keyword e pagina riassuntiva (completata il 28 ottobre 2026, vedi sezione 8 "Insights")

Proposta originale, conservata per riferimento:

**Keywords** (requisito 6): conteggio automatico delle parole tematizzanti nei segmenti codificati. Proposta già condivisa con l'utente, da confermare con lui:
- tokenizzazione del testo dei segmenti, stopword inglesi, riduzione alla radice (stemming di Porter o lemmatizzazione leggera, per contare insieme "teacher", "teachers" e "teaching");
- n-grammi da 2 e 3 parole ("teacher education");
- conteggi totali, **per code** e per documento; frequenza e numero di segmenti in cui compare ogni termine;
- lista di esclusione personalizzabile (parole da ignorare) salvata nel progetto;
- dalla parola si arriva ai segmenti che la contengono (link alla Review filtrata);
- export CSV;
- possibile estensione: confronto tra code (termini caratteristici di un code rispetto agli altri, per esempio con un rapporto di frequenze o TF-IDF).

**Pagina riassuntiva** (requisito 7): una nuova sezione (per esempio "Overview") con:
- numeri del progetto: documenti, segmenti, code attivi e archiviati, memo, voci del journal;
- avanzamento della codifica: documenti codificati e non codificati, segmenti per documento, data dell'ultima attività;
- distribuzione dei code (con gerarchia e livelli) e matrice code × documento;
- co-occorrenze tra code (segmenti con più code o sovrapposti);
- riepilogo del framework (domande, approccio, livelli, dimensioni) e ultime decisioni del journal.

Scelte dell'utente: frequenze per code, espressioni di 2-3 parole e termini caratteristici (niente frequenze per documento); nella pagina riassuntiva i temi che affiorano, gli incroci tra temi e documenti e le keyword con la loro intensità (niente numeri di avanzamento); tabelle con export CSV e versione stampabile; una sola sezione "Insights" con due schede.

### iPad: da verificare con l'utente (20 novembre 2026)
1. Fatto: client OAuth creato dall'utente (progetto "MCdng", Google Drive API attiva, consenso External in Testing con la sua Gmail come utente di prova, scope `.../auth/drive`, client Web application con origine `https://monte-des.github.io` e redirect `https://monte-des.github.io/mcdng/`).
2. Fatto: client ID in `GOOGLE_CLIENT_ID`, pubblicato.
3. L'utente prova sull'iPad: Safari → indirizzo → Condividi → Aggiungi alla schermata Home → Open from Google Drive. Raccogliere i problemi del primo uso reale (accesso Google in modalità standalone, Pencil).

### Fase 3: integrazione e uso continuativo
- **Fatto (terza chat):** metadati da file e Crossref/DataCite; estensione del browser con "Save to MCdng". L'estensione copre anche l'idea di "tenerlo aperto come Zotero" senza server locale.
- **Scelta dell'utente:** niente evidenziazione sulle pagine degli editori, alla Hypothesis. Si salva il PDF nel progetto e si codifica in MCdng; è anche ciò che fa MAXQDA con il Web Collector.
- Da fare, se richiesto:
  - **Zotero 7**, che ha un'API locale da attivare nelle impostazioni, per importare PDF e metadati dalla libreria Zotero;
  - import BibTeX/RIS;
  - commit Git automatici, che richiederebbero un piccolo server locale o il "native messaging" dell'estensione.

### Miglioramenti possibili (backlog; idee, non richieste dell'utente)
- Modificare i limiti di un segmento trascinandone gli estremi.
- Collegare le voci del journal ai code.
- Annulla l'ultima azione (almeno per i segmenti).
- Scorciatoie da tastiera per codificare rapidamente (per esempio numeri per i code recenti).
- Rimuovere intestazioni e piè di pagina ripetuti nel testo dei PDF.
- Avviso quando il progetto è stato modificato altrove (controllo della data di `project.json`).
- Interfaccia per ripristinare un backup.
- Export completo del progetto (codebook con storico, journal) in un formato leggibile.
- Rendering incrementale della Review per progetti molto grandi.
- Nascondere il warning di pdf.js "Setting up fake worker".

## 14. Cronologia delle richieste nella prima chat

1. Fattibilità e uso in locale → proposta di un file HTML unico con cartella di progetto e roadmap in tre fasi. Domande sull'avvio (doppio clic), sulle viste PDF (entrambe) e sulla lingua dei paper (inglese).
2. **Fase 1** costruita e testata. Bug principale trovato e risolto: la selezione col mouse nella vista Pages, dovuta a `scaleX < 1`.
3. **Rinomina** da "Marginalia" a **MCdng**, con compatibilità per i progetti vecchi. Discussione su backup e GitHub (sezione 12).
4. **Cartelle leggibili** in `documents/` ("Autori Anno - Titolo" con `original.<ext>` ed `extracted-text.json`), README.txt nel progetto, rinomina automatica, upgrade dei progetti vecchi. Nuovo modulo `05-library.js` (oggi `06-library.js`).
5. **Ultime modifiche:**
   - colonna Authors in Documents;
   - autori completi e titolo nelle card della Review;
   - **anteprima del documento** cliccando una card;
   - "Document fields" spostato nella scheda del documento, in basso prima di "Remove document";
   - corretto lo scorrimento orizzontale con zoom alti;
   - controllo dello zoom condiviso tra Coding e anteprima.

L'utente ha giudicato il risultato "un ottimo inizio, buon funzionamento".

**Seconda chat (28 ottobre 2026):**
6. Ricostruzione e test: build identico al precedente; corretto il mock dei test per un crash di Chromium 153 (sezione 10).
7. **Restyling** in più giri con anteprime (sezione 9 e `DESIGN.md`); l'utente lo ha approvato ("molto meglio, mi piace"), con le ultime correzioni a homepage e barra delle sezioni.
8. **Fase 2**: sezione Insights (Overview e Keywords), filtro per keyword nella Review, nuovo test `test_insights.py`.
9. **Export della Review** rivisto su richiesta dell'utente (è l'export che conta): colonne per livello della gerarchia dei code, tre formati, preferenze ricordate.

**Terza chat (31 ottobre 2026):**
10. **Metadati automatici** come in Zotero: lettura dal file sempre (anche offline), completamento da Crossref/DataCite con la rete, Look up details e Find details online con revisione, nuovi campi Volume, Issue, Pages (anche nel CSV come `volume`, `issue`, `article_pages`).
11. **Estensione "Save to MCdng"**: MCdng come estensione di Chrome/Edge; un clic sulla pagina di un articolo salva il PDF nel progetto aperto. Moduli rinumerati (05-metadata, 17-inbox).
12. **Correzione di Save to MCdng**: i PDF aperti nel visualizzatore di Chrome con un indirizzo senza `.pdf` e i PDF dentro un iframe (IEEE Xplore) davano "This page does not link a PDF". Ora il PDF si riconosce dai primi byte; due nuovi casi in `test_extension.py` (server locale che imita IEEE).

**Quinta chat (19–20 novembre 2026):**
15. **Estensione "Impossibile accedere al file"**: Chrome legge un'estensione non pacchettizzata dalla sua cartella; i file erano stati spostati o tolti da iCloud ("Ottimizza spazio"). Spiegato all'utente di tenere la cartella fuori da iCloud e ricaricarla.
16. **GitHub e iPad**: repository `monte-des/mcdng`, pubblicazione su GitHub Pages, versione per iPad con progetti su Google Drive, Apple Pencil e interfaccia al tocco, conflitti tra dispositivi anche sul Mac (vedi sezione 5 "iPad e Google Drive").
17. **File di progetto** (zip attraverso File, anche iCloud): vedi sezione 5.
18. **Insights dentro Codebook**: Insights non è più una sezione della barra in alto ma l'ultima scheda del Codebook, dopo History (`CodebookView` crea `InsightsView` e la mostra o nasconde; la vista tiene i suoi topic e le sue sotto-schede Overview e Keywords, con "Print or save as PDF" nella riga sotto le schede). La zona azzurra di Insights è stata tolta.
19. **Fondo neutro**: il fondo e i grigi non hanno più la tinta calda (`--bg` #f6f6f8). Due bozze di restyle (Material 3 completo, poi colori di sezione sui pulsanti) sono state mostrate e rifiutate dall'utente; non sono state pubblicate.
20. **Colori delle opzioni**: ogni opzione di un campo Options prende a turno il colore di una sezione (Documents, Coding, Review, Codebook, Insights; `OPTION_ZONES` in `03-project.js`, salvato come l'inchiostro della sezione in `option.color`). Un'opzione scelta ha il bordo con il gradiente pastello della sezione, come la sezione attiva nella barra in alto; il colore segna l'opzione anche nella tabella dei documenti e nei filtri della Review. Le opzioni dei progetti esistenti ricevono i colori all'apertura; un colore cambiato a mano in Edit document fields fa da bordo pieno.
21. **Pagina bianca sull'iPad**: il codice dell'app aveva tre espressioni regolari con lookbehind (`(?<!…)`), che Safari legge solo dalla 16.4: su un iPadOS più vecchio l'intero modulo non partiva. Tolte (`yearIn` in `01-util.js`, e la riflow del testo in `03-project.js` con un gruppo al posto del lookbehind); `Array.prototype.at` e `structuredClone` (Safari 15.4) hanno un sostituto. Minimo ora: Safari 15 (iPadOS 15), verificato con esbuild sulla sintassi; pdf.js 5.6 legacy potrebbe chiedere di più per i PDF. Se il browser non riesce comunque a far partire l'app, uno script classico in `template.html` mostra "MCdng could not start" con l'errore invece della pagina vuota (tolto dalla pagina dell'estensione, dove gli script inline non sono ammessi). WebKit per Playwright non si può scaricare in questo ambiente, quindi Safari non è provato direttamente.

**Quarta chat (1 novembre 2026):**
13. **Campi dei documenti di tipo Options e Tags** (vedi Documents e il modello dati); domanda dell'utente: Q1, Q2, Q3, SB a scelta multipla e tag colorati.
14. **Parent code**: l'utente non riusciva a scegliere un parent in un codebook ancora vuoto. Non era un bug: i livelli del Framework danno solo un nome alle profondità dell'albero, e un code è di livello 2 quando ha un parent. Ora, se non c'è ancora nessun code, sotto Parent code un suggerimento spiega di salvare prima un code di livello 1 e poi usare New subcode.

## 15. Come ripartire nella nuova chat

1. Caricare `mcdng-source.zip` e questo documento.
2. Chiedere di leggere `HANDOFF.md` e `README.md`, ricostruire con `python3 build.py` ed eseguire `python3 tests/run_all.py` per verificare che tutto funzioni.
3. Indicare la prossima attività. Normalmente è la Fase 2: prima chiarire con l'utente cosa vuole vedere nella pagina keyword e in quella riassuntiva, poi sviluppare.
4. Mantenere le convenzioni:
   - modifiche nei moduli giusti;
   - stato cambiato solo tramite `Actions`;
   - nuove sezioni come sottoclassi di `View` con i loro topic;
   - testi dell'interfaccia in inglese;
   - test con il harness prima di consegnare;
   - consegna di `MCdng.html` più lo zip aggiornato dei sorgenti.
