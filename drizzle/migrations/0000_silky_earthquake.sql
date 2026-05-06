CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(256) NOT NULL,
	"status" varchar(32) DEFAULT 'active' NOT NULL,
	"wa_token_encrypted" text,
	"phone_number_id" varchar(64),
	"verify_token" varchar(128),
	"owner_phone" varchar(32) NOT NULL,
	"owner_email" varchar(256),
	"bot_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"db_shard" varchar(50) DEFAULT 'shard-01' NOT NULL,
	"plan" varchar(50) DEFAULT 'starter' NOT NULL,
	"billing_amount" integer DEFAULT 0 NOT NULL,
	"subscription_status" varchar(32) DEFAULT 'trial' NOT NULL,
	"billing_cycle_start" date,
	"next_billing_date" date,
	"grace_period_days" integer DEFAULT 3 NOT NULL,
	"last_payment_at" timestamp with time zone,
	"trial_ends_at" date,
	"meta_live" boolean DEFAULT false NOT NULL,
	"meta_connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tenants_name_unique" UNIQUE("name"),
	CONSTRAINT "tenants_phone_number_id_unique" UNIQUE("phone_number_id"),
	CONSTRAINT "tenants_verify_token_unique" UNIQUE("verify_token"),
	CONSTRAINT "tenants_owner_phone_unique" UNIQUE("owner_phone"),
	CONSTRAINT "tenants_owner_email_unique" UNIQUE("owner_email")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(256) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price" integer NOT NULL,
	"sizes" text[] DEFAULT '{}' NOT NULL,
	"image_url" text DEFAULT '' NOT NULL,
	"emoji" varchar(8) DEFAULT '🛍️' NOT NULL,
	"category" varchar(128) DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"tenant_id" uuid NOT NULL,
	"wa_from" varchar(32) NOT NULL,
	"step" varchar(64) DEFAULT 'NEW' NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"shown_products" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_activity" timestamp with time zone DEFAULT now() NOT NULL,
	"reactivation_sent" boolean DEFAULT false NOT NULL,
	"abandoned_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_tenant_id_wa_from_pk" PRIMARY KEY("tenant_id","wa_from")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_phone" varchar(32) NOT NULL,
	"customer_name" varchar(256),
	"customer_address" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payment_method" varchar(64),
	"total" integer DEFAULT 0 NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_whatsapp_config" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"session_data" "bytea",
	"bot_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"webhook_secret" "bytea",
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "panel_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(64) NOT NULL,
	"email" varchar(256) NOT NULL,
	"password_hash" text NOT NULL,
	"role" varchar(32) NOT NULL,
	"tenant_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "panel_users_username_unique" UNIQUE("username"),
	CONSTRAINT "panel_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "panel_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"revoked_at" timestamp with time zone,
	"revoke_reason" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "panel_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "panel_rate_limits" (
	"key" varchar(256) PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"first_attempt_at" timestamp with time zone,
	"blocked_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_whatsapp_config" ADD CONSTRAINT "tenant_whatsapp_config_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panel_users" ADD CONSTRAINT "panel_users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panel_sessions" ADD CONSTRAINT "panel_sessions_user_id_panel_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."panel_users"("id") ON DELETE cascade ON UPDATE no action;