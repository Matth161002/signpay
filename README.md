# SignPay

**AI-assisted assessment of service payment requests against digitally signed agreements, with PayPal invoice and payment integration.**

SignPay is a prototype developed for the PayPal AI Hackathon. It is designed to help service providers and customers assess whether a payment request is consistent with the work and payment terms they agreed.

SignPay's assessment process is text-based. The provider submits a written completion statement, and the customer may submit a written objection at a later stage. The AI compares this information with the original agreement. It does not verify physical work or analyse photographs.

## How it works

1. **Create an agreement.** The provider and customer record the service, agreed work, requirements and payment amount.
2. **Sign the agreement.** Both participants authenticate and provide a digital signature.
3. **Provider requests payment.** The provider submits a payment request, including the requested amount and a written completion statement.
4. **Initial AI assessment.** SignPay checks the requested amount against the agreed amount separately, then the AI assesses the provider's completion statement against the original agreement.
5. **Customer objection.** Only after the provider's request has passed the initial AI assessment can the customer submit a written objection. The customer cannot object before a payment request has been submitted and accepted by the initial assessment.
6. **Further assessment.** If an objection is submitted, the AI compares it with the original agreement and the provider's completion statement. A discrepancy or uncertainty is identified rather than silently disregarded.
7. **Invoice and payment.** Where the assessment workflow permits it to proceed, the application creates and sends a PayPal invoice. PayPal processes the payment.
8. **Payment confirmation.** SignPay uses a verified PayPal webhook to record the confirmed payment status.

## Assessment outcomes

The assessment agent returns one of three structured outcomes:

| Outcome | Meaning |
| --- | --- |
| `PROCEED` | No material discrepancy was identified in the submitted information. |
| `DISCREPANCY_IDENTIFIED` | The submitted information conflicts with an agreed term or requirement. |
| `HUMAN_REVIEW_REQUIRED` | The information is ambiguous, incomplete or insufficient for a reliable assessment. |

The requested payment amount is checked deterministically against the amount in the agreement. The AI does not override this check.

## Architecture and technology

### Main application

- **Next.js and TypeScript** for the web application and server-side routes.
- **Neon PostgreSQL** for persistent application data, including users, sessions, agreements, payment requests and audit events.
- **Password hashing and session controls** for account authentication and access to participant agreements.
- **SHA-256** to calculate an agreement integrity hash after both parties have signed.

### AI assessment agent

The separate `signpay-agent/` service is built with:

- **Bun** as the JavaScript runtime.
- **Mastra** as the agent framework.
- **Astropods AI Gateway** for model access.
- **Claude Sonnet 4.6** as the configured default model.
- **Zod** for input and structured output validation.

The agent exposes an authenticated HTTP assessment endpoint to the main application. It assesses consistency with the agreement; it does not verify physical completion or move money.

### PayPal

SignPay integrates with the PayPal Invoicing API to create and send invoices. PayPal handles the payment itself. A PayPal webhook is verified before the application records an invoice as paid.

The integration was exercised using PayPal Sandbox accounts. Sandbox transactions are test transactions and do not represent transfers of real money.

## Security controls

The prototype includes several security controls:

- Passwords are stored as salted scrypt hashes rather than plaintext.
- Sessions use opaque random tokens, with token hashes stored in the database and an HTTP-only, SameSite cookie.
- Agreement access is restricted to the authenticated participants.
- Server-side role and participant checks prevent one participant from signing or submitting an objection on behalf of the other.
- The customer objection is only available after the provider's payment request has passed the initial AI assessment.
- The agent endpoint requires a shared API key and uses timing-safe comparison.
- Agent input and structured output are validated using Zod.
- User-supplied case descriptions are treated as untrusted data, not instructions that can change the agent's assessment rules.
- Uncertain AI assessments fall back to human review.
- PayPal webhook signatures are verified before payment status is updated.

These controls are intended to demonstrate security principles in a prototype. They do not constitute an independent security audit or certification.

## Important limitations

