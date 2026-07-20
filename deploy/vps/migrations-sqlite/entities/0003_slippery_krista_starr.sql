CREATE TABLE `quarantine` (
	`quarantine_id` text PRIMARY KEY NOT NULL,
	`account_config_id` text NOT NULL,
	`account_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`uid` integer NOT NULL,
	`mailbox_role` text,
	`mailbox_path` text NOT NULL,
	`quarantined_at` integer NOT NULL,
	`attempts` integer NOT NULL,
	`failure_stage` text NOT NULL,
	`failure_code` text NOT NULL,
	`failure_message` text NOT NULL,
	`failure_part_path` text,
	`worker_version` text NOT NULL,
	`content_type` text NOT NULL,
	`transfer_encoding` text NOT NULL,
	`charset` text,
	`size_bytes` integer NOT NULL,
	`structure` text NOT NULL,
	`message_id_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `quarantine_by_account_config_id` ON `quarantine` (`account_config_id`,`quarantined_at`);