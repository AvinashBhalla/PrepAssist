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
- **Backend:** Express HTTP boundary, request validation, security middleware, route/controller wiring, authentication, persistence, and deterministic retrieval foundation. Generation and business workflows remain deferred.
- **Shared:** API response types, placeholder user/kit types, and reusable Zod schemas shared by frontend/backend boundaries.
- **Pipeline:** owns the ordered workflow and partial-result behavior. It accepts normalized input and returns a contract-valid result plus diagnostics.
- **Retrieval:** fetches the supplied company URL and discovered pages with timeouts, redirect limits, size limits, and source metadata. Cheerio parses HTML. Retrieved text is untrusted data, never instructions.
- **Extraction:** converts the JD into requirements with stable `id` values, `priority` of `must` or `nice`, and `kind` of `technical`, `behavioural`, or `domain`. It must distinguish explicit requirements from unknown or unavailable information and must not invent requirements.
- **Generation:** produces one section at a time through an LLM provider port. Questions reference `requirement_ids`, use category `technical`, `behavioural`, `system-design`, or `company-fit`, and use integer difficulty from 1 through 3. Provider adapters for Groq, Gemini, and OpenRouter share a validated request/response boundary. Invalid JSON is retried or recorded as a section failure, never silently accepted.
- **Coverage:** ordinary application code maps every `must` requirement to question IDs and deterministically produces `uncovered_requirement_ids`. It records the number of coverage passes in `passes` and can request another generation pass for only the missing requirements.
- **Scheduling:** ordinary application code allocates study work from available days, requirements, questions, flashcards, and user constraints. The number of schedule days equals the requested days, minutes are integers, and every `question_id` references an existing question. Equal inputs produce equal schedules.
- **Persistence:** MongoDB repositories store users, kits, source snapshots, generated sections, edits, practice attempts, and regeneration metadata. Domain services merge regenerated sections without overwriting edits in unrelated sections.

## Retrieval foundation

Retrieval is a deterministic backend boundary that returns an internal `ResearchBundle`; it is not Appendix A output and does not generate summaries or requirements. Its flow is:

```text
validate company URL
        -> load and cache robots.txt for the crawl session
        -> fetch bounded text responses with timeout/retry/size controls
        -> clean HTML with Cheerio
        -> extract same-origin links
        -> score and prioritize useful links
        -> crawl within page/depth/concurrency limits
        -> return pages and structured diagnostics
```

Default crawler limits are `maximumPages=12`, `maximumDepth=2`, `concurrency=2`, a 10-second request timeout, and a 1 MB response limit. They are options on the fetcher/crawler boundary rather than hidden decisions in generation code. The environment template also provides repository-level values for wiring those options later.

Link ranking is deterministic and understandable: matching terms for careers, jobs, hiring, interviews, engineering, about, company, culture, handbook, working, and teams contribute weighted points from anchor text, URL path, and page title. Ties are resolved by normalized URL. Hiring candidates are classified heuristically from terms such as careers, jobs, hiring, interview, recruit, talent, people, and working.

The crawler requests `robots.txt` once per company origin and caches the parsed policy for the session. Applicable `User-agent: *` allow/disallow rules are respected, with the longest matching path winning. If robots is missing, unavailable, or malformed, the crawler does not invent rules; it continues and records `robotsStatus=unavailable`.

Native `fetch` uses `AbortController`, content-type checks, a maximum byte limit, and conservative exponential backoff for 429/502/503/504 and network failures. Redirects use `redirect: "manual"`; every 301, 302, 303, 307, and 308 `Location` is resolved against the current URL, validated for the configured environment, and kept same-origin unless explicitly allowed by fetcher configuration. Redirects stop after five hops and return `REDIRECT_LIMIT`; invalid, private, loopback, or cross-origin targets return `REDIRECT_BLOCKED` without being requested. Permanent HTTP failures are recorded without repeated retries.

Response bodies are read as streams rather than trusted solely through `Content-Length`. The fetcher inspects the declared length when available, counts every received chunk, aborts/cancels as soon as the configured limit is exceeded, and returns `RESPONSE_TOO_LARGE` without retaining the over-limit content. Unsupported or binary responses never reach the HTML parser. Each fetch records requested/final URL, status, content type, response size, elapsed time, attempts, and a structured failure code.

Localhost and loopback hosts are allowed in `development` and `evaluation` mode because assessment fixtures may run local test servers. In `production`, localhost, loopback, private IPv4 ranges, link-local addresses, private IPv6 ranges, and obvious internal hostnames are rejected before fetching. External-domain links are ignored by the crawler, and fragments are removed while meaningful query parameters are preserved.

Deterministic retrieval happens before future LLM generation so source selection, page boundaries, failure diagnostics, and available evidence are reproducible, testable, and auditable. External page text remains untrusted data and is never treated as model instructions.

## Public interview-process research

