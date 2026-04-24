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

// scripts/ → schema/ → packages/ → repo root (for optional .env load)
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
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

/** Simple demo menu: 3 pizza styles across 3 sizes. */
const MENU_ITEMS: MenuItem[] = [
  {
    id: 'item-cheese-sm',
    name: 'Small Cheese Pizza',
    category: 'Pizza',
    description: 'Mozzarella + red sauce',
    price_cents: 1299,
    allergens: ['dairy', 'gluten'],
  },
  {
    id: 'item-cheese-md',
    name: 'Medium Cheese Pizza',
    category: 'Pizza',
    description: 'Mozzarella + red sauce',
    price_cents: 1499,
    allergens: ['dairy', 'gluten'],
  },
  {
    id: 'item-cheese-lg',
    name: 'Large Cheese Pizza',
    category: 'Pizza',
    description: 'Mozzarella + red sauce',
    price_cents: 1699,
    allergens: ['dairy', 'gluten'],
  },
  {
    id: 'item-pepperoni-sm',
    name: 'Small Pepperoni Pizza',
    category: 'Pizza',
    description: 'Pepperoni + mozzarella + red sauce',
    price_cents: 1399,
    allergens: ['dairy', 'gluten'],
    aliases: ['pep pizza'],
  },
  {
    id: 'item-pepperoni-md',
    name: 'Medium Pepperoni Pizza',
    category: 'Pizza',
    description: 'Pepperoni + mozzarella + red sauce',
    price_cents: 1599,
    allergens: ['dairy', 'gluten'],
    aliases: ['pep pizza'],
  },
  {
    id: 'item-pepperoni-lg',
    name: 'Large Pepperoni Pizza',
    category: 'Pizza',
    description: 'Pepperoni + mozzarella + red sauce',
    price_cents: 1799,
    allergens: ['dairy', 'gluten'],
    aliases: ['pep pizza'],
  },
  {
    id: 'item-veggie-sm',
    name: 'Small Veggie Pizza',
    category: 'Pizza',
    description: 'Bell pepper, onion, mushroom, olive',
    price_cents: 1399,
    allergens: ['dairy', 'gluten'],
  },
  {
    id: 'item-veggie-md',
    name: 'Medium Veggie Pizza',
    category: 'Pizza',
    description: 'Bell pepper, onion, mushroom, olive',
    price_cents: 1599,
    allergens: ['dairy', 'gluten'],
  },
  {
    id: 'item-veggie-lg',
    name: 'Large Veggie Pizza',
    category: 'Pizza',
    description: 'Bell pepper, onion, mushroom, olive',
    price_cents: 1799,
    allergens: ['dairy', 'gluten'],
  },
];

async function main() {
  const db = makeDb(DATABASE_URL);
  await withAdmin(db, async (tx) => {
    const [existing] = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, SLUG));

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

    const existingMenus = await tx
      .select({ id: menus.id })
      .from(menus)
      .where(eq(menus.tenant_id, tenantId));

    const nextVersion = existingMenus.length + 1;
    if (existingMenus.length > 0) {
      await tx.update(menus).set({ is_current: false }).where(eq(menus.tenant_id, tenantId));
      console.info(`[seed:voice] archived ${existingMenus.length} prior menu version(s)`);
    }

    await tx.insert(menus).values({
      tenant_id: tenantId,
      version: nextVersion,
      items: MENU_ITEMS,
      modifiers: [],
      categories: ['Pizza'],
      is_current: true,
    });
    console.info(`[seed:voice] inserted menu v${nextVersion} (${MENU_ITEMS.length} items)`);
  });

  await (db as unknown as { $client?: { end?: () => Promise<void> } }).$client?.end?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
