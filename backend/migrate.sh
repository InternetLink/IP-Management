#!/bin/bash
# Run this script from the backend directory to apply the schema changes
set -e

echo "==> Pushing new schema (drops old tables, creates prefixes table)..."
npx prisma db push --accept-data-loss

echo "==> Generating Prisma client..."
npx prisma generate

echo "==> Done! Schema applied successfully."
echo "==> You can now restart the backend with: npm run start:dev"
