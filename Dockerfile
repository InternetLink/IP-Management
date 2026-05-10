FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends libsecret-1-0 openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY backend/package*.json ./backend/
RUN cd backend && npm ci

COPY frontend/package*.json ./frontend/
ARG HEROUI_AUTH_TOKEN
ENV HEROUI_AUTH_TOKEN=${HEROUI_AUTH_TOKEN}
RUN cd frontend && npm ci

COPY backend ./backend
COPY frontend ./frontend

ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN cd backend && npm run db:generate && npm run build
RUN cd frontend && npm run build

ENV NODE_ENV=production
ENV PORT=3003
ENV BACKEND_PORT=3001
ENV CORS_ORIGINS=http://localhost:3003

EXPOSE 3003

CMD ["sh", "-c", "cd /app/backend && sh scripts/start-prod.sh & backend_pid=$!; for i in $(seq 1 90); do if ! kill -0 $backend_pid 2>/dev/null; then wait $backend_pid; exit $?; fi; node -e \"const net=require('net'); const socket=net.connect(Number(process.env.BACKEND_PORT || 3001), '127.0.0.1'); socket.on('connect',()=>{socket.end(); process.exit(0)}); socket.on('error',()=>process.exit(1)); setTimeout(()=>process.exit(1), 1000);\" && break; echo 'Waiting for backend...'; sleep 1; done; if ! kill -0 $backend_pid 2>/dev/null; then wait $backend_pid; exit $?; fi; cd /app/frontend && npm run start"]
