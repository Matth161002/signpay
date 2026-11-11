# SignPay

**AI-assisted assessment of service payment requests against digitally signed agreements, with PayPal invoice and payment integration.**

SignPay is a prototype developed for the PayPal AI Hackathon. It is designed to help service providers and customers assess whether a payment request is consistent with the work and payment terms they agreed.

Rather than automatically deciding whether physical work has been completed, SignPay compares the provider's completion statement and any customer objection with the original agreement. It identifies clear discrepancies and sends uncertain cases for human review before the payment workflow proceeds.

## How it works

1. **Create an agreement.** The provider and customer record the service, agreed work, requirements and payment amount.
2. **Sign the agreement.** Both participants authenticate and provide a digital signature.
3. **Submit a payment request.** The provider supplies a completion statement and requested amount. The customer can submit an objection.
4. **Assess the request.** SignPay checks the requested amount against the agreed amount separately, then uses its AI assessment agent to compare the submitted information with the agreement.
5. **Issue an invoice.** Where the assessment permits the workflow to proceed, the application creates and sends a PayPal invoice.
6. **Confirm payment.** PayPal processes the payment. SignPay uses a verified PayPal webhook to record the confirmed payment status.

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
- **SQLite** for application data, including users, sessions, agreements, payment requests and audit events.
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
- The agent endpoint requires a shared API key and uses timing-safe comparison.
- Agent input and structured output are validated using Zod.
- User-supplied case descriptions are treated as untrusted data, not instructions that can change the agent's assessment rules.
- Uncertain AI assessments fall back to human review.
- PayPal webhook signatures are verified before payment status is updated.

These controls are intended to demonstrate security principles in a prototype. They do not constitute an independent security audit or certification.

## Important limitations

- **AI does not prove that work happened.** It assesses the consistency of the statements and information submitted against the agreement.
- **Evidence is not independently authenticated.** For example, a photograph supplied by a user is not proof that the depicted work was completed at the agreed location or time.
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

- Node.js and npm.
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

### 3. Configure environment variables

Create a local `.env.local` file in the repository root. Configure the values required by the application, including:

- PayPal Sandbox application credentials.
- PayPal business account email.
- PayPal webhook identifier.
- SignPay agent endpoint and shared authentication key.
- Any other environment values required by the application.

Create the agent's local environment configuration separately in `signpay-agent/`, including the Astropods Gateway credentials and the matching SignPay agent authentication key.

**Do not commit either environment file or share its contents.** Use the variable names expected by the application and agent configuration. Never put secret values in source code.

### 4. Configure and start the AI agent

From the agent directory:

```bash
cd signpay-agent
bun install
ast login
ast project start
```

Configure the required `SIGNPAY_AGENT_API_KEY` as an Astropods secret input, and ensure the main application uses the matching key. The agent's HTTP service defaults to port `8080` inside its development interface configuration.

For further agent-specific details, see [signpay-agent/README.md](signpay-agent/README.md).

### 5. Start the main application

In a separate terminal, from the repository root:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 6. PayPal Sandbox testing

Use PayPal Sandbox credentials and accounts when testing invoice creation and payment. Configure a webhook endpoint reachable by PayPal and register its webhook identifier in the local environment. The application verifies webhook signatures before recording payment confirmation.

Do not use live PayPal credentials for local demonstration or testing.

## Hackathon project

SignPay explores how AI assessment can be combined with signed agreements, deterministic checks and payment infrastructure. Its central design principle is to keep the AI's role limited: it assesses submitted information, while application logic enforces fixed agreement and payment checks, participants retain responsibility for resolving uncertain cases, and PayPal remains responsible for processing payments.
