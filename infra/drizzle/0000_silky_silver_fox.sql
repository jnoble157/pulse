CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"actor" varchar(128) NOT NULL,
	"action" varchar(128) NOT NULL,
	"target_kind" varchar(64) NOT NULL,
	"target_id" text,
	"before" jsonb,
	"after" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"stage" varchar(32) NOT NULL,
	"output" jsonb NOT NULL,
	"prompt_version" varchar(64) NOT NULL,
	"model" varchar(64) NOT NULL,
	"cost_cents" double precision DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_guests" (
	"call_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"confidence" double precision NOT NULL,
	"resolution_method" varchar(48) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_guests_call_id_guest_id_pk" PRIMARY KEY("call_id","guest_id")
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" varchar(32) NOT NULL,
	"external_call_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"duration_s" integer NOT NULL,
	"audio_url" text,
	"language" varchar(16),
	"raw_transcript" jsonb NOT NULL,
	"redacted_transcript" jsonb,
	"redaction_map_id" uuid,
	"menu_version_id" uuid,
	"status" varchar(32) DEFAULT 'received' NOT NULL,
	"ingest_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calls_provider_external_uq" UNIQUE("provider","external_call_id")
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"guest_id" uuid NOT NULL,
	"channel" varchar(32) NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"source" varchar(48) NOT NULL,
	"audit" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dataset_id" varchar(64) NOT NULL,
	"commit_sha" varchar(40),
	"prompt_version" varchar(64) NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_cents" double precision DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "extraction_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"stage" varchar(32) NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"input_hash" varchar(64),
	"output_hash" varchar(64),
	"error" text,
	"retries" integer DEFAULT 0 NOT NULL,
	"scheduled_for" timestamp with time zone,
	"claimed_by" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extraction_jobs_call_stage_uq" UNIQUE("call_id","stage")
);
--> statement-breakpoint
CREATE TABLE "guest_merges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"merged_from" uuid NOT NULL,
	"merged_into" uuid NOT NULL,
	"reason" text NOT NULL,
	"merged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reversible_until" timestamp with time zone NOT NULL,
	"reversed_at" timestamp with time zone,
	"actor" varchar(64) DEFAULT 'system' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"phones" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"names" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"voice_embedding" vector(256),
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ltv_cents" bigint DEFAULT 0 NOT NULL,
	"churn_score" double precision DEFAULT 0 NOT NULL,
	"predicted_next_order_at" timestamp with time zone,
	"order_count" integer DEFAULT 0 NOT NULL,
	"avg_ticket_cents" integer DEFAULT 0 NOT NULL,
	"order_rhythm_days_mean" double precision,
	"order_rhythm_days_std" double precision,
	"consent" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(32) NOT NULL,
	"tenant_id" uuid NOT NULL,
	"external_call_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"call_id" uuid,
	"signature" text,
	CONSTRAINT "ingest_events_provider_external_uq" UNIQUE("provider","tenant_id","external_call_id")
);
--> statement-breakpoint
CREATE TABLE "insight_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"insight_id" uuid NOT NULL,
	"kind" varchar(48) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(32) DEFAULT 'proposed' NOT NULL,
	"created_by" varchar(64) DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"executed_at" timestamp with time zone,
	"result" jsonb,
	"audit_trail" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "insight_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"insight_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"span_start_ms" integer NOT NULL,
	"span_end_ms" integer NOT NULL,
	"relevance" double precision DEFAULT 1 NOT NULL,
	"extraction_field_path" text
);
--> statement-breakpoint
CREATE TABLE "insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" varchar(64) NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"evidence_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"impact_cents" bigint DEFAULT 0 NOT NULL,
	"confidence" double precision NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	"rank_score" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"novelty_decay" double precision DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"modifiers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	CONSTRAINT "menus_tenant_version_uq" UNIQUE("tenant_id","version")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"call_id" uuid,
	"guest_id" uuid,
	"items" jsonb NOT NULL,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"was_completed" boolean DEFAULT false NOT NULL,
	"pos_id" text,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redaction_maps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"map_encrypted" "bytea" NOT NULL,
	"key_id" varchar(128) NOT NULL,
	"nonce" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redaction_maps_call_uq" UNIQUE("call_id")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(120) NOT NULL,
	"name" text NOT NULL,
	"timezone" varchar(64) DEFAULT 'America/New_York' NOT NULL,
	"cuisine" varchar(64),
	"brand_voice_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"plan" varchar(32) DEFAULT 'demo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_extractions" ADD CONSTRAINT "call_extractions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_extractions" ADD CONSTRAINT "call_extractions_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_guests" ADD CONSTRAINT "call_guests_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_guests" ADD CONSTRAINT "call_guests_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_guests" ADD CONSTRAINT "call_guests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_menu_version_id_menus_id_fk" FOREIGN KEY ("menu_version_id") REFERENCES "public"."menus"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_jobs" ADD CONSTRAINT "extraction_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_jobs" ADD CONSTRAINT "extraction_jobs_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_merges" ADD CONSTRAINT "guest_merges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guests" ADD CONSTRAINT "guests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_events" ADD CONSTRAINT "ingest_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_events" ADD CONSTRAINT "ingest_events_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_actions" ADD CONSTRAINT "insight_actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_actions" ADD CONSTRAINT "insight_actions_insight_id_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_evidence" ADD CONSTRAINT "insight_evidence_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_evidence" ADD CONSTRAINT "insight_evidence_insight_id_insights_id_fk" FOREIGN KEY ("insight_id") REFERENCES "public"."insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight_evidence" ADD CONSTRAINT "insight_evidence_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "menus_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redaction_maps" ADD CONSTRAINT "redaction_maps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redaction_maps" ADD CONSTRAINT "redaction_maps_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_tenant_idx" ON "audit_log" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "call_extractions_call_idx" ON "call_extractions" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "call_extractions_tenant_idx" ON "call_extractions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "call_extractions_stage_idx" ON "call_extractions" USING btree ("call_id","stage");--> statement-breakpoint
