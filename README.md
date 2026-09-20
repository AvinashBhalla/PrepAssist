# The AI Interview Prep Kit

Full-stack engineering assessment for turning a job description and company research into an editable, coverage-checked interview preparation kit.

## Project Overview

The system accepts a pasted job description, a company website, and the days remaining until an interview. It supports single and batch preparation, partial research, structured requirement extraction, generated study materials, deterministic coverage checks, deterministic scheduling, editing, section regeneration, and confidence-aware flashcard practice.

Appendix A defines the generated kit contract with the exact top-level fields `source`, `company_brief`, `role`, `questions`, `flashcards`, `schedule`, and `coverage`. Appendix B defines batch input and output; those contracts are authoritative and must not be renamed or reshaped.

## Architecture

The application and `evaluate` CLI share one pipeline with separate adapters. Retrieval, extraction, generation, coverage, scheduling, and persistence are separate boundaries. See [docs/architecture.md](docs/architecture.md) and [docs/assignment-contract.md](docs/assignment-contract.md).

## Local Setup

Setup instructions will be added after the project packages, database configuration, and exact Appendix A/B contracts are approved.

Planned prerequisites: Node.js, npm, MongoDB, and credentials for one supported LLM provider.

## Environment Variables

Copy `.env.example` to `.env` and provide local values. Provider keys and authentication secrets must remain local and must never be committed.

## Testing

Testing commands and fixtures will be added with the Vitest setup. The initial suite will cover deterministic coverage and scheduling, contract validation, failure handling, and parity between API and batch pipeline execution.

## Batch Evaluation

The required command is:

```text
npm run evaluate -- --input <cases.json> --output <kits.json>
```

The evaluator will use the same pipeline as the application and will emit Appendix B output. Input cases contain `id`, `jd`, `company_url`, and `days`. Output contains `version`, `generated_at`, and `kits[]`, with each entry containing `id`, `status`, `kit`, and `error`. `status` is `ok` or `failed`; failed cases continue without aborting the batch. The command is intentionally not implemented in this planning phase.

The contract also requires stable requirement IDs, question `requirement_ids`, requirement priorities of `must` or `nice`, requirement kinds of `technical`, `behavioural`, or `domain`, question categories of `technical`, `behavioural`, `system-design`, or `company-fit`, integer difficulty from 1 to 3, deterministic coverage, and deterministic scheduling. Schedule days equal requested days, schedule minutes are integers, schedule question IDs reference existing questions, and `coverage.passes` records the number of coverage passes. See [docs/assignment-contract.md](docs/assignment-contract.md) for the full contract.

## Deployment

Deployment instructions will be added after the runtime, MongoDB hosting, secret management, provider configuration, and Appendix A/B validation strategy are approved.
