/**
 * HTTP + WebSocket server for the voice agent.
 *
 * Routes:
 *   - GET  /health                — liveness probe
 *   - POST /twilio/voice          — Twilio webhook on incoming call. Returns
 *                                   TwiML that opens a Media Stream against
 *                                   wss://<PUBLIC_BASE_URL>/twilio/media.
 *   - WS   /twilio/media          — Twilio Programmable Voice Media Stream.
 *                                   Bridged into Orchestrator.
 *
 * Twilio dials our `/twilio/voice` webhook synchronously; we respond with
 * TwiML, Twilio reads it, then opens the WebSocket to `/twilio/media`. From
 * that point on it's a streaming bidirectional bridge.
 */
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import type { WebSocket as WsWebSocket } from 'ws';
import { env } from './env.js';
import { Orchestrator, type TenantContext } from './orchestrator.js';
import { resolveTenantContext } from './tenant.js';

export async function startServer() {
  const e = env();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('[voice] DATABASE_URL is required to resolve tenant context.');
    process.exit(1);
  }

  // Resolve tenant once at boot. Re-resolve on the next call after a SIGHUP
  // if you change the menu and want it to land without a restart.
  let tenant: TenantContext = await resolveTenantContext({
    databaseUrl,
    tenantSlug: e.PULSE_TENANT_SLUG,
  });
  console.info(
    `[voice] tenant=${tenant.tenantSlug} menu_items=${tenant.menu.length} model=${e.AGENT_MODEL}`,
  );
  process.on('SIGHUP', () => {
    void resolveTenantContext({ databaseUrl, tenantSlug: e.PULSE_TENANT_SLUG })
      .then((next) => {
        tenant = next;
        console.info(`[voice] reloaded tenant context (${tenant.menu.length} menu items)`);
      })
      .catch((err) => console.warn('[voice] SIGHUP reload failed:', err));
  });

  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  app.get('/health', (c) => c.json({ ok: true, tenant: tenant.tenantSlug }));

  app.post('/twilio/voice', (c) => {
    const wsUrl = `${e.PUBLIC_BASE_URL.replace(/^http/, 'ws')}/twilio/media`;
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(wsUrl)}" />
  </Connect>
</Response>`;
    c.header('content-type', 'text/xml');
    return c.body(twiml);
  });

  app.get(
    '/twilio/media',
    upgradeWebSocket(() => ({
      onOpen(_evt, ws) {
        // Orchestrator owns the lifecycle from here. Reference held by the
        // event handlers it attaches to ws; we don't need to retain it.
        new Orchestrator(ws.raw as unknown as WsWebSocket, tenant, e);
      },
    })),
  );

  const server = serve({ fetch: app.fetch, port: e.PORT }, (info) => {
    console.info(`[voice] listening on :${info.port} (public ${e.PUBLIC_BASE_URL})`);
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
