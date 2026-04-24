/**
 * Resolve the tenant context (id, name, brand voice, current menu) for the
 * voice agent. Hits the database read-only.
 *
 * The voice agent serves a single tenant per process today (the demo
 * tenant). Multi-tenant routing would key off the `To:` number Twilio
 * presents in `customParameters`, but that's a Phase 4 concern.
 */
import { and, desc, eq } from 'drizzle-orm';
import { makeDb, menus, tenants, withAdmin, type MenuItem } from '@pulse/schema';
import type { TenantContext } from './orchestrator.js';

export async function resolveTenantContext(opts: {
  databaseUrl: string;
  tenantSlug: string;
}): Promise<TenantContext> {
  const db = makeDb(opts.databaseUrl);
  return withAdmin(db, async (tx) => {
    const [tenant] = await tx
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        brand_voice_config: tenants.brand_voice_config,
      })
      .from(tenants)
      .where(eq(tenants.slug, opts.tenantSlug));
    if (!tenant) throw new Error(`tenant '${opts.tenantSlug}' not found`);

    const [menu] = await tx
      .select({ items: menus.items })
      .from(menus)
      .where(and(eq(menus.tenant_id, tenant.id), eq(menus.is_current, true)))
      .orderBy(desc(menus.version));
    const items: MenuItem[] = (menu?.items as MenuItem[] | undefined) ?? [];

    const voiceCfg = tenant.brand_voice_config as { voice?: string; tone?: string } | null;
    const brandVoice = voiceCfg ? [voiceCfg.voice, voiceCfg.tone].filter(Boolean).join('. ') : null;

    return {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
      brandVoice: brandVoice || null,
      menu: items,
    };
  });
}
