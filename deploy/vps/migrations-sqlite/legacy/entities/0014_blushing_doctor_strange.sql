CREATE TABLE `sender_signer_standing` (
	`account_config_id` text NOT NULL,
	`sender_key` text NOT NULL,
	`signer_domain` text NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`user_affirmed_at` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`account_config_id`, `sender_key`, `signer_domain`)
);
--> statement-breakpoint
ALTER TABLE `message` ADD `authenticity_verdict` text DEFAULT 'NotEvaluated' NOT NULL;