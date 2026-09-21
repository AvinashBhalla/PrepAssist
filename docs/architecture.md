# The AI Interview Prep Kit: Proposed Architecture

## Scope

This repository will contain a full-stack interview preparation system and a batch evaluator. This phase defines boundaries and contracts only; it does not implement authentication, retrieval, generation, persistence, or UI.

## System shape

The web application and the batch evaluator will call the same application pipeline. They differ only at the input/output adapters:

```text
Web/API adapter                 Batch CLI adapter
       |                               |
       +--------- shared pipeline -----+
                         |
                 validate and normalize input
                         |
              retrieve company/public sources
                         |
                 extract structured JD data
                         |
             generate sections through LLM port
                         |
             run deterministic coverage check
                         |
             allocate deterministic study schedule
                         |
                 validate Appendix A output
                         |
                  persist or serialize result
```

## Assessment contract boundaries

The generated kit follows Appendix A with these exact top-level field names:

```text
source
company_brief
role
questions
flashcards
schedule
coverage
```

The batch evaluator follows Appendix B. Its input cases use `id`, `jd`, `company_url`, and `days`. Its output uses `version`, `generated_at`, and `kits[]`; each kit entry contains `id`, `status`, `kit`, and `error`. `status` is `ok` or `failed`, failed cases continue processing, and output entries correspond to the input case IDs.

## Phase 1A folder structure

```text
frontend/                      # Next.js App Router and Tailwind UI
backend/                       # Express HTTP adapter
shared/                        # Shared TypeScript types and Zod schemas
scripts/                       # Repository-level scripts, added as needed
test-cases/                    # Assessment fixtures, added as needed
docs/
  architecture.md
  assignment-contract.md
```

## Runtime boundaries

- **Frontend:** Next.js App Router pages, layout, and reusable UI primitives. It calls the backend API and contains no research or business workflow decisions.
- **Backend:** Express HTTP boundary, request validation, security middleware, route/controller wiring, and future application services. Authentication, retrieval, generation, persistence, and business workflows are intentionally deferred.
- **Shared:** API response types, placeholder user/kit types, and reusable Zod schemas shared by frontend/backend boundaries.
- **Pipeline:** owns the ordered workflow and partial-result behavior. It accepts normalized input and returns a contract-valid result plus diagnostics.
- **Retrieval:** fetches the supplied company URL and discovered pages with timeouts, redirect limits, size limits, and source metadata. Cheerio parses HTML. Retrieved text is untrusted data, never instructions.
- **Extraction:** converts the JD into requirements with stable `id` values, `priority` of `must` or `nice`, and `kind` of `technical`, `behavioural`, or `domain`. It must distinguish explicit requirements from unknown or unavailable information and must not invent requirements.
- **Generation:** produces one section at a time through an LLM provider port. Questions reference `requirement_ids`, use category `technical`, `behavioural`, `system-design`, or `company-fit`, and use integer difficulty from 1 through 3. Provider adapters for Groq, Gemini, and OpenRouter share a validated request/response boundary. Invalid JSON is retried or recorded as a section failure, never silently accepted.
- **Coverage:** ordinary application code maps every `must` requirement to question IDs and deterministically produces `uncovered_requirement_ids`. It records the number of coverage passes in `passes` and can request another generation pass for only the missing requirements.
- **Scheduling:** ordinary application code allocates study work from available days, requirements, questions, flashcards, and user constraints. The number of schedule days equals the requested days, minutes are integers, and every `question_id` references an existing question. Equal inputs produce equal schedules.
- **Persistence:** MongoDB repositories store users, kits, source snapshots, generated sections, edits, practice attempts, and regeneration metadata. Domain services merge regenerated sections without overwriting edits in unrelated sections.

## API boundary

The backend exposes `/api/*` routes. Phase 1A provides only `GET /api/health`, returning `{ "ok": true, "service": "PrepAssist" }`. The frontend runs independently on port 3000 and the backend runs independently on port 4000. CORS allows the configured `FRONTEND_URL` during local development.

## MongoDB persistence

MongoDB Atlas is the planned persistence service, accessed through Mongoose. The reusable connection module reads `MONGODB_URI`, rejects a missing value clearly, reuses an in-flight connection promise during development, and reports connection failures without logging the URI. Persistence code does not connect during unit tests.

- **User:** `_id`, normalized lowercase `email`, `passwordHash`, `createdAt`, and `updatedAt`.
- **Kit:** `_id`, ownership `userId`, hashed input `fingerprint`, `status`, Appendix A `kit`, separate `itemStates`, `createdAt`, and `updatedAt`.
- **Kit status:** `draft`, `generating`, `ready`, or `failed`.
- **Repositories:** user and kit repositories own Mongoose operations. Kit reads and updates require both kit ID and user ID; there is no public unscoped kit lookup.
- **Duplicate strategy:** the fingerprint is a SHA-256 hash of the normalized job description, company URL, and requested days. A compound unique index on `userId` and `fingerprint` prevents duplicate kits for one owner while allowing different users to prepare the same role.

The Appendix A object remains content-only and preserves its exact field names. Editor metadata is stored in `itemStates`, keyed separately for questions, flashcards, company brief entries, and schedule sections. Each state can be `generated`, `edited`, `pinned`, or `deleted`, allowing future regeneration to preserve pinned/edited content and keep deleted content from silently returning without contaminating the external kit contract.

## Development commands

From the repository root:

```text
npm install
npm run dev:frontend
npm run dev:backend
npm run test
npm run typecheck
npm run build:frontend
npm run build:backend
```

Run the frontend and backend development commands in separate terminals. The foundation deliberately does not add a database connection, authentication, research pipeline, LLM integration, batch evaluator, or advanced UI.

## Regeneration and editing model

Each editable item has a stable ID, an origin, a version, and edit metadata. A regeneration request targets one section and writes a new generated version for that section only. The merge operation preserves user-owned items and all other sections; deleted items remain excluded unless explicitly restored by the user.

## Failure handling

Failures are represented as typed diagnostics attached to the affected source or section. Invalid URLs, 404s, timeouts, missing hiring pages, thin JDs, absent public discussion, provider rate limits, invalid provider JSON, and duplicate submissions must produce actionable partial results where possible. No unavailable research is replaced with fabricated content.

## Security and trust boundaries

External HTML, search results, job descriptions, and public discussions are untrusted content. They are data passed to extraction/generation with explicit delimiters and length limits; they cannot override system or application instructions. Secrets remain server-side, passwords are hashed, and authorization is checked for every kit mutation.

## Testing strategy

- Unit-test coverage and scheduling with fixed fixtures and property-style edge cases.
- Contract-test every LLM adapter against the same Zod output schemas.
- Integration-test the shared pipeline with mocked retrieval and providers.
- Exercise the CLI against the same fixtures used by the API.
- Add persistence and authorization tests before exposing the application beyond local development.
