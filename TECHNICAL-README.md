# Technical README

## 1. Purpose

This project generates technical and functional documentation from a SAP Integration Flow ZIP package.

The application:

- accepts a ZIP export of a SAP iFlow
- extracts relevant metadata and design artifacts
- builds a canonical internal model
- renders one or more output documents from Handlebars templates
- optionally enriches the generated documents with an AI addendum
- stores generated sessions for later recovery and sharing

This file is intended as the technical onboarding document for future maintenance.

## 2. Stack and Runtime

- Framework: Next.js 16
- UI: React 19
- Language: TypeScript
- Styling: global CSS + Tailwind v4 import
- Templating: Handlebars
- XML parsing: fast-xml-parser
- Runtime requirement: Node.js >= 22
- Persistence: file-based temp storage on server, IndexedDB in browser

## 3. High-Level Architecture

The project is split into five layers:

1. UI layer
   - Single-page client interface for upload, options, preview and history.
2. API layer
   - Thin server routes that validate input, invoke the generation pipeline and return JSON.
3. Parsing layer
   - Extracts data from ZIP, iFlow XML, mapping files, XSD files and properties files.
4. Pipeline layer
   - Builds the canonical model, renders documents, runs AI enhancement and applies the quality gate.
5. Storage layer
   - Saves generation sessions on disk and stores recent metadata in the browser.

## 4. End-to-End Flow

### 4.1 Browser flow

The main page is in `src/app/page.tsx`.

The UI lets the user:

- upload a `.zip`
- choose the language
- choose deterministic or AI-enhanced mode
- select one or more document templates
- preview generated markdown or HTML
- browse recent server and local sessions

When the user starts generation, the page submits either:

- `multipart/form-data` to `/api/generate`
- or JSON with `zipBase64` to `/api/docs/generate`

### 4.2 API flow

The key API routes are:

- `src/app/api/generate/route.ts`
- `src/app/api/docs/generate/route.ts`
- `src/app/api/sessions/route.ts`
- `src/app/api/sessions/[id]/route.ts`
- `src/app/api/ai/status/route.ts`

Responsibilities of the API routes:

- validate request payloads
- reject invalid or missing ZIP uploads
- create a session id
- invoke `generateFromZipBuffer(...)`
- persist the generated session
- return documents, canonical model, warnings, quality gate and bundle ZIP

The API routes deliberately contain very little business logic. Most changes should happen in `src/lib`.

### 4.3 Pipeline flow

The main orchestrator is `src/lib/pipeline/generate.ts`.

The runtime flow is:

1. `parseZipArtifacts(zipBuffer)`
2. `buildCanonicalModel(parsed)`
3. `createDocuments(parsed, model, language, templateIds, mode)`
4. `buildFlowGraph(parsed)`
5. `evaluateQualityGate(documents, model, selectedTemplateIds)`
6. return `GenerationResult`

If the quality gate fails, the pipeline throws an application error and the API returns a 422 response.

## 5. Directory Guide

### 5.1 Root files

- `package.json`
  - scripts, dependency list and Node.js version requirement
- `README.md`
  - product-oriented project overview
- `TECHNICAL-README.md`
  - this technical maintenance guide
- `render.yaml`
  - Render deployment settings
- `tsconfig.json`
  - TypeScript compiler configuration
- `eslint.config.mjs`
  - ESLint configuration
- `next.config.ts`
  - Next.js configuration

### 5.2 `src/app`

This is the web layer.

- `layout.tsx`
  - root app layout, metadata and fonts
- `globals.css`
  - global styling, theme variables and markdown preview styles
- `page.tsx`
  - main UI and client-side orchestration

### 5.3 `src/app/api`

This is the server route layer.

- `api/generate/route.ts`
  - handles browser uploads using `FormData`
- `api/docs/generate/route.ts`
  - public JSON API using `zipBase64`
- `api/sessions/route.ts`
  - returns recent saved session metadata
- `api/sessions/[id]/route.ts`
  - restores one saved session
- `api/ai/status/route.ts`
  - tells the UI whether AI providers are configured

### 5.4 `src/lib`

This is the real implementation layer.

- `pipeline/generate.ts`
  - project core; most generation behavior is controlled here
- `parsers/*`
  - specialized parsers for ZIP, XML, mappings and property files
- `templates/*`
  - template registry and template definitions
- `locales/*`
  - runtime locale dictionaries used by both UI and generated documents
- `ai-enhancer.ts`
  - optional AI enrichment with provider fallback
- `session-store.ts`
  - file-based server session persistence under `.tmp/sessions`
- `client/session-history.ts`
  - browser IndexedDB history storage
- `types.ts`
  - shared domain contracts across UI, API and pipeline
- `errors.ts`
  - structured application errors and HTTP error mapping
- `logger.ts`
  - structured warning and AI event logging
- `plugins/registry.ts`
  - file parser plugin registry

### 5.5 `templates`

This folder contains the Handlebars document templates.

- `technical.hbs`
- `functional.hbs`
- `handover.hbs`
- `audit.hbs`
- `training.hbs`

These files define the final Markdown layout of each generated document.

