/**
 * Drizzle schema — single source of truth for DB structure.
 *
 * Every tenant-scoped table includes
 * `tenant_id uuid not null` and an RLS policy applied via src/rls.ts.
 *
 * Invariant: a duplicated type/interface that mirrors one of these is a bug
 * (AGENTS.md §Hard invariants #1). Derive via Drizzle's `$inferSelect` /
 * `$inferInsert` or Zod schemas.
 */
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { TranscriptPayload } from './ingest.js';

// --- custom types ----------------------------------------------------------

/** pgvector vector(N). Drizzle doesn't ship a native vector type. */
const vector = (dimensions: number) =>
  customType<{ data: number[]; driverData: string }>({
    dataType: () => `vector(${dimensions})`,
    toDriver: (value) => `[${value.join(',')}]`,
    fromDriver: (value) => {
      if (typeof value !== 'string') throw new Error('expected vector string');
      return value.slice(1, -1).split(',').map(Number);
    },
  });

/** Postgres bytea column for KMS-encrypted blobs. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

// --- enums (as text + Zod unions rather than pg enums, for migration freedom)

export const CALL_STATUS = ['received', 'extracting', 'extracted', 'failed'] as const;
export type CallStatus = (typeof CALL_STATUS)[number];

export const EXTRACTION_STAGE = ['triage', 'entities', 'signals', 'qa'] as const;
export type ExtractionStage = (typeof EXTRACTION_STAGE)[number];

export const EXTRACTION_JOB_STATUS = [
  'pending',
  'claimed',
  'running',
  'succeeded',
  'failed',
  'dead_letter',
] as const;

export const INSIGHT_STATUS = ['active', 'dismissed', 'resolved', 'superseded'] as const;
export const INSIGHT_ACTION_STATUS = [
  'proposed',
  'approved',
  'executing',
  'completed',
  'failed',
  'cancelled',
] as const;

export const CONSENT_CHANNEL = ['sms', 'voice', 'email', 'voice_embedding'] as const;
export const CONSENT_SOURCE = [
  'verbal_captured',
  'form_signup',
  'operator_import_attested',
  'self_service_opt_in',
  'operator_bipa_ack',
] as const;

export const PROVIDER = ['vapi', 'retell', 'twilio_recorder', 'upload'] as const;
export type ProviderSlug = (typeof PROVIDER)[number];

// --- tenants --------------------------------------------------------------

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: varchar('slug', { length: 120 }).notNull(),
    name: text('name').notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull().default('America/New_York'),
    cuisine: varchar('cuisine', { length: 64 }),
    brand_voice_config: jsonb('brand_voice_config')
      .$type<BrandVoiceConfig>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    plan: varchar('plan', { length: 32 }).notNull().default('demo'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugUnique: uniqueIndex('tenants_slug_uq').on(t.slug),
  }),
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

export type BrandVoiceConfig = {
  voice?: string;
  tone?: string;
  signature_phrases?: string[];
  never_say?: string[];
};

// --- menus ----------------------------------------------------------------

export const menus = pgTable(
  'menus',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    items: jsonb('items')
      .$type<MenuItem[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    modifiers: jsonb('modifiers')
      .$type<MenuModifier[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    categories: jsonb('categories')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    synced_at: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    is_current: boolean('is_current').notNull().default(false),
  },
  (t) => ({
    tenantIdx: index('menus_tenant_idx').on(t.tenant_id),
    tenantVersionUq: unique('menus_tenant_version_uq').on(t.tenant_id, t.version),
  }),
);

export type Menu = typeof menus.$inferSelect;
export type NewMenu = typeof menus.$inferInsert;

export type MenuItem = {
  id: string;
  name: string;
  category: string;
  description?: string;
  price_cents: number;
  allergens?: string[];
  aliases?: string[];
  modifier_group_ids?: string[];
};

export type MenuModifier = {
  group_id: string;
  name: string;
  options: Array<{ id: string; name: string; price_delta_cents: number }>;
  required?: boolean;
  max_select?: number;
};

// --- calls ----------------------------------------------------------------

export const calls = pgTable(
  'calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 32 }).notNull(),
    external_call_id: text('external_call_id').notNull(),
    started_at: timestamp('started_at', { withTimezone: true }).notNull(),
    ended_at: timestamp('ended_at', { withTimezone: true }).notNull(),
    duration_s: integer('duration_s').notNull(),
    audio_url: text('audio_url'),
    language: varchar('language', { length: 16 }),
    raw_transcript: jsonb('raw_transcript').$type<TranscriptPayload>().notNull(),
    redacted_transcript: jsonb('redacted_transcript').$type<TranscriptPayload>(),
    redaction_map_id: uuid('redaction_map_id'),
    menu_version_id: uuid('menu_version_id').references(() => menus.id),
    status: varchar('status', { length: 32 }).notNull().default('received'),
    ingest_event_id: uuid('ingest_event_id'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('calls_tenant_idx').on(t.tenant_id),
    startedIdx: index('calls_started_idx').on(t.tenant_id, t.started_at),
    providerExternalUq: unique('calls_provider_external_uq').on(t.provider, t.external_call_id),
  }),
);

export type Call = typeof calls.$inferSelect;
export type NewCall = typeof calls.$inferInsert;

// TranscriptTurn / TranscriptPayload are defined (with Zod) in src/ingest.ts.
// Re-exported from the package index. Keeping them out of db.ts avoids the
// duplicate-symbol warning; Drizzle's $type<...>() uses structural types.

// --- call_extractions ------------------------------------------------------

export const call_extractions = pgTable(
  'call_extractions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    call_id: uuid('call_id')
      .notNull()
      .references(() => calls.id, { onDelete: 'cascade' }),
    stage: varchar('stage', { length: 32 }).notNull(),
    output: jsonb('output').notNull(),
    prompt_version: varchar('prompt_version', { length: 64 }).notNull(),
    model: varchar('model', { length: 64 }).notNull(),
    cost_cents: doublePrecision('cost_cents').notNull().default(0),
    latency_ms: integer('latency_ms').notNull().default(0),
    input_tokens: integer('input_tokens').notNull().default(0),
    output_tokens: integer('output_tokens').notNull().default(0),
    cache_read_tokens: integer('cache_read_tokens').notNull().default(0),
    cache_write_tokens: integer('cache_write_tokens').notNull().default(0),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    callIdx: index('call_extractions_call_idx').on(t.call_id),
    tenantIdx: index('call_extractions_tenant_idx').on(t.tenant_id),
    stageIdx: index('call_extractions_stage_idx').on(t.call_id, t.stage),
  }),
);

// --- guests ---------------------------------------------------------------

export const guests = pgTable(
  'guests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    phones: text('phones')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    names: text('names')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    voice_embedding: vector(256)('voice_embedding'),
    first_seen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
    last_seen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
    attributes: jsonb('attributes')
      .$type<GuestAttributes>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    ltv_cents: bigint('ltv_cents', { mode: 'number' }).notNull().default(0),
    churn_score: doublePrecision('churn_score').notNull().default(0),
    predicted_next_order_at: timestamp('predicted_next_order_at', { withTimezone: true }),
    order_count: integer('order_count').notNull().default(0),
    avg_ticket_cents: integer('avg_ticket_cents').notNull().default(0),
    order_rhythm_days_mean: doublePrecision('order_rhythm_days_mean'),
    order_rhythm_days_std: doublePrecision('order_rhythm_days_std'),
    consent: jsonb('consent')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('guests_tenant_idx').on(t.tenant_id),
    lastSeenIdx: index('guests_last_seen_idx').on(t.tenant_id, t.last_seen),
  }),
);

export type Guest = typeof guests.$inferSelect;
export type NewGuest = typeof guests.$inferInsert;

export type GuestAttributes = {
  dietary?: Array<{ kind: string; confidence: number; evidence_call_ids: string[] }>;
  allergens?: Array<{ kind: string; confidence: number; evidence_call_ids: string[] }>;
  favorites?: Array<{ item_id: string; count: number }>;
  disliked_items?: string[];
  service_preferences?: Record<string, string | number | boolean>;
  birthday?: string;
  first_order_at?: string;
};

// --- call_guests ----------------------------------------------------------

export const call_guests = pgTable(
  'call_guests',
  {
    call_id: uuid('call_id')
      .notNull()
      .references(() => calls.id, { onDelete: 'cascade' }),
    guest_id: uuid('guest_id')
      .notNull()
      .references(() => guests.id, { onDelete: 'cascade' }),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    confidence: doublePrecision('confidence').notNull(),
    resolution_method: varchar('resolution_method', { length: 48 }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.call_id, t.guest_id] }),
    guestIdx: index('call_guests_guest_idx').on(t.guest_id),
    tenantIdx: index('call_guests_tenant_idx').on(t.tenant_id),
  }),
);

// --- guest_merges ---------------------------------------------------------

export const guest_merges = pgTable(
  'guest_merges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    merged_from: uuid('merged_from').notNull(),
    merged_into: uuid('merged_into').notNull(),
    reason: text('reason').notNull(),
    merged_at: timestamp('merged_at', { withTimezone: true }).notNull().defaultNow(),
    reversible_until: timestamp('reversible_until', { withTimezone: true }).notNull(),
    reversed_at: timestamp('reversed_at', { withTimezone: true }),
    actor: varchar('actor', { length: 64 }).notNull().default('system'),
  },
  (t) => ({
    tenantIdx: index('guest_merges_tenant_idx').on(t.tenant_id),
  }),
);

// --- orders ---------------------------------------------------------------

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    call_id: uuid('call_id').references(() => calls.id, { onDelete: 'set null' }),
    guest_id: uuid('guest_id').references(() => guests.id, { onDelete: 'set null' }),
    items: jsonb('items').notNull(),
    subtotal_cents: integer('subtotal_cents').notNull().default(0),
    was_completed: boolean('was_completed').notNull().default(false),
    pos_id: text('pos_id'),
    placed_at: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('orders_tenant_idx').on(t.tenant_id),
    guestIdx: index('orders_guest_idx').on(t.guest_id),
  }),
);

// --- insights -------------------------------------------------------------

export const insights = pgTable(
  'insights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 64 }).notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    evidence_summary: jsonb('evidence_summary')
      .notNull()
      .default(sql`'{}'::jsonb`),
    impact_cents: bigint('impact_cents', { mode: 'number' }).notNull().default(0),
    confidence: doublePrecision('confidence').notNull(),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    window_start: timestamp('window_start', { withTimezone: true }).notNull(),
    window_end: timestamp('window_end', { withTimezone: true }).notNull(),
    rank_score: doublePrecision('rank_score').notNull().default(0),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    first_seen_at: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    novelty_decay: doublePrecision('novelty_decay').notNull().default(1),
  },
  (t) => ({
    tenantIdx: index('insights_tenant_idx').on(t.tenant_id),
    rankIdx: index('insights_rank_idx').on(t.tenant_id, t.rank_score),
    typeIdx: index('insights_type_idx').on(t.tenant_id, t.type),
  }),
);

// --- insight_evidence -----------------------------------------------------

export const insight_evidence = pgTable(
  'insight_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    insight_id: uuid('insight_id')
      .notNull()
      .references(() => insights.id, { onDelete: 'cascade' }),
    call_id: uuid('call_id')
      .notNull()
      .references(() => calls.id, { onDelete: 'cascade' }),
    span_start_ms: integer('span_start_ms').notNull(),
    span_end_ms: integer('span_end_ms').notNull(),
    relevance: doublePrecision('relevance').notNull().default(1),
    extraction_field_path: text('extraction_field_path'),
  },
  (t) => ({
    insightIdx: index('insight_evidence_insight_idx').on(t.insight_id),
    callIdx: index('insight_evidence_call_idx').on(t.call_id),
    tenantIdx: index('insight_evidence_tenant_idx').on(t.tenant_id),
  }),
);

// --- insight_actions ------------------------------------------------------

export const insight_actions = pgTable(
  'insight_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    insight_id: uuid('insight_id')
      .notNull()
      .references(() => insights.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 48 }).notNull(),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: varchar('status', { length: 32 }).notNull().default('proposed'),
    created_by: varchar('created_by', { length: 64 }).notNull().default('system'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    executed_at: timestamp('executed_at', { withTimezone: true }),
    result: jsonb('result'),
    audit_trail: jsonb('audit_trail')
      .notNull()
      .default(sql`'[]'::jsonb`),
  },
  (t) => ({
    insightIdx: index('insight_actions_insight_idx').on(t.insight_id),
    tenantIdx: index('insight_actions_tenant_idx').on(t.tenant_id),
  }),
);

// --- extraction_jobs ------------------------------------------------------

export const extraction_jobs = pgTable(
  'extraction_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    call_id: uuid('call_id')
      .notNull()
      .references(() => calls.id, { onDelete: 'cascade' }),
    stage: varchar('stage', { length: 32 }).notNull(),
    status: varchar('status', { length: 32 }).notNull().default('pending'),
    input_hash: varchar('input_hash', { length: 64 }),
    output_hash: varchar('output_hash', { length: 64 }),
    error: text('error'),
    retries: integer('retries').notNull().default(0),
    scheduled_for: timestamp('scheduled_for', { withTimezone: true }),
    claimed_by: varchar('claimed_by', { length: 64 }),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    callStageUq: unique('extraction_jobs_call_stage_uq').on(t.call_id, t.stage),
    tenantIdx: index('extraction_jobs_tenant_idx').on(t.tenant_id),
    statusIdx: index('extraction_jobs_status_idx').on(t.status),
  }),
);

// --- eval_runs (not tenant-scoped — platform data) ------------------------

export const eval_runs = pgTable('eval_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  dataset_id: varchar('dataset_id', { length: 64 }).notNull(),
  commit_sha: varchar('commit_sha', { length: 40 }),
  prompt_version: varchar('prompt_version', { length: 64 }).notNull(),
  metrics: jsonb('metrics')
    .notNull()
    .default(sql`'{}'::jsonb`),
  cost_cents: doublePrecision('cost_cents').notNull().default(0),
  duration_ms: integer('duration_ms').notNull().default(0),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- ingest_events --------------------------------------------------------

export const ingest_events = pgTable(
  'ingest_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: varchar('provider', { length: 32 }).notNull(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    external_call_id: text('external_call_id').notNull(),
    received_at: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb('payload').notNull(),
    processed: boolean('processed').notNull().default(false),
    call_id: uuid('call_id').references(() => calls.id, { onDelete: 'set null' }),
    signature: text('signature'),
  },
  (t) => ({
    providerExternalUq: unique('ingest_events_provider_external_uq').on(
      t.provider,
      t.tenant_id,
      t.external_call_id,
    ),
    tenantIdx: index('ingest_events_tenant_idx').on(t.tenant_id),
  }),
);

// --- consent_records ------------------------------------------------------

export const consent_records = pgTable(
  'consent_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    guest_id: uuid('guest_id')
      .notNull()
      .references(() => guests.id, { onDelete: 'cascade' }),
    channel: varchar('channel', { length: 32 }).notNull(),
    granted_at: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    revoked_at: timestamp('revoked_at', { withTimezone: true }),
    source: varchar('source', { length: 48 }).notNull(),
    audit: jsonb('audit')
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => ({
    tenantIdx: index('consent_records_tenant_idx').on(t.tenant_id),
    guestChannelIdx: index('consent_records_guest_channel_idx').on(t.guest_id, t.channel),
  }),
);

// --- redaction_maps -------------------------------------------------------

export const redaction_maps = pgTable(
  'redaction_maps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    call_id: uuid('call_id')
      .notNull()
      .references(() => calls.id, { onDelete: 'cascade' }),
    map_encrypted: bytea('map_encrypted').notNull(),
    key_id: varchar('key_id', { length: 128 }).notNull(),
    nonce: bytea('nonce').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    callUq: unique('redaction_maps_call_uq').on(t.call_id),
    tenantIdx: index('redaction_maps_tenant_idx').on(t.tenant_id),
  }),
);

// --- audit_log ------------------------------------------------------------

export const audit_log = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id'),
    actor: varchar('actor', { length: 128 }).notNull(),
    action: varchar('action', { length: 128 }).notNull(),
    target_kind: varchar('target_kind', { length: 64 }).notNull(),
    target_id: text('target_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('audit_log_tenant_idx').on(t.tenant_id),
    actionIdx: index('audit_log_action_idx').on(t.action),
  }),
);

// --- tables that must have RLS applied ------------------------------------

/**
 * Every tenant-scoped table. Used by src/rls.ts and the rls.test.ts
 * introspection check. Adding a tenant-scoped table means adding it here;
 * the introspection test will fail otherwise (AGENTS.md §Hard invariants #4).
 */
export const TENANT_SCOPED_TABLES = [
  'tenants',
  'menus',
  'calls',
  'call_extractions',
  'guests',
  'call_guests',
  'guest_merges',
  'orders',
  'insights',
  'insight_evidence',
  'insight_actions',
  'extraction_jobs',
  'ingest_events',
  'consent_records',
  'redaction_maps',
] as const;

export type TenantScopedTable = (typeof TENANT_SCOPED_TABLES)[number];
