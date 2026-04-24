/**
 * Tenant slug registry (metadata only). The voice demo seeds DB rows via
 * `pnpm seed:voice`, not this table. Keep slugs aligned with `PULSE_TENANT_SLUG`.
 */
export type SeedDescriptor = {
  slug: string;
  name: string;
  timezone: string;
  cuisine?: string;
  description: string;
  /** Legacy field from the old synthetic-call seed; unused by `seed:voice`. */
  volume: number;
};

export const SEEDS: Record<string, SeedDescriptor> = {
  'tonys-pizza-austin': {
    slug: 'tonys-pizza-austin',
    name: "Tony's Pizza Austin",
    timezone: 'America/Chicago',
    cuisine: 'pizza',
    description:
      'Fictional Austin pizzeria used as the voice demo tenant (menu + brand voice in DB; no synthetic call requirement).',
    volume: 200,
  },
  'crust-pizza-demo': {
    slug: 'crust-pizza-demo',
    name: 'Crust Pizza Demo',
    timezone: 'America/Chicago',
    cuisine: 'pizza',
    description:
      '8-location chain. Secondary seed for multi-tenant screenshots. ~5k calls simulated.',
    volume: 5000,
  },
};

export const seedBySlug = (slug: string): SeedDescriptor | undefined => SEEDS[slug];
