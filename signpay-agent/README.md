# signpay-agent

Describe what your agent does in one sentence.

## Quick start

```bash
# Install dependencies
bun install

# Start the agent locally
ast dev
```

## Project structure

```
signpay-agent/
├── agent/
│   └── index.ts          # Agent entry point
├── astropods.yml             # Agent specification
├── Dockerfile            # Agent container
├── .env                  # Environment variables (set via ast configure; not committed)
└── package.json
```

## Configuration

The agent is configured in `astropods.yml`. Key sections:

### Model

Uses the **Astro AI Gateway** (a model with `provider: gateway`) for managed model access — no provider API key required. List selectable models under `models.default.models`; at deploy the model is chosen and injected as `MODEL_DEFAULT`. To let chat users switch models, add model ids to `MODELS` in `agent/index.ts`. The platform injects `ASTRO_GATEWAY_URL` and `ASTRO_GATEWAY_API_KEY` at runtime. Run `ast login` to authenticate; the gateway is account-scoped.

### Interfaces
- **Web** — HTTP/SSE endpoint (playground available at `localhost:3100` during dev)

