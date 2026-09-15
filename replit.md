# Anki Speed Read

An AI-assisted study desk for UNN students that turns typed course PDFs into cached flashcards and mini-tests.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/anki-speed-read run dev` — run the web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required env (repo-root `.env`, gitignored): `MONGODB_URI`, `JWT_SECRET`, `ENCRYPTION_KEY`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `PORT` — see `.env.example`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: MongoDB Atlas + Mongoose 8
- Validation: Zod (`zod/v4`)
- PDF analysis: pdfjs-dist (externalized from the esbuild bundle; resolves from `api-server/node_modules` at runtime)
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (ESM bundle)
- Web app: React + Vite + Wouter + Tailwind CSS
- Web app: React + Vite + Wouter + Tailwind CSS

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for auth, courses, materials, study, and test APIs
- `artifacts/api-server/src/lib/asr-store.ts` — Mongoose-backed scoped student/course/material/test state
- `artifacts/api-server/src/lib/models.ts` — Mongoose schemas + `connectDatabase()` (8s server-selection timeout)
- `artifacts/api-server/src/lib/pdf.ts` — multipart PDF parsing, pdfjs-dist page counting, and text-layer extraction
- `artifacts/api-server/src/lib/cloudinary.ts` — Cloudinary PDF upload/destroy
- `artifacts/api-server/src/lib/gemini.ts` — Gemini generation + `checkGeminiKey` validation
- `artifacts/anki-speed-read/src/App.tsx` — routed student experience
- `artifacts/anki-speed-read/src/index.css` — UNN-inspired study desk theme

## Architecture decisions

- Password hashing uses bcrypt; session tokens are signed JWTs (JWT_SECRET); Gemini API keys are encrypted at rest with AES-256-GCM (ENCRYPTION_KEY) and never returned to the client.
- Student-entered Gemini keys are validated live against the Gemini API at signup/key-update; transient network errors are tolerated.
- Course PDFs are stored in Cloudinary as raw assets; card/test generation still happens in the API server.
- Processing reserves course page budget immediately, then releases it if typed-text validation fails.
- Study cards and tests are generated once per material and read from the cached store thereafter.
- Retry is intentionally limited to Gemini-side failure types; scanned PDFs and page-limit errors require a new upload decision.

## Product

- Student signup and sign-in with required Gemini API key onboarding
- Course creation with a 30-page cumulative budget
- Typed-PDF upload with scan detection, status polling, failure messaging, and retry rules
- Merged course-level flashcard study mode with flip and keyboard controls
- Per-material 10-question tests with instant scoring and attempt history
- Settings for replacing the stored Gemini API key

## User preferences

- Keep the product focused on typed course material and grounded study recall; do not add generic content feeds.

## Gotchas

- Vite direct builds need `PORT` and `BASE_PATH`; use the managed workflow for previews.
- API responses are scoped by bearer-authenticated student ownership.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
