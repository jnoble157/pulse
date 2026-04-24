#!/usr/bin/env tsx
/**
 * `pnpm seed:voice` — ensure the demo restaurant exists with a menu, no calls.
 *
 * The voice agent reads tenant + menu from Postgres at boot. This script is
 * the smallest path to a working local setup without synthetic call history.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { makeDb, menus, tenants, withAdmin, type MenuItem } from '../src/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
try {
  process.loadEnvFile(resolve(repoRoot, '.env'));
} catch {
  /* optional */
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[seed:voice] DATABASE_URL is required.');
  process.exit(1);
}

const SLUG = process.env.PULSE_TENANT_SLUG ?? 'tonys-pizza-austin';

/** Enough items for the agent prompt and common demo orders. */
const MENU_ITEMS: MenuItem[] = [
  {
    id: 'item-pep-lg',
    name: 'Large Pepperoni Pizza',
    category: 'Pizza',
    description: 'Classic pepperoni, large',
    price_cents: 1899,
    allergens: ['dairy', 'gluten'],
  },
  {
    id: 'item-cheese-md',
    name: 'Medium Cheese Pizza',
    category: 'Pizza',
    price_cents: 1499,
    allergens: ['dairy', 'gluten'],
  },
  {
    id: 'item-caesar',
    name: 'Caesar Salad',
    category: 'Salads',
    price_cents: 899,
    allergens: ['dairy', 'gluten', 'fish'],
  },
  {
    id: 'item-soda',
    name: 'Fountain Drink',
    category: 'Drinks',
    price_cents: 249,
  },
];

async function main() {
  const db = makeDb(DATABASE_URL);
  await withAdmin(db, async (tx) => {
    const [existing] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, SLUG));

    let tenantId: string;
    if (existing) {
      tenantId = existing.id;
      console.info(`[seed:voice] tenant already exists slug=${SLUG} id=${tenantId}`);
    } else {
      const [row] = await tx
        .insert(tenants)
        .values({
          slug: SLUG,
          name: "Tony's Pizza Austin",
          timezone: 'America/Chicago',
          cuisine: 'pizza',
          brand_voice_config: { voice: 'warm', tone: 'straightforward, no fluff' },
        })
        .returning({ id: tenants.id });
      tenantId = row!.id;
      console.info(`[seed:voice] created tenant slug=${SLUG} id=${tenantId}`);
    }

    const existingMenus = await tx.select({ id: menus.id }).from(menus).where(eq(menus.tenant_id, tenantId));
    if (existingMenus.length > 0) {
      console.info(`[seed:voice] menu row(s) already present (${existingMenus.length}), leaving as-is`);
      return;
    }

    await tx.insert(menus).values({
      tenant_id: tenantId,
      version: 1,
      items: MENU_ITEMS,
      modifiers: [],
      categories: ['Pizza', 'Salads', 'Drinks'],
      is_current: true,
    });
    console.info(`[seed:voice] inserted menu v1 (${MENU_ITEMS.length} items)`);
  });

  await (db as unknown as { $client?: { end?: () => Promise<void> } }).$client?.end?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
