# Multi-stage build for @pulse/voice deployed to Railway (or any container host).
#
# Build context MUST be the repo root. Railway: in the service settings, set
# `Build Command Path` (Dockerfile) to `apps/voice/Dockerfile` and leave
# `Watch Paths` to default. The image installs the pnpm workspace, builds
# @pulse/voice + its workspace deps (@pulse/schema, @pulse/telemetry), and
# ships a runtime stage running `node apps/voice/dist/index.js`.
#
# Required env at runtime (see apps/voice/README.md):
#   ANTHROPIC_API_KEY, DEEPGRAM_API_KEY, ELEVENLABS_API_KEY,
#   ELEVENLABS_VOICE_ID, DATABASE_URL, PULSE_TENANT_SLUG,
#   LIVE_CALLS_PUSH_TOKEN, WEB_BASE_URL, PUBLIC_BASE_URL, PII_ENCRYPTION_KEY.
# Railway sets $PORT automatically; src/env.ts coerces it.

# ---- builder ----
FROM node:22-slim AS builder
WORKDIR /repo

RUN corepack enable && corepack prepare pnpm@10.7.0 --activate

# Copy lockfile + every workspace manifest first so the install layer caches
# across code-only changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/voice/package.json apps/voice/
COPY apps/web/package.json apps/web/
COPY packages/schema/package.json packages/schema/
COPY packages/telemetry/package.json packages/telemetry/

RUN pnpm install --frozen-lockfile --filter @pulse/voice...

# Bring in source for the voice service and its workspace deps, then build.
COPY apps/voice apps/voice
COPY packages/schema packages/schema
COPY packages/telemetry packages/telemetry

RUN pnpm --filter @pulse/voice... build

# Strip dev deps in place so the runtime stage just copies the tree.
RUN pnpm --filter @pulse/voice... install --prod --frozen-lockfile --ignore-scripts

# ---- runtime ----
FROM node:22-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production

# Copy the built workspace. Image size is acceptable; this avoids the
# `pnpm deploy` corner cases with workspace `workspace:*` symlinks.
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/package.json ./package.json
COPY --from=builder /repo/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /repo/apps/voice/dist ./apps/voice/dist
COPY --from=builder /repo/apps/voice/package.json ./apps/voice/package.json
COPY --from=builder /repo/apps/voice/node_modules ./apps/voice/node_modules
COPY --from=builder /repo/packages/schema/dist ./packages/schema/dist
COPY --from=builder /repo/packages/schema/package.json ./packages/schema/package.json
COPY --from=builder /repo/packages/schema/node_modules ./packages/schema/node_modules
COPY --from=builder /repo/packages/telemetry/dist ./packages/telemetry/dist
COPY --from=builder /repo/packages/telemetry/package.json ./packages/telemetry/package.json
COPY --from=builder /repo/packages/telemetry/node_modules ./packages/telemetry/node_modules

# Railway injects $PORT. Default to 8788 for parity with local dev.
ENV PORT=8788
EXPOSE 8788

CMD ["node", "apps/voice/dist/index.js"]
