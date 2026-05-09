FROM node:20-alpine

WORKDIR /app

COPY backend/package*.json ./backend/
RUN cd backend && npm ci

COPY frontend/package*.json ./frontend/
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

CMD ["sh", "-c", "cd /app/backend && sh scripts/start-prod.sh & cd /app/frontend && npm run start"]
