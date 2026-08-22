# syntax=docker/dockerfile:1.10

FROM node:20-bookworm-slim AS backend-builder

WORKDIR /app/backend

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./
COPY backend/prisma ./prisma
RUN npm ci

COPY backend/nest-cli.json backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run db:generate && npm run build

FROM node:20-bookworm-slim AS backend-production-deps

WORKDIR /app/backend

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./
COPY backend/prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force

FROM node:20-bookworm-slim AS frontend-builder

WORKDIR /app/frontend

RUN apt-get update \
  && apt-get install -y --no-install-recommends libsecret-1-0 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY frontend/package*.json ./
RUN --mount=type=secret,id=heroui_token,env=HEROUI_AUTH_TOKEN,required=true npm ci

ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_TELEMETRY_DISABLED=1

COPY frontend/next-env.d.ts frontend/next.config.ts frontend/tsconfig.json frontend/postcss.config.mjs frontend/eslint.config.mjs ./
COPY frontend/src ./src
RUN npm run build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3003 \
    BACKEND_PORT=3001 \
    APP_ORIGIN=http://localhost:3003 \
    API_PROXY_TARGET=http://127.0.0.1:3001 \
    CORS_ORIGINS=http://localhost:3003

LABEL io.ipam.image.name="ipam-combined" \
      io.ipam.image.dockerfile="Dockerfile" \
      io.ipam.image.secret-required="true" \
      io.ipam.image.entrypoint="sh /app/scripts/start-combined.sh" \
      io.ipam.image.ports="public=3003,backend=3001" \
      io.ipam.image.runtime-uid="1000"

COPY --from=backend-production-deps --chown=node:node /app/backend/node_modules ./backend/node_modules
COPY --from=backend-builder --chown=node:node /app/backend/dist ./backend/dist
COPY --chown=node:node backend/package*.json ./backend/
COPY --chown=node:node backend/prisma ./backend/prisma
COPY --chown=node:node backend/scripts ./backend/scripts
COPY --from=frontend-builder --chown=node:node /app/frontend/.next/standalone ./frontend/
COPY --from=frontend-builder --chown=node:node /app/frontend/.next/static ./frontend/.next/static
COPY --chown=node:node scripts/start-combined.sh ./scripts/start-combined.sh

USER node

EXPOSE 3003

ENTRYPOINT ["sh", "/app/scripts/start-combined.sh"]
