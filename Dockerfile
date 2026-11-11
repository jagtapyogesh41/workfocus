FROM node:22-bookworm-slim AS app

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/admin/package.json ./apps/admin/package.json

RUN npm ci --no-audit --no-fund

COPY . .

RUN npm run build

ENV NODE_ENV=production
ENV API_PORT=4000
ENV API_INTERNAL_URL=http://127.0.0.1:4000
ENV AUTO_MIGRATE=true
ENV PILOT_DEMO_MODE=true
ENV AUTO_SEED=true
ENV SIMULATOR_ENABLED=true
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "run", "start"]
