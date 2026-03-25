#!/usr/bin/env bash
set -e

BACKUP_DIR=".tmp_backup"

cleanup() {
  if [ -d "$BACKUP_DIR/api" ]; then
    cp -r "$BACKUP_DIR/api" src/app/api
  fi
  if [ -f "$BACKUP_DIR/histid_page.tsx" ]; then
    cp "$BACKUP_DIR/histid_page.tsx" "src/app/history/[id]/page.tsx"
  fi
  rm -rf "$BACKUP_DIR"
}
trap cleanup EXIT

mkdir -p "$BACKUP_DIR"

# Back up and remove API routes + dynamic history page
cp -r src/app/api "$BACKUP_DIR/api"
rm -rf src/app/api
cp "src/app/history/[id]/page.tsx" "$BACKUP_DIR/histid_page.tsx"
rm -f "src/app/history/[id]/page.tsx"

# Clean stale types that reference API routes
rm -rf .next

# Build static export (use --webpack to match dev mode and avoid Turbopack ESM issues)
STATIC_BUILD=1 NEXT_PUBLIC_STATIC=1 npx next build --webpack
