# SAP iFlow Doc Generator

Web app production-ready per generare documentazione tecnica, funzionale, handover, audit e training da ZIP SAP Integration Flow.

## Feature

- Upload ZIP iFlow (drag and drop + file picker)
- Multi-lingua UI e documenti: IT, EN, FR, DE
- Multi-template: tecnico, funzionale, handover, audit, training
- Modalita `deterministic` e `ai-enhanced` con fallback automatico
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
- Generazione documenti:
	- Documento Tecnico
	- Documento Funzionale
	- Documento Handover/Onboarding
	- Documento Audit
	- Documento Training
- Export Markdown + HTML
- Download singoli documenti + pacchetto ZIP finale
- Warning strutturati lato server
- Template custom via `templates/*.hbs` + `templates/config.json`
- Modalita deterministic-first con provider AI opzionali

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

Per la modalita deterministic-only non sono obbligatorie variabili ambiente.

Variabili opzionali supportate:

- GROQ_API_KEY
- OLLAMA_ENABLED (`true` per abilitarlo esplicitamente)
- OLLAMA_HOST
- OPENAI_API_KEY
- ANTHROPIC_API_KEY
- MCP_ENABLED (`true` per attivare enrichment opzionale)
- MCP_CONTEXT_ENDPOINT
- MCP_AUTH_TOKEN
- MCP_CONTEXT_TIMEOUT_MS

Se assenti, il sistema continua in fallback deterministic.

### MCP opzionale locale

Per testare MCP senza servizi esterni puoi usare il mock interno:

- Endpoint mock: `/api/mcp/mock-context`
- Variabili locali:
	- `MCP_ENABLED=true`
	- `MCP_CONTEXT_ENDPOINT=http://localhost:3000/api/mcp/mock-context`
	- `MCP_AUTH_TOKEN=` (opzionale)
	- `MCP_CONTEXT_TIMEOUT_MS=2500`

Se il mock (o un endpoint MCP reale) non risponde, la pipeline continua con provider AI standard e fallback deterministic.

## Struttura progetto

- src/app/page.tsx: UI singola pagina
- src/app/api/generate/route.ts: endpoint generazione
- src/app/api/docs/generate/route.ts: API pubblica JSON/base64
- src/app/api/sessions/route.ts: lista sessioni server
- src/app/api/sessions/[id]/route.ts: recovery sessione condivisa
- src/lib/errors.ts: gestione errori centralizzata
- src/lib/logger.ts: warning strutturati lato server
- src/lib/ai-enhancer.ts: enhancer AI opzionale con timeout e fallback
- src/lib/locales/*: dizionari runtime per UI e documenti
- src/lib/parsers/*: parser zip/xml/properties
- src/lib/pipeline/generate.ts: orchestrazione end-to-end, template engine e quality gate
- src/lib/session-store.ts: persistenza sessioni server su file temp
- src/lib/templates/*: registry e definizioni template
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
- templateIds: `technical|functional|handover|audit|training`[]
- mode: `deterministic|ai-enhanced`

Response JSON:

- sessionId
- sharePath
- warnings[]
- canonicalModel
- flowGraph
- qualityGate
- aiReport
- documents[]
- bundleBase64

### GET /api/sessions

Lista metadati sessioni server recenti.

### GET /api/sessions/:id

Recupera una sessione completa per preview/link condivisibile.

## Personalizzazione template

1. Modifica `templates/*.hbs` per cambiare la resa dei documenti.
2. Aggiorna `templates/config.json` per default selection e stima tempi.
3. Mantieni i placeholder coerenti con il contesto del generatore (`artifact`, `inputs`, `mapping`, `output`, `references`, ecc.).
4. Se rompi le heading minime, il quality gate puo fallire.

## Deploy su Render (step-by-step)

1. Push repository su GitHub.
2. In Render: New + Web Service.
3. Connetti il repository.
4. Render rileva render.yaml automaticamente.
5. Verifica impostazioni:
	 - Environment: Node
	 - Build Command: npm install && npm run build
	 - Start Command: npm run start
	 - Env vars opzionali: `GROQ_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OLLAMA_ENABLED`, `OLLAMA_HOST`, `MCP_ENABLED`, `MCP_CONTEXT_ENDPOINT`, `MCP_AUTH_TOKEN`, `MCP_CONTEXT_TIMEOUT_MS`
6. Deploy.
7. Apri URL Render e testa upload di uno ZIP iFlow.

### Configurazione Render consigliata

Profilo base (solo deterministic fallback):

- `MCP_ENABLED=false`
- `OLLAMA_ENABLED=false`

Profilo AI con Groq:

- `GROQ_API_KEY=<secret>`
- `GROQ_MODEL=llama-3.1-8b-instant`
- `GROQ_MAX_RETRIES=2`
- `MCP_ENABLED=false` (oppure `true` se vuoi enrich)

Profilo AI + MCP endpoint esterno:

- `MCP_ENABLED=true`
- `MCP_CONTEXT_ENDPOINT=https://<tuo-endpoint-mcp>/context`
- `MCP_AUTH_TOKEN=<secret-opzionale>`
- `MCP_CONTEXT_TIMEOUT_MS=2500`

## Note affidabilita

- Nessuna invenzione di valori: se dato non certo viene scritto "Non determinabile da zip".
- Se mancano file critici: errore bloccante con azione suggerita.
- Se mancano file non critici: warning e prosecuzione pipeline.

