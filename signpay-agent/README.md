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
- **Astropods AI Gateway** for managed model inference.
- **`@astropods/adapter-mastra`** to connect the Mastra agent to the Astropods runtime.
- **Zod** for input and output validation.

The agent communicates with the main SignPay Next.js application through an authenticated HTTP API.

### How Astropods is integrated

Astropods is the model-access layer used by the SignPay AI agent. The integration is configured in `astropods.yml`, where the default provider is set to `gateway` and the model is set to `claude-sonnet-4-6` (Claude Sonnet 4.6).

When the agent is started with the Astropods CLI, Astropods makes the AI Gateway development credentials available as the `ASTRO_GATEWAY_URL` and `ASTRO_GATEWAY_API_KEY` environment variables. The agent reads these values and uses the Vercel AI SDK's OpenAI-compatible client, configured with the Gateway URL and API key, to connect to the Gateway's `/v1` endpoint. Mastra's agent model function calls `gateway.chat(...)` with the configured model name, so the assessment inference is sent through Astropods AI Gateway to Claude Sonnet 4.6.

The `@astropods/adapter-mastra` package provides the `serve` adapter used by the agent to run within the Astropods environment. The Astropods CLI also manages the local project configuration and secret input used for the shared `SIGNPAY_AGENT_API_KEY`. This shared key is separate from the Gateway credentials: it authenticates requests from the main SignPay application to the assessment endpoint.

As a result, Astropods is directly involved in the running application: it provides the Gateway connection used for the AI assessment, rather than simply appearing in the list of development tools. The agent does not call Anthropic's API directly.

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

Runtime configuration:

- `ASTRO_GATEWAY_URL` and `ASTRO_GATEWAY_API_KEY` are supplied automatically by Astropods when the agent runs through `ast project start` with the Gateway model configuration.
- `SIGNPAY_AGENT_API_KEY` is a shared authentication key between SignPay and the agent. It is declared as a secret input in `astropods.yml` and configured locally using `ast project configure`.

For the judge setup, no `signpay-agent/.env` file is required. The root application still uses `signpay/.env.local`, and its `SIGNPAY_AGENT_API_KEY` value must match the value configured through Astropods.

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

For local development through Astropods, configure the secret input from this directory:

```bash
ast project configure
```

Set `SIGNPAY_AGENT_API_KEY` when prompted. It must match the value in the main application's `.env.local` and should be a random value of at least 32 characters. Astropods supplies the AI Gateway development credentials automatically when the agent starts.

A `.env` file copied from `.env.example` is only needed if you choose to run the agent directly with Bun outside the Astropods-managed workflow.

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