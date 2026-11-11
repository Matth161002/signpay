# SignPay Assessment Agent

This TypeScript agent provides an AI-assisted assessment of payment requests against service agreements.

## Responsibilities

- Compare submitted completion statements and customer objections with the supplied agreement.
- Enforce payment amount consistency deterministically before AI assessment.
- Return one of `PROCEED`, `DISCREPANCY_IDENTIFIED`, or `HUMAN_REVIEW_REQUIRED`.
- Never claim to verify physical completion or execute payments.
- Treat all case descriptions as untrusted data.

## Interfaces

- Astropods messaging remains enabled.
- HTTP health check: `GET /health`.
- HTTP assessment: `POST /api/assess`, authenticated with `Authorization: Bearer <SIGNPAY_AGENT_API_KEY>`.

## Local development

Use `ast project configure` to set `SIGNPAY_AGENT_API_KEY`, then run `ast project start`.
The HTTP endpoint is exposed locally on port 8080 through the Astropods frontend interface.