### 5.6 `tests`

This folder contains Node test runner tests for parsers and the document generation pipeline.

Important files include:

- `document-generation.test.ts`
- `iflw-parser.test.ts`
- `mmap-parser.test.ts`
- `real-zips.test.ts`

### 5.7 `samples`

Example generated output used as reference material.

### 5.8 `public`

Static public assets. This folder is currently not central to the core logic.

## 6. Core Domain Objects

The central data contracts live in `src/lib/types.ts`.

The most important types are:

- `ParsedZipArtifacts`
  - output of the ZIP parsing phase
- `CanonicalModel`
  - normalized representation of the iFlow extracted from the package
- `GeneratedDocument`
  - one generated output document in markdown and HTML form
- `GenerationResult`
  - full pipeline output
- `SessionRecord`
  - persisted server-side generation session
- `FlowGraph`
  - graph-friendly representation of flow elements and routes
- `QualityGateReport`
  - validation summary for generated documents

If you need to understand what the application considers "the truth", start from `types.ts` and then open `pipeline/generate.ts`.

## 7. Parsing Layer Details

### 7.1 ZIP parser

`src/lib/parsers/zip.ts` contains a custom ZIP reader/writer.

It:

- reads the ZIP central directory manually
- inflates deflated entries
- exposes entries as `{ fileName, data }`
- can also create a ZIP bundle for generated output

This means the project does not rely on `adm-zip`, `yauzl` or similar libraries.

### 7.2 iFlow parser

`src/lib/parsers/iflw.ts` parses `.iflw` XML files using `fast-xml-parser`.

It extracts:

- flow elements
- participants
- processes
- steps
- routes
- sender systems
- receiver systems
- channels
- custom properties found in extension elements

If the application misunderstands process structure, routing or channel metadata, this file is the first place to inspect.

### 7.3 Mapping parser

`src/lib/parsers/mmap.ts` parses `.mmap` files.

It extracts:

- source messages
- target messages
- rules
- function libraries
- raw link roles used to reconstruct mapping relationships

If a generated document misses mapping detail, inspect this parser first.

### 7.4 Text/property parser

`src/lib/parsers/text.ts` handles:

- Java-style `.prop` files
- `MANIFEST.MF`
- parameter definition XML fragments

This is where artifact id, version and runtime parameters are often sourced from.

### 7.5 XSD parser

`src/lib/parsers/xsd.ts` extracts schema-level details from `.xsd` files.

## 8. Canonical Model Construction

The canonical model is built in `buildCanonicalModel(...)` inside `src/lib/pipeline/generate.ts`.

It normalizes source data into these sections:

- `artifact`
- `ingressi`
- `processi`
- `stepERouting`
- `mappingERegole`
- `arricchimenti`
- `output`
- `dipendenze`
- `assunzioniEGap`

Each section includes:

- `provenance`
- `confidence`
- `data`

This is a useful design choice: every generated section knows whether it was derived from files, rules or AI.

## 9. Document Rendering

Document generation happens in `createDocuments(...)` in `src/lib/pipeline/generate.ts`.

The rendering sequence is:

1. load locale messages
2. build template context
3. choose the Handlebars template by template id
4. render Markdown
5. convert Markdown to HTML
6. optionally enrich the Markdown with AI
7. rebuild HTML from the final Markdown

Templates are compiled in `src/lib/templates/registry.ts` from the `templates/` folder.

The runtime template catalog is defined in `src/lib/templates/definitions.ts`.

This file currently controls:

- available template ids
- default selected templates
- estimated generation times
- AI eligibility
- required headings metadata

## 10. AI Enhancement

The deterministic pipeline always runs first.

AI is an optional post-processing step handled by `src/lib/ai-enhancer.ts`.

Supported providers:

- Groq
- OpenAI
- Anthropic
- Ollama

Behavior:

- if no provider is configured, generation still succeeds
- if the AI request times out or fails, the system falls back to deterministic output
- AI output is appended as an addendum, not used as the base document

This is an important maintenance detail: AI should not be the first place you debug missing factual content. Missing facts usually come from parsers or canonical-model construction.

## 11. Session Persistence

There are two forms of history:

### 11.1 Server-side session storage

`src/lib/session-store.ts` writes JSON files into `.tmp/sessions`.

Each session contains:

- metadata
- warnings
- canonical model
- flow graph
- quality gate report
- generated documents

This allows share links such as `/?session=<id>`.

### 11.2 Browser-side session metadata

`src/lib/client/session-history.ts` stores recent metadata in IndexedDB.

This is convenience history only. The complete source of truth for restored content is the server-side JSON session file.

## 12. Quality Gate

The quality gate is implemented in `evaluateQualityGate(...)` inside `src/lib/pipeline/generate.ts`.

It checks that:

- all selected documents were generated
- technical documents contain enough section headings
- handover documents contain enough operational sections
- functional documents are non-empty when requested
- the canonical model contains minimum non-empty content for process, routing, output and mapping

If the quality gate fails, the request returns an application error instead of silently producing poor output.

## 13. Current Runtime Truths and Caveats

These details matter during maintenance:

