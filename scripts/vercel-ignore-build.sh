#!/usr/bin/env bash
# Vercel "Ignored Build Step": exit 0 = skip deployment, exit 1 = run build.
# See vercel.json ignoreCommand (must stay short; Vercel caps ignoreCommand at 256 chars).

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

if [[ -n "${VERCEL_FORCE_DEPLOY:-}" ]]; then
  exit 1
fi

if git diff --quiet HEAD~1 HEAD -- \
  apps/web \
  packages \
  vercel.json \
  turbo.json \
  package.json \
  pnpm-lock.yaml \
  pnpm-workspace.yaml
then
  exit 0
fi

exit 1