CREATE INDEX "call_guests_guest_idx" ON "call_guests" USING btree ("guest_id");--> statement-breakpoint
CREATE INDEX "call_guests_tenant_idx" ON "call_guests" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "calls_tenant_idx" ON "calls" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "calls_started_idx" ON "calls" USING btree ("tenant_id","started_at");--> statement-breakpoint
CREATE INDEX "consent_records_tenant_idx" ON "consent_records" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "consent_records_guest_channel_idx" ON "consent_records" USING btree ("guest_id","channel");--> statement-breakpoint
CREATE INDEX "extraction_jobs_tenant_idx" ON "extraction_jobs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "extraction_jobs_status_idx" ON "extraction_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "guest_merges_tenant_idx" ON "guest_merges" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "guests_tenant_idx" ON "guests" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "guests_last_seen_idx" ON "guests" USING btree ("tenant_id","last_seen");--> statement-breakpoint
CREATE INDEX "ingest_events_tenant_idx" ON "ingest_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "insight_actions_insight_idx" ON "insight_actions" USING btree ("insight_id");--> statement-breakpoint
CREATE INDEX "insight_actions_tenant_idx" ON "insight_actions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "insight_evidence_insight_idx" ON "insight_evidence" USING btree ("insight_id");--> statement-breakpoint
CREATE INDEX "insight_evidence_call_idx" ON "insight_evidence" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "insight_evidence_tenant_idx" ON "insight_evidence" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "insights_tenant_idx" ON "insights" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "insights_rank_idx" ON "insights" USING btree ("tenant_id","rank_score");--> statement-breakpoint
CREATE INDEX "insights_type_idx" ON "insights" USING btree ("tenant_id","type");--> statement-breakpoint
CREATE INDEX "menus_tenant_idx" ON "menus" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "orders_tenant_idx" ON "orders" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "orders_guest_idx" ON "orders" USING btree ("guest_id");--> statement-breakpoint
CREATE INDEX "redaction_maps_tenant_idx" ON "redaction_maps" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_uq" ON "tenants" USING btree ("slug");