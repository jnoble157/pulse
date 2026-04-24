/**
 * HTTP + WebSocket server for the voice agent.
 *
 * Routes:
 *   - GET  /health                — liveness (always binds TCP); `ready` when DB tenant loaded
 *   - GET|POST /twilio/voice(/)   — Twilio webhook (Twilio may POST with a trailing slash). Returns
 *                                   TwiML that opens a Media Stream against
 *                                   wss://<PUBLIC_BASE_URL>/twilio/media.
 *   - WS   /twilio/media(/)       — Twilio Programmable Voice Media Stream.
 *                                   Bridged into Orchestrator.
 *
 * Twilio dials our `/twilio/voice` webhook synchronously; we respond with
 * TwiML, Twilio reads it, then opens the WebSocket to `/twilio/media`. From
 * that point on it's a streaming bidirectional bridge.
 *
 * Tenant context loads **after** the HTTP server starts so platforms (e.g.
 * Railway) that probe `/health` on PORT see a TCP listener immediately. If
 * migrations are not applied yet, `/health` returns `ready: false` until the
 * tenant row exists or a timeout elapses.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import type { WebSocket as WsWebSocket } from 'ws';
import { env } from './env.js';
import { Orchestrator, type TenantContext } from './orchestrator.js';
import { resolveTenantContext } from './tenant.js';
import { verifyTwilioSignature } from './twilio-signature.js';

const TENANT_BOOT_TIMEOUT_MS = 90_000;

/** Database segment of a `postgresql://…/dbname` URL (no credentials). */
function databaseNameFromJdbcUrl(url: string): string | null {
  try {
    const q = url.indexOf('?');
    const base = q === -1 ? url : url.slice(0, q);
    const slash = base.lastIndexOf('/');
    if (slash === -1 || slash >= base.length - 1) return null;
    const name = decodeURIComponent(base.slice(slash + 1));
    return name || null;
  } catch {
    return null;
  }
}

export async function startServer() {
  const e = env();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[voice] DATABASE_URL is required to resolve tenant context.');
    process.exit(1);
  }

  let tenant: TenantContext | null = null;
  let tenantError: string | null = null;
  const bootStarted = Date.now();

  const loadTenant = async () => {
    try {
      const ctx = await resolveTenantContext({
        databaseUrl,
        tenantSlug: e.PULSE_TENANT_SLUG,
      });
      tenant = ctx;
      console.info(
        `[voice] tenant=${ctx.tenantSlug} menu_items=${ctx.menu.length} model=${e.AGENT_MODEL}`,
      );
    } catch (err) {
      tenantError = err instanceof Error ? err.message : String(err);
      const dbName = databaseNameFromJdbcUrl(databaseUrl);
      console.error(`[voice] tenant load failed (database=${dbName ?? 'unknown'}):`, err);
    }
  };

  void loadTenant();

  process.on('SIGHUP', () => {
    void resolveTenantContext({ databaseUrl, tenantSlug: e.PULSE_TENANT_SLUG })
      .then((next) => {
        tenant = next;
        tenantError = null;
        console.info(`[voice] reloaded tenant context (${next.menu.length} menu items)`);
      })
      .catch((err) => console.warn('[voice] SIGHUP reload failed:', err));
  });

  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  app.get('/health', (c) => {
    if (tenantError) {
      const dbName = databaseNameFromJdbcUrl(databaseUrl);
      const body: Record<string, string | boolean | undefined> = {
        ok: false,
        ready: false,
        error: tenantError,
        database: dbName ?? undefined,
        hint: 'Fix DATABASE_URL / run pnpm db:migrate && pnpm seed:voice against this database',
      };
      if (dbName === 'postgres' && /relation ["']?tenants["']? does not exist/i.test(tenantError)) {
        body.railway_hint =
          'Railway Postgres often has two logical DBs: `postgres` (empty) and `railway` (where plugins put data). Point DATABASE_URL at …/railway, redeploy, then re-run migrate+seed if needed.';
      }
      return c.json(body, 503);
    }
    if (!tenant) {
      const elapsed = Date.now() - bootStarted;
      if (elapsed > TENANT_BOOT_TIMEOUT_MS) {
        return c.json(
          {
            ok: false,
            ready: false,
            error: 'tenant_boot_timeout',
            hint: `No tenant after ${TENANT_BOOT_TIMEOUT_MS}ms — run pnpm seed:voice for slug ${e.PULSE_TENANT_SLUG}`,
          },
          503,
        );
      }
      return c.json({ ok: true, ready: false, tenant_slug: e.PULSE_TENANT_SLUG }, 200);
    }
    return c.json({ ok: true, ready: true, tenant: tenant.tenantSlug }, 200);
  });

  const publicBase = e.PUBLIC_BASE_URL.replace(/\/+$/, '');
  const serveTwilioVoice = async (c: Context) => {
    const requireTwilioSignature =
      process.env.NODE_ENV === 'production' || process.env.PULSE_REQUIRE_TWILIO_SIGNATURE === '1';
    if (requireTwilioSignature) {
      const rawUrl = new URL(c.req.url);
      const expectedUrl = `${publicBase}${c.req.path}${rawUrl.search}`;
      const formBody =
        c.req.method === 'POST' &&
        (c.req.header('content-type') ?? '').includes('application/x-www-form-urlencoded')
          ? await c.req.raw.text()
          : '';
      const validSignature = verifyTwilioSignature({
        authToken: e.TWILIO_AUTH_TOKEN,
        expectedUrl,
        signatureHeader: c.req.header('x-twilio-signature') ?? null,
        formBody,
      });
      if (!validSignature) {
        console.warn(`[voice] rejected unsigned /twilio/voice request (${c.req.method} ${c.req.path})`);
        return c.text('forbidden', 403);
      }
    }
    if (!tenant) {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Sorry, the line is not ready yet. Please try again in a minute.</Say>
</Response>`;
      c.header('content-type', 'text/xml');
      return c.body(twiml);
    }
    const wsUrl = `${publicBase.replace(/^http/, 'ws')}/twilio/media`;
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(wsUrl)}" />
  </Connect>
</Response>`;
    console.info(`[voice] /twilio/voice ${c.req.method} stream=${wsUrl}`);
    c.header('content-type', 'text/xml');
    return c.body(twiml);
  };
  for (const path of ['/twilio/voice', '/twilio/voice/'] as const) {
    app.get(path, serveTwilioVoice);
    app.post(path, serveTwilioVoice);
  }

  const twilioMediaUpgrade = upgradeWebSocket(() => ({
    onOpen(_evt, ws) {
      if (!tenant) {
        console.warn('[voice] media socket opened before tenant ready; closing');
        ws.close();
        return;
      }
      new Orchestrator(ws.raw as unknown as WsWebSocket, tenant, e);
    },
  }));
  app.get('/twilio/media', twilioMediaUpgrade);
  app.get('/twilio/media/', twilioMediaUpgrade);

  const server = serve({ fetch: app.fetch, port: e.PORT }, (info) => {
    console.info(`[voice] listening on :${info.port} (public ${publicBase})`);
  });
  injectWebSocket(server);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
