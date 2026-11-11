# SignPay Assessment Agent

The SignPay Assessment Agent uses artificial intelligence (AI) to assess payment requests against the terms of an agreed service agreement, identifying discrepancies and cases requiring human review before a PayPal invoice is issued.

## Overview

SignPay provides an intermediary assessment between a service provider requesting payment and a customer who has agreed to the work.

The agent receives:
- Agreement reference.
- Agreed service and description of work.
- Original requirements.
- Agreed payment amount.
- Requested payment amount.
- Provider's completion statement.
- Any customer objection.

It compares the submitted information against the original agreement and returns a structured assessment.

## Assessment outcomes

The agent returns one of three outcomes:

| Outcome | Meaning |
|---|---|
| `PROCEED` | No material discrepancy was identified in the submitted information. |
| `DISCREPANCY_IDENTIFIED` | A discrepancy with the agreement has been identified. |
| `HUMAN_REVIEW_REQUIRED` | The available information is ambiguous, incomplete or insufficient for a reliable assessment. |

The server independently checks that the requested payment amount matches the amount recorded in the agreement. This check does not rely on the AI assessment.

## Architecture

The agent is built using:
- **TypeScript** for the application logic.
- **Bun** as the JavaScript runtime.
- **Mastra** for the AI agent framework.
- **Astropods AI Gateway** for managed model access.
- **Zod** for input and output validation.

The agent communicates with the main SignPay Next.js application through an authenticated HTTP API.

## API endpoints

### Health check

`GET /health`

Returns the agent's service status.

### Payment assessment

`POST /api/assess`

Requires a valid Bearer authentication token.

The request contains the agreement information, payment amounts, completion statement and optional customer objection.

The response contains:
- Agreement reference.
- Assessment timestamp.
- Assessment outcome.
- Explanation.
- Requirements considered.
- Identified discrepancies.
- Escalation reason, where applicable.

## Configuration

The agent is configured through `astropods.yml` and environment variables.

Required environment variables:

| Variable | Purpose |
|---|---|
| `ASTRO_GATEWAY_URL` | Astropods AI Gateway endpoint. |
| `ASTRO_GATEWAY_API_KEY` | Authentication for the AI Gateway. |
| `SIGNPAY_AGENT_API_KEY` | Shared authentication key between SignPay and the agent. |

Optional environment variables:

| Variable | Purpose |
|---|---|
| `MODEL_DEFAULT` | AI model selection. Defaults to `claude-sonnet-4-6`. |
| `PORT` | HTTP server port. Defaults to `8080`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Optional observability endpoint. |

The authentication key must be configured as a secret. Never commit API keys, credentials or `.env` files to source control.

## Installation and development

Requirements:
- Bun.
- Astropods CLI.
- An authenticated Astropods account.

Install dependencies:

```bash
bun install
```

Authenticate with Astropods:

```bash
ast login
```

Start the agent through Astropods:

```bash
ast project start
```

The agent can also be started directly using the package scripts:

```bash
bun run dev
```

For production:

```bash
bun run start
```

The required environment variables must be configured before starting the agent.

## Security considerations

The implementation incorporates several security principles:

- **Authentication:** The assessment endpoint requires a shared API key.
- **Timing-safe comparison:** Authentication uses `timingSafeEqual` to compare supplied and expected keys.
- **Input validation:** Zod schemas validate incoming assessment data and structured AI responses.
- **Untrusted input handling:** User-supplied descriptions are treated as data, not instructions capable of changing the agent's rules.
- **Fail-safe behaviour:** Unavailable or invalid AI responses result in `HUMAN_REVIEW_REQUIRED`.
- **Separation of duties:** The agent assesses payment requests but cannot authorise, capture, transfer or refund money.

## Limitations

The agent assesses consistency between submitted statements and the original agreement. It does not independently verify that work physically took place.

An AI assessment is not proof of completion or a guarantee that a payment request is legitimate.

Uncertain cases should be resolved by the parties outside the automated assessment process.

PayPal handles invoice creation and payment separately through the main SignPay application.

## Project structure

```text
signpay-agent/
├── agent/
│   └── index.ts
├── astropods.yml
├── Dockerfile
├── package.json
├── bun.lock
└── README.md
```

## Project

SignPay is a prototype developed for the PayPal AI Hackathon. Its purpose is to demonstrate how AI-assisted assessment, agreement-based controls and payment infrastructure can work together to improve confidence in service transactions.