Public interview research is a separate evidence-gathering stage because search results and candidate discussions are useful signals, not authoritative truth. It returns an internal `PublicInterviewResearch` structure and does not modify Appendix A, extract requirements, generate questions, or create a company brief.

The service depends on the `PublicSearchProvider` abstraction (`search(query, options)`), so the rest of the application is not coupled to a particular search engine. The current provider uses DuckDuckGo's publicly accessible HTML results. A provider failure is recorded as `SEARCH_PROVIDER_UNAVAILABLE` or `SEARCH_TIMEOUT` and does not abort later queries.

Queries are deterministic and bounded to at most seven families covering interview process, software engineering, the supplied role, technical interviews, hiring process, Reddit, and Glassdoor. Results are normalized to title, URL, snippet, source domain, query, and rank, then deduplicated by normalized URL. Ranking combines title/snippet interview terms, role matches, source domain, report/discussion signals, and original rank. Source classification is heuristic: `interview-report`, `discussion`, `company`, or `unknown`; a high rank is never treated as proof of reliability.

The default public research limits are seven queries, five results per query, eight fetched source pages, and concurrency of two. Each candidate result page is fetched at most once through the existing security-hardened fetcher and cleaned with Cheerio. The service does not crawl arbitrary links from search results. Failed or blocked pages become `SOURCE_UNREACHABLE` or `SOURCE_BLOCKED` diagnostics while other sources continue. If no usable results are found, the service returns empty sources plus `NO_PUBLIC_DISCUSSION`; it fabricates no interview claims.

## LLM provider abstraction

LLM access is isolated behind the provider-agnostic `LLMProvider` interface. `createLLMService` selects one of `GroqProvider`, `GeminiProvider`, or `OpenRouterProvider` from `LLM_PROVIDER`; future generation services receive the interface and never call a vendor API directly. The current implementations use small native HTTP adapters rather than an agent framework or provider SDK.

Models are configured independently with `GROQ_MODEL`, `GEMINI_MODEL`, and `OPENROUTER_MODEL`. Development defaults are `openai/gpt-oss-120b`, `gemini-3.5-flash`, and `openrouter/free`; the selected provider still requires its corresponding API key. No key or model name is hard-coded into application behavior.

The adapters normalize chat/content responses into text, provider, model, usage, and finish reason. They share bounded retries for 429, 500, 502, 503, 504, network failures, and timeouts, with exponential backoff and `Retry-After` support where available. Authentication and malformed-request failures are not retried. Failures become typed internal categories such as `LLM_AUTHENTICATION_FAILED`, `LLM_RATE_LIMITED`, `LLM_TIMEOUT`, `LLM_PROVIDER_UNAVAILABLE`, `LLM_INVALID_RESPONSE`, and `LLM_CONFIGURATION_ERROR`. Provider selection is explicit through `LLM_PROVIDER`; automatic fallback is intentionally not performed because it can change model behavior and cost unexpectedly.

`generateStructured` requests provider JSON mode when supported, extracts only plain text or a complete JSON code fence, parses with `JSON.parse`, and validates the result against the caller's Zod schema. Malformed JSON and schema mismatches return typed errors; arbitrary output is never converted into fabricated data. This layer does not define interview-kit prompts.

Observability records provider, model, operation, duration, retry count, success/failure, and token usage only. API keys, authorization headers, job descriptions, and research corpora are not logged. LLM generation remains separate from deterministic business logic: schedule allocation, coverage, requirement matching, and final contract validation will remain ordinary application code rather than model decisions.

## API boundary

The backend exposes `/api/*` routes. The foundation provides `GET /api/health`, returning `{ "ok": true, "service": "PrepAssist" }`, and the authentication routes described below. The frontend runs independently on port 3000 and the backend runs independently on port 4000. CORS allows only the configured `FRONTEND_URL` and credentials during local development.

## Authentication and session boundary

Registration and login validate `{ email, password }` with Zod, normalize email to lowercase, hash passwords with bcryptjs, and issue a signed JWT in an HTTP-only `prep_assist_session` cookie. The JWT contains only the user ID in `sub` and expires after one hour. Logout clears the cookie. `GET /api/auth/me` and `GET /api/auth/protected-test` use `requireAuth`, which verifies the cookie token and exposes the authenticated ID through typed `request.userId`; client-supplied owner IDs are never trusted.

In development, the cookie uses `httpOnly: true`, `sameSite: "lax"`, and `secure: false`. In production, `secure` becomes `true`; the other protections remain enabled. Invalid, missing, expired, or tampered tokens return a structured 401 without stack traces or sensitive details. JWT secrets remain in `JWT_SECRET` and are never returned or logged.

Controllers must never accept a client-supplied owner ID for ownership decisions. Future kit controllers will obtain the owner exclusively from `requireAuth`, and kit repository methods will continue to require `userId`.

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

Run the frontend and backend development commands in separate terminals. The current foundation deliberately does not add LLM integration, requirement extraction, batch evaluation, or advanced UI.

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
