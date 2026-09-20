# The AI Interview Prep Kit

Full-stack engineering assessment for turning a job description and company research into an editable, coverage-checked interview preparation kit.

## Project Overview

The system accepts a pasted job description, a company website, and the days remaining until an interview. It supports single and batch preparation, partial research, structured requirement extraction, generated study materials, deterministic coverage checks, deterministic scheduling, editing, section regeneration, and confidence-aware flashcard practice.

Appendix A defines the generated kit contract. Appendix B defines batch output. Those contracts are authoritative and must not be renamed or reshaped.

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

The evaluator will use the same pipeline as the application and will emit Appendix B output. It is intentionally not implemented in this planning phase.

## Deployment

Deployment instructions will be added after the runtime, MongoDB hosting, secret management, provider configuration, and Appendix A/B validation strategy are approved.