- `src/lib/templates/definitions.ts` is the runtime source of truth for template selection defaults and timing metadata.
- `templates/config.json` exists, but is not currently read by runtime code.
- `src/lib/locales/*.ts` are the runtime locale sources.
- `locales/*.json` exist, but are not currently referenced by the runtime code path that was inspected.
- API routes are intentionally thin; most changes belong in `src/lib`.
- The main maintenance hotspot is `src/lib/pipeline/generate.ts`.

## 14. How to Modify the Project Safely

### 14.1 Change the UI

Edit:

- `src/app/page.tsx`
- `src/app/globals.css`

### 14.2 Change request/response shape

Edit:

- `src/app/api/generate/route.ts`
- `src/app/api/docs/generate/route.ts`
- `src/lib/types.ts`

### 14.3 Change what gets extracted from the SAP package

Edit:

- `src/lib/parsers/iflw.ts`
- `src/lib/parsers/mmap.ts`
- `src/lib/parsers/xsd.ts`
- `src/lib/parsers/text.ts`
- possibly `src/lib/plugins/registry.ts`

### 14.4 Change what appears in the canonical model

Edit:

- `src/lib/pipeline/generate.ts`

Specifically inspect:

- `parseZipArtifacts(...)`
- `buildCanonicalModel(...)`
- `buildFlowGraph(...)`
- `evaluateQualityGate(...)`

### 14.5 Change the final document wording or structure

Edit:

- files in `templates/`

If a section is present in the canonical model but not in output, the problem is usually in the `.hbs` templates.

### 14.6 Add a new document type

You will typically need to update all of these:

- `src/lib/types.ts`
- `src/lib/templates/definitions.ts`
- `src/lib/templates/registry.ts`
- `templates/<new-template>.hbs`
- `src/lib/locales/*.ts`
- `src/app/page.tsx`
- tests covering generation output

### 14.7 Add a new template: practical checklist

Use this sequence when introducing a new document type.

1. Extend the template id union in `src/lib/types.ts`.
2. Add the new template metadata in `src/lib/templates/definitions.ts`.
3. Register the template file name in `src/lib/templates/registry.ts`.
4. Create `templates/<new-template>.hbs`.
5. Add localized label and output file name entries in every file under `src/lib/locales/`.
6. Ensure `src/app/page.tsx` can display the new template in selection and results.
7. Add tests that request the new template and assert the generated output.

Recommended implementation order:

1. Start from `src/lib/types.ts` so TypeScript shows all broken call sites.
2. Update `src/lib/templates/definitions.ts` so the template exists in the runtime catalog.
3. Add the Handlebars file and make it render a minimum valid structure.
4. Add locale labels so the UI and generated file names remain consistent.
5. Run generation tests before refining template wording.

Minimum template contract to check:

- it must render valid Markdown
- it should include enough section headings to satisfy any future quality checks
- it must consume fields already available in the template context
- if it introduces new required data, update `buildTemplateContext(...)` in `src/lib/pipeline/generate.ts`

Common failure modes when adding a template:

- template added in `templates/` but missing from `templateDefinitions`
- template id added to types but missing localized labels
- generated file name not defined in locale messages
- template expects fields that are not present in the context
- tests still assume the old default template set

Quick verification flow after adding a template:

1. Run the document generation test suite.
2. Generate one document using only the new template id.
3. Confirm the output file name, title and main sections.
4. If quality gate logic is template-sensitive, update and retest it explicitly.

## 15. Testing and Local Commands

Main commands:

```bash
npm run dev
npm run build
npm run test
npm run lint
```

The tests use Node's built-in test runner with TypeScript stripping.

The fastest behavior-level regression test is usually `tests/document-generation.test.ts`.

## 16. Suggested Reading Order for New Maintainers

If you need to understand the project quickly, read in this order:

1. `src/lib/types.ts`
2. `src/lib/pipeline/generate.ts`
3. `src/app/page.tsx`
4. `src/app/api/generate/route.ts`
5. `src/lib/parsers/iflw.ts`
6. `src/lib/parsers/mmap.ts`
7. `templates/technical.hbs`

That sequence gives the fastest path from data model to behavior to final output.

## 17. Practical Debugging Heuristics

- Wrong or missing SAP metadata: inspect `text.ts` and `iflw.ts`.
- Missing mapping detail: inspect `mmap.ts` and then `buildCanonicalModel(...)`.
- Good canonical data but poor document output: inspect `templates/*.hbs`.
- Good deterministic document but missing AI addendum: inspect `ai-enhancer.ts` and `/api/ai/status`.
- Session not restoring: inspect `session-store.ts` and `api/sessions/[id]/route.ts`.
- Quality gate failure: inspect `evaluateQualityGate(...)` and the rendered document headings.

## 18. Maintenance Summary

The most important idea is that this project is not primarily a UI app. It is a document-generation pipeline with a thin web shell.

When in doubt:

- start from `src/lib/types.ts`
- then inspect `src/lib/pipeline/generate.ts`
- only after that move to parsers or templates depending on where the defect appears

That approach keeps debugging focused and avoids changing the wrong layer.