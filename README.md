# The AI Interview Prep Kit

Full-stack engineering assessment for turning a job description and company research into an editable, coverage-checked interview preparation kit.

## Project Overview

The system accepts a pasted job description, a company website, and the days remaining until an interview. It supports single and batch preparation, partial research, structured requirement extraction, generated study materials, deterministic coverage checks, deterministic scheduling, editing, section regeneration, and confidence-aware flashcard practice.

Appendix A defines the generated kit contract with the exact top-level fields `source`, `company_brief`, `role`, `questions`, `flashcards`, `schedule`, and `coverage`. Appendix B defines batch input and output; those contracts are authoritative and must not be renamed or reshaped.

## Architecture

The application and `evaluate` CLI share one pipeline with separate adapters. Retrieval, extraction, generation, coverage, scheduling, and persistence are separate boundaries. See [docs/architecture.md](docs/architecture.md) and [docs/assignment-contract.md](docs/assignment-contract.md).

## Local Setup

### Prerequisites

- Node.js 20 or newer
- npm 10 or newer
- MongoDB is not required for the authentication unit tests

### Install

```text
npm install
```

Copy `.env.example` to `.env` and set `JWT_SECRET` to a long random value. Authentication tests use an in-memory repository; a live MongoDB instance is not required for the unit suite.

### Start the frontend

```text
npm run dev:frontend
```

The frontend is available at `http://localhost:3000`.

### Start the backend

In a second terminal:

```text
npm run dev:backend
```

The backend listens on `http://localhost:4000`.

### Health endpoint

```text
GET http://localhost:4000/api/health
```

Expected response:

```json
{
	"ok": true,
	"service": "PrepAssist"
}
```

## Environment Variables

Copy `.env.example` to `.env` and provide local values. `JWT_SECRET` signs one-hour HTTP-only cookie sessions. Provider keys and authentication secrets must remain local and must never be committed.

## Authentication Endpoints

- `POST /api/auth/register` creates an account and establishes a session.
- `POST /api/auth/login` establishes a session for valid credentials.
- `POST /api/auth/logout` clears the session cookie.
- `GET /api/auth/me` returns the authenticated user's safe public information.
- `GET /api/auth/protected-test` is development/test infrastructure for verifying `requireAuth`.

Authenticated browser requests must include credentials so the HTTP-only cookie is sent to the backend.

## Testing

Run `npm test` for the Vitest suite. Authentication tests use a mocked repository and do not require a production MongoDB connection.

## Batch Evaluation

The required command is:

```text
npm run evaluate -- --input <cases.json> --output <kits.json>
```

The evaluator will use the same pipeline as the application and will emit Appendix B output. Input cases contain `id`, `jd`, `company_url`, and `days`. Output contains `version`, `generated_at`, and `kits[]`, with each entry containing `id`, `status`, `kit`, and `error`. `status` is `ok` or `failed`; failed cases continue without aborting the batch. The command is intentionally not implemented in this planning phase.

The contract also requires stable requirement IDs, question `requirement_ids`, requirement priorities of `must` or `nice`, requirement kinds of `technical`, `behavioural`, or `domain`, question categories of `technical`, `behavioural`, `system-design`, or `company-fit`, integer difficulty from 1 to 3, deterministic coverage, and deterministic scheduling. Schedule days equal requested days, schedule minutes are integers, schedule question IDs reference existing questions, and `coverage.passes` records the number of coverage passes. See [docs/assignment-contract.md](docs/assignment-contract.md) for the full contract.

## Deployment

Deployment instructions will be added after the runtime, MongoDB hosting, secret management, provider configuration, and Appendix A/B validation strategy are approved.
