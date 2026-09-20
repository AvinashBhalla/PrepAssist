# Assignment Contract

## Authoritative appendices

Appendix A (generated kit) and Appendix B (batch output) are the authoritative external contracts. Their field names, nesting, required/optional status, and value types must be copied exactly when the appendices are supplied. This document does not rename, abbreviate, or replace any Appendix A/B field.

The current repository does not include the appendix text. Before Phase 1, the exact appendices must be added to the assignment context or committed as authoritative reference files. Contract tests must then validate both the application response and CLI output against them.

## Input contract

The shared pipeline accepts one normalized preparation request:

- `jobDescription`: the pasted job description, required and non-empty after trimming.
- `companyWebsiteUrl`: the company website URL, required and validated before retrieval.
- `daysUntilInterview`: a positive integer.
- `submissionKey`: an optional client/request id used for idempotency.

Batch input is an array of these requests, with a stable input index preserved for output correlation. Batch processing must not change the pipeline behavior for an individual request.

The API adapter may add authenticated user context; the CLI adapter may add case metadata. Those adapter fields are not part of the generated kit unless Appendix B explicitly requires them.

## Internal invariants

- Requirements have stable `requirementId` values within a kit. IDs are derived from normalized requirement content and remain stable across section regeneration.
- Questions have stable `questionId` values within a kit. A question records the requirement IDs it references.
- Only requirements explicitly supported by the JD may be marked `must`; uncertainty is represented as unknown or omitted according to the appendix contract.
- Every `must` requirement must be referenced by at least one question after the final generation pass.
- Coverage is checked by normal application code, not by the LLM.
- Schedule allocation is deterministic application code, not an LLM decision.
- A section regeneration cannot overwrite user edits in another section.
- Partial retrieval or generation results include diagnostics and do not invent missing facts.

## Batch command

The required command is exactly:

```text
npm run evaluate -- --input <cases.json> --output <kits.json>
```

Rules:

- `--input` points to a JSON file containing the batch cases contract.
- `--output` points to the JSON file to write.
- The command uses the exact same normalized pipeline and deterministic coverage/scheduling code as the application.
- It must preserve input order and provide a result for every case, including a structured failure/diagnostic result when processing cannot complete.
- It must not call a separate batch-only prompt, extractor, coverage implementation, or scheduler.
- The output file must follow Appendix B exactly, including field names and error representation.
- The command must exit non-zero for invalid CLI arguments or an unreadable input/output path; case-level retrieval/provider failures belong in the contract-defined output.

## Validation and duplicate handling

Zod schemas validate API input, provider responses, internal section boundaries, and final Appendix A/B serialization. Duplicate submissions are handled idempotently using an authenticated user plus a stable submission key when available; the behavior for a repeated request must be defined in the API contract before implementation.

## Pending approvals

1. Supply the exact Appendix A and Appendix B definitions.
2. Confirm whether batch cases include explicit case IDs and whether output ordering alone is sufficient for correlation.
3. Confirm the retention policy for retrieved source text and provider request/response diagnostics.
4. Confirm authentication policy and whether the CLI may access configured provider secrets outside a logged-in web session.
