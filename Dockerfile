# Production image — Next.js + Prisma against PostgreSQL.
# Full node_modules kept so the entrypoint can run `prisma db push` + seed.
FROM node:22-alpine
WORKDIR /app

# placeholder so `next build` never needs a live DB (all pages are dynamic / auth-gated)
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# generate the Postgres client + build
RUN npx prisma generate --schema=prisma/schema.postgres.prisma && npm run build

RUN chmod +x docker-entrypoint.sh
EXPOSE 3000
CMD ["sh", "docker-entrypoint.sh"]
