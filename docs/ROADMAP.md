# Roadmap

**Current (post ADR-038):** Voice-first demo shipped. Repo is `apps/web` + `apps/voice` + `packages/schema` + `packages/telemetry`, scripts for example audio, Docker Postgres for tenant/menu.

**Near-term (polish / GTM):** Railway + Twilio stable URL, measured latency table in deploy notes (`apps/voice/README.md` §Latency), cross-browser pass on `CallStage`, multi-process pub/sub if you need >1 Next instance. ElevenLabs: free tier’s 10k monthly credits are often enough for a light personal demo; paid tier adds commercial licensing and higher limits—see `apps/voice/README.md` §Env.

**If you resurrect analytics:** Recover ingestion → extraction → insights from git history; wire `LivePushClient` events into persistence or replay. That is a new ADR and weeks of work, not a sidebar.
