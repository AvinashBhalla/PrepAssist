# Assignment Contract

## Authoritative appendices

Appendix A (kit structure) and Appendix B (batch input and output) are provided by the assessment and are authoritative. Their field names must be preserved exactly. This document does not rename, abbreviate, or replace any Appendix A/B field.

### Appendix A: Kit Structure

The generated kit has these exact top-level fields:

- `source`
- `company_brief`
- `role`
- `questions`
- `flashcards`
- `schedule`
- `coverage`

### Appendix B: Batch Input and Output

Each input case contains these exact fields:

- `id`
- `jd`
- `company_url`
- `days`

The batch output contains these exact top-level fields:

- `version`
- `generated_at`
- `kits[]`

Each `kits[]` entry contains:

- `id`
- `status`
- `kit`
- `error`

`status` is exactly `ok` or `failed`. A failed case must not abort the batch; processing continues for all remaining cases. Output entries correspond to the input case IDs.

## Input contract

The shared pipeline normalizes each Appendix B case without changing its external field names:

- `id`: the stable case identifier.
- `jd`: the pasted job description, required and non-empty after trimming.
- `company_url`: the company website URL, required and validated before retrieval.
- `days`: a positive integer representing the requested interview preparation duration.

Batch input is an array of these cases. The pipeline preserves the case IDs and uses the same behavior for each case whether invoked by the API or CLI.

## Internal invariants

- Every requirement has a stable `id` within a kit. IDs remain stable across section regeneration.
- Every question references `requirement_ids`.
- Requirement `priority` is exactly `must` or `nice`.
- Requirement `kind` is exactly `technical`, `behavioural`, or `domain`.
- Question `category` is exactly `technical`, `behavioural`, `system-design`, or `company-fit`.
- Question `difficulty` is an integer from 1 through 3.
- Only requirements explicitly supported by the JD may be marked `must`; uncertainty is represented as unknown or omitted according to the appendix contract.
- Every `must` requirement must be referenced by at least one question after the final generation pass.
- Coverage is checked by normal application code, not by the LLM.
- Schedule allocation is deterministic application code, not an LLM decision.
- Schedule days must equal the requested `days`.
- Schedule minutes must be integers.
- Schedule `question_ids` must reference existing questions.
- `coverage.uncovered_requirement_ids` must be deterministic for the same inputs.
- `coverage.passes` records the number of coverage passes.
- A section regeneration cannot overwrite user edits in another section.
- Partial retrieval or generation results include diagnostics and do not invent missing facts.

## Batch command

The required command is exactly:

```text
npm run evaluate -- --input <cases.json> --output <kits.json>
```

Rules:

- `--input` points to a JSON file containing Appendix B cases with `id`, `jd`, `company_url`, and `days`.
- `--output` points to the JSON file to write using Appendix B fields `version`, `generated_at`, and `kits`.
- The command uses the exact same normalized pipeline and deterministic coverage/scheduling code as the application.
- It must preserve case IDs and provide a result for every case, including a structured failure/diagnostic result when processing cannot complete.
- It must not call a separate batch-only prompt, extractor, coverage implementation, or scheduler.
- Each output entry has `id`, `status`, `kit`, and `error`; `status` is `ok` or `failed`.
- Failed cases continue without aborting the entire batch.
- The output file must follow Appendix B exactly, including field names and error representation.
- The command must exit non-zero for invalid CLI arguments or an unreadable input/output path; case-level retrieval/provider failures belong in the contract-defined output.

## Validation and duplicate handling

Zod schemas validate API input, provider responses, internal section boundaries, and final Appendix A/B serialization. Duplicate submissions are handled idempotently using an authenticated user plus a stable submission key when available; the behavior for a repeated request must be defined in the API contract before implementation.

Persistence stores the Appendix A object under the exact `kit` field without editor metadata. Editor state is stored separately under `itemStates`, with state values `generated`, `edited`, `pinned`, or `deleted` for questions, flashcards, company brief entries, and schedule sections as applicable. Kit duplicate detection uses a cryptographic fingerprint of the normalized job description, company URL, and requested days, scoped to `userId`.

The persistence model uses MongoDB Atlas through Mongoose. Kit repository operations require both kit ID and `userId`; ownership is part of every read and update boundary.

## Remaining approvals

1. Confirm the retention policy for retrieved source text and provider request/response diagnostics.
2. Confirm authentication policy and whether the CLI may access configured provider secrets outside a logged-in web session.
