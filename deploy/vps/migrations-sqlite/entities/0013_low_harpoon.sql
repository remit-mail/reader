CREATE TABLE `outbox_attachment` (
	`outbox_attachment_id` text PRIMARY KEY NOT NULL,
	`outbox_message_id` text NOT NULL,
	`account_id` text NOT NULL,
	`account_config_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`state` text NOT NULL,
	`storage_key` text NOT NULL,
	`reservation_expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `outbox_attachment_by_outbox_message_id` ON `outbox_attachment` (`outbox_message_id`,`created_at`);