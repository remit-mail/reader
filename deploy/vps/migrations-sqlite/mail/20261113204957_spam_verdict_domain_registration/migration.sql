CREATE TABLE `domain_registration` (
	`domain_registration_id` text PRIMARY KEY,
	`registration` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `message` ADD `spam_verdict` text DEFAULT '{"state":"NotChecked"}' NOT NULL;