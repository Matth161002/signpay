FROM oven/bun:1 AS builder

WORKDIR /app

ARG ASTRO_SDK_CHANNEL=latest

COPY package.json ./
RUN if [ "$ASTRO_SDK_CHANNEL" != "latest" ]; then \
      bun -e 'const fs=require("fs");const c=process.env.ASTRO_SDK_CHANNEL;const p=JSON.parse(fs.readFileSync("package.json","utf8"));for(const d of Object.keys(p.dependencies||{}))if(d.startsWith("@astropods/"))p.dependencies[d]=c;p.overrides={...p.overrides,"@astropods/messaging":c};fs.writeFileSync("package.json",JSON.stringify(p,null,2)+"\n")'; \
    fi
RUN bun install

COPY . .

FROM oven/bun:1-slim

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/agent ./agent
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production
ENV PORT=80
EXPOSE 80

CMD ["bun", "run", "agent/index.ts"]
