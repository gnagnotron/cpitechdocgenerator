# SAP iFlow Doc Generator MVP

Web app MVP production-ready per generare documentazione tecnica, funzionale e handover da zip SAP Integration Flow.

## Feature

- Upload ZIP iFlow (drag and drop + file picker)
- Validazione struttura file critica/non critica
- Parsing deterministico di:
	- MANIFEST.MF
	- metainfo.prop
	- .iflw
	- .mmap
	- .xsd
- Modello JSON canonico unico con provenance e confidence per sezione
- Generazione documenti:
	- Documento Tecnico
	- Documento Funzionale
	- Documento Handover/Onboarding
- Export Markdown + HTML
- Download singoli documenti + pacchetto ZIP finale
- Warning strutturati lato server
- Modalita deterministic-only (nessun provider AI richiesto)

## Stack

- Node.js + TypeScript (strict)
- Next.js (React + API routes server-side)
- Nessun database
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

Per MVP deterministic-only non sono obbligatorie variabili ambiente.

Variabili opzionali future (non necessarie ora):

- AI_PROVIDER
- AI_API_KEY

Se assenti, il sistema continua in deterministic-only.

## Struttura progetto

- src/app/page.tsx: UI singola pagina
- src/app/api/generate/route.ts: endpoint generazione
- src/lib/errors.ts: gestione errori centralizzata
- src/lib/logger.ts: warning strutturati lato server
- src/lib/parsers/*: parser zip/xml/properties
- src/lib/pipeline/generate.ts: orchestrazione end-to-end e template docs
- tests/*.test.ts: unit test parser/generator
- samples/demo-output: output esempio
- render.yaml: deploy Render

## API

### POST /api/generate

multipart/form-data:

- file: ZIP iFlow

Response JSON:

- warnings[]
- canonicalModel
- documents[] con markdown/html
- bundleBase64 (ZIP con tutti output)

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

