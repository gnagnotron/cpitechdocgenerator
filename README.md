# SAP iFlow Doc Generator

Web app per generare un unico documento tecnico da ZIP SAP Integration Flow.

## Feature

- Upload ZIP iFlow (drag and drop + file picker)
- Multi-lingua UI e documento: IT, EN, FR, DE
- Unico output: Documento Tecnico
- API pubblica per generazione documenti (`/api/docs/generate`)
- Cronologia sessioni server + locale e recovery da link condivisibile
- Validazione struttura file critica/non critica
- Parsing deterministico di:
	- MANIFEST.MF
	- metainfo.prop
	- .iflw
	- .mmap
	- .xsd
- Modello JSON canonico unico con provenance e confidence per sezione
- Generazione di un unico Documento Tecnico
- Export Markdown + HTML
- Download singoli documenti + pacchetto ZIP finale
- Warning strutturati lato server
- Template tecnico customizzabile in `templates/technical.hbs`
- Estrazione esclusivamente deterministica dai file del package

## Stack

- Node.js + TypeScript (strict)
- Next.js (React + API routes server-side)
- Nessun database obbligatorio
- Deploy target: Render Web Service

## Requisiti

- Node.js >= 22
- npm >= 10

## Setup locale

1. Installa dipendenze:

```bash
npm install
```

2. Avvio sviluppo:

```bash
npm run dev
```

3. Build produzione:

```bash
npm run build
```

4. Avvio produzione locale:

```bash
npm run start
```

5. Test minimi:

```bash
npm run test
```

## Variabili ambiente

Non sono richieste variabili ambiente per la generazione: l'output dipende esclusivamente dal contenuto dello ZIP iFlow.

## Struttura progetto

- src/app/page.tsx: UI singola pagina
- src/app/api/generate/route.ts: endpoint generazione
- src/app/api/docs/generate/route.ts: API pubblica JSON/base64
- src/app/api/sessions/route.ts: lista sessioni server
- src/app/api/sessions/[id]/route.ts: recovery sessione condivisa
- src/lib/errors.ts: gestione errori centralizzata
- src/lib/logger.ts: warning strutturati lato server
- src/lib/locales/*: dizionari runtime per UI e documenti
- src/lib/parsers/*: parser zip/xml/properties
- src/lib/pipeline/generate.ts: orchestrazione end-to-end, template engine e quality gate
- src/lib/session-store.ts: persistenza sessioni server su file temp
- templates/technical.hbs: template dell'unico documento generato
- locales/*.json: catalogo lingua condiviso
- templates/*.hbs: template documenti personalizzabili
- tests/*.test.ts: unit test parser/generator
- samples/demo-output: output esempio
- render.yaml: deploy Render

## Documentazione tecnica

Per una guida tecnica orientata alla manutenzione del codice, vedi `TECHNICAL-README.md`.

Per una sintesi rapida orientata all'handover, vedi `HANDOVER-README.md`.

## API

### POST /api/generate

multipart/form-data:

- file: ZIP iFlow

Response JSON:

- warnings[]
- canonicalModel
- documents[] con markdown/html
- bundleBase64 (ZIP con tutti output)

### POST /api/docs/generate

application/json:

- zipBase64: string
- language: `it|en|fr|de`

Response JSON:

- sessionId
- sharePath
- warnings[]
- canonicalModel
- flowGraph
- qualityGate
- documents[]
- bundleBase64

### GET /api/sessions

Lista metadati sessioni server recenti.

### GET /api/sessions/:id

Recupera una sessione completa per preview/link condivisibile.

## Personalizzazione template

1. Modifica `templates/technical.hbs` per cambiare la resa del documento.
2. Mantieni i placeholder coerenti con il contesto del generatore (`artifact`, `inputs`, `mapping`, `output`, `references`, ecc.).
3. Se rompi le heading minime, il quality gate puo fallire.

## Deploy su Render (step-by-step)

1. Push repository su GitHub.
2. In Render: New + Web Service.
3. Connetti il repository.
4. Render rileva render.yaml automaticamente.
5. Verifica impostazioni:
	 - Environment: Node
	 - Build Command: npm install && npm run build
	 - Start Command: npm run start
6. Deploy.
7. Apri URL Render e testa upload di uno ZIP iFlow.

## Note affidabilita

- Nessuna invenzione di valori: se dato non certo viene scritto "Non determinabile da zip".
- Se mancano file critici: errore bloccante con azione suggerita.
- Se mancano file non critici: warning e prosecuzione pipeline.

