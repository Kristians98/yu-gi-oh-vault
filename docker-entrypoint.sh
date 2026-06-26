#!/bin/sh
set -e

echo "→ Applying schema to Postgres…"
npx prisma db push --schema=prisma/schema.postgres.prisma --skip-generate

echo "→ Seeding (skips card import if already present)…"
node prisma/seed.mjs || echo "seed step skipped/failed (continuing)"

echo "→ Starting Next.js…"
exec npm run start
