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

## Proposed folder structure

```text
apps/
  web/                         # Next.js + TypeScript + Tailwind UI
  api/                         # Express HTTP adapter
packages/
  contracts/                   # Zod schemas and shared TypeScript types
  pipeline/                    # Orchestration and use cases
  retrieval/                   # fetch/Cheerio retrieval and source normalization
  extraction/                  # JD requirement extraction and stable IDs
  generation/                  # Provider abstraction and section generators
  coverage/                    # Deterministic requirement/question checks
  scheduling/                  # Deterministic study allocation
  persistence/                 # MongoDB repositories and mapping
  shared/                      # Errors, IDs, logging, and small utilities
cli/
  evaluate.ts                  # npm run evaluate adapter over the shared pipeline
tests/
  unit/                        # Deterministic package tests
  integration/                 # Pipeline and persistence boundary tests
  fixtures/                    # Sanitized input and expected output fixtures
docs/
  architecture.md
  assignment-contract.md
```

## Runtime boundaries

- **Web:** authentication screens, kit editing, section regeneration, and flashcard practice. The UI calls the API and never makes provider or scraping decisions.
- **API:** request authentication, authorization, duplicate-submission handling, input validation, and use-case invocation.
- **Pipeline:** owns the ordered workflow and partial-result behavior. It accepts normalized input and returns a contract-valid result plus diagnostics.
- **Retrieval:** fetches the supplied company URL and discovered pages with timeouts, redirect limits, size limits, and source metadata. Cheerio parses HTML. Retrieved text is untrusted data, never instructions.
- **Extraction:** converts the JD into requirements with stable `id` values, `priority` of `must` or `nice`, and `kind` of `technical`, `behavioural`, or `domain`. It must distinguish explicit requirements from unknown or unavailable information and must not invent requirements.
- **Generation:** produces one section at a time through an LLM provider port. Questions reference `requirement_ids`, use category `technical`, `behavioural`, `system-design`, or `company-fit`, and use integer difficulty from 1 through 3. Provider adapters for Groq, Gemini, and OpenRouter share a validated request/response boundary. Invalid JSON is retried or recorded as a section failure, never silently accepted.
- **Coverage:** ordinary application code maps every `must` requirement to question IDs and deterministically produces `uncovered_requirement_ids`. It records the number of coverage passes in `passes` and can request another generation pass for only the missing requirements.
- **Scheduling:** ordinary application code allocates study work from available days, requirements, questions, flashcards, and user constraints. The number of schedule days equals the requested days, minutes are integers, and every `question_id` references an existing question. Equal inputs produce equal schedules.
- **Persistence:** MongoDB repositories store users, kits, source snapshots, generated sections, edits, practice attempts, and regeneration metadata. Domain services merge regenerated sections without overwriting edits in unrelated sections.

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
