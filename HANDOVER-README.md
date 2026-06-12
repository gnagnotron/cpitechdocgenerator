# Handover README

## What this project is

This is a Next.js application that generates documentation from a SAP iFlow ZIP package.

At a high level it:

1. receives a ZIP export
2. parses iFlow, mapping, XSD and properties files
3. builds a canonical internal model
4. renders one or more Markdown documents through Handlebars templates
5. optionally appends an AI addendum
6. stores the result as a recoverable session

## The files that matter most

- `src/lib/pipeline/generate.ts`
  - main orchestration and best entry point for understanding behavior
- `src/lib/types.ts`
  - shared contracts for parsed data, canonical model and generated output
- `src/app/page.tsx`
  - main UI and client interaction flow
- `src/app/api/generate/route.ts`
  - upload endpoint
- `src/app/api/docs/generate/route.ts`
  - JSON/base64 endpoint
- `src/lib/parsers/iflw.ts`
  - iFlow parser
- `src/lib/parsers/mmap.ts`
  - mapping parser
- `templates/*.hbs`
  - final document structure and wording

## How the request flows

1. UI sends a ZIP to an API route.
2. API creates a session id and calls `generateFromZipBuffer(...)`.
3. The pipeline parses ZIP contents and builds a canonical model.
4. The selected templates render Markdown and HTML.
5. AI enrichment may append an addendum.
6. A quality gate validates the result.
7. The session is saved under `.tmp/sessions`.

## Where to change things

- Change UI: `src/app/page.tsx`, `src/app/globals.css`
- Change API payloads: `src/app/api/*`, `src/lib/types.ts`
- Change SAP extraction logic: `src/lib/parsers/*`
- Change canonical model or generation logic: `src/lib/pipeline/generate.ts`
- Change final document wording: `templates/*.hbs`
- Change labels and translations: `src/lib/locales/*.ts`
- Change session persistence: `src/lib/session-store.ts`

## Runtime truths worth knowing

- The real template catalog is in `src/lib/templates/definitions.ts`.
- `templates/config.json` exists, but is not the runtime source of truth.
- Runtime locales are in `src/lib/locales/*.ts`.
- The root `locales/*.json` files are not part of the main runtime path that was inspected.
- The app is mainly a generation pipeline with a thin web shell.

## Fast onboarding order

Read these in order:

1. `src/lib/types.ts`
2. `src/lib/pipeline/generate.ts`
3. `src/app/page.tsx`
4. `src/app/api/generate/route.ts`
5. `src/lib/parsers/iflw.ts`
6. `templates/technical.hbs`

## Typical debugging shortcuts

- Missing data from ZIP: inspect parsers first.
- Data present but wrong in document: inspect `buildCanonicalModel(...)`.
- Canonical model looks good but output is poor: inspect `templates/*.hbs`.
- AI section missing: inspect `src/lib/ai-enhancer.ts` and `/api/ai/status`.
- Session recovery broken: inspect `src/lib/session-store.ts` and `src/app/api/sessions/[id]/route.ts`.

## Basic commands

```bash
npm run dev
npm run test
npm run lint
npm run build
```

## Recommended maintenance rule

When something looks wrong, do not start from the UI.

Start from:

1. `src/lib/types.ts`
2. `src/lib/pipeline/generate.ts`
3. the relevant parser or template

That is usually the shortest path to the root cause.