- **Text-based assessment only.** The provider's completion statement and the customer's objection are written text. The prototype does not accept or analyse photographs or other visual evidence.
- **AI does not prove that work happened.** It assesses the consistency of the submitted statements against the agreement.
- **Human resolution remains necessary.** SignPay identifies uncertainty but does not provide a full dispute-resolution service.
- **The AI does not move money.** PayPal handles invoicing and payment. SignPay records payment status from verified webhook notifications.
- **The project is a hackathon prototype.** It has been tested using local services and PayPal Sandbox, not established as a production payment service.

## Project structure

```text
signpay/
├── src/                  # Next.js application and API routes
├── signpay-agent/        # AI assessment agent
├── public/               # Static application assets
├── package.json
└── README.md
```

Local databases, agreement data, environment files and credentials are excluded from source control. The agent has its own README with further configuration and development information.

## Running locally

### Requirements

- Node.js 24.x and npm.
- Bun.
- Astropods CLI and an authenticated Astropods account.
- PayPal Developer Sandbox application and Sandbox buyer account for testing invoice payments.

### 1. Clone the repository

```bash
git clone https://github.com/Matth161002/signpay.git
cd signpay
```

### 2. Install the main application dependencies

```bash
npm install
```

### 3. Configure the main application

Copy the example environment file to `.env.local` in the repository root:

```bash
cp .env.example .env.local
```

Set the following values in `.env.local`:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Pooled PostgreSQL connection string copied from your Neon project. Keep it private. |
| `PAYPAL_CLIENT_ID` | Client ID from your PayPal Developer Sandbox application. |
| `PAYPAL_CLIENT_SECRET` | Secret from the same Sandbox application. |
| `PAYPAL_BUSINESS_EMAIL` | Email address of your PayPal Business Sandbox account. |
| `PAYPAL_WEBHOOK_ID` | Webhook ID for the Sandbox webhook registered to receive invoice-paid events. |
| `SIGNPAY_AGENT_URL` | URL at which the local AI agent can be reached. The application defaults to `http://localhost:3200`. |
| `SIGNPAY_AGENT_API_KEY` | Shared secret used to authenticate requests between the application and agent. Use at least 32 characters. |

Use PayPal Sandbox credentials, not live credentials. The PayPal webhook must be reachable by PayPal during payment testing. For local testing, this requires a public HTTPS tunnel to the application's webhook route, `/api/paypal/webhook`. Register the resulting URL in the PayPal Developer Dashboard and use its webhook ID above.

### 4. Configure and start the AI agent

The agent has a separate environment file. From the repository root:

```bash
cd signpay-agent
cp .env.example .env
bun install
```

Set these values in `signpay-agent/.env`:

| Variable | Purpose |
|---|---|
| `ASTRO_GATEWAY_URL` | Astropods AI Gateway endpoint. |
| `ASTRO_GATEWAY_API_KEY` | Astropods AI Gateway API key. |
| `SIGNPAY_AGENT_API_KEY` | The same shared secret configured in the main application's `.env.local`. |

The agent uses the Astropods Gateway and the model configured in `astropods.yml`. Authenticate the Astropods CLI and start the project:

```bash
ast login
ast project start
```

The agent listens on port `8080` within its service configuration. Astropods may expose it through a local development URL; set `SIGNPAY_AGENT_URL` in the main application's `.env.local` to the URL reported by the CLI. In the current local development setup this has been `http://localhost:3200`.

For further agent-specific details, see [signpay-agent/README.md](signpay-agent/README.md).

### 5. Start the main application

Open a separate terminal at the repository root:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 6. PayPal Sandbox testing

Use a PayPal Sandbox buyer account to pay invoices sent to the customer email address. Configure a webhook endpoint reachable by PayPal and register its webhook identifier in `.env.local`. The application verifies webhook signatures before recording payment confirmation.

Do not use live PayPal credentials for demonstration or testing.


## Hackathon project

SignPay explores how AI assessment can be combined with signed agreements, deterministic checks and payment infrastructure. Its central design principle is to keep the AI's role limited: it assesses text submitted by the participants, while application logic enforces fixed agreement and payment checks, the customer can only object after the provider's request passes its initial assessment, participants retain responsibility for resolving uncertain cases, and PayPal remains responsible for processing payments.
