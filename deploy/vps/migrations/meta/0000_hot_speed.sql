CREATE TABLE "instance_owner" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"user_id" text NOT NULL,
	"claimed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "instance_owner_singleton" CHECK ("instance_owner"."id" = 1)
);
