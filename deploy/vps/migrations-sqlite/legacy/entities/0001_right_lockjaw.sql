CREATE TABLE `organize_job_request` (
	`organize_job_id` text PRIMARY KEY NOT NULL,
	`account_config_id` text NOT NULL,
	`user_id` text NOT NULL,
	`state` text DEFAULT 'Pending' NOT NULL,
	`anchor_message_id` text DEFAULT 'None' NOT NULL,
	`match_operator` text DEFAULT 'And' NOT NULL,
	`literal_clauses` text NOT NULL,
	`similarity_threshold` real NOT NULL,
	`action_label_id` text DEFAULT 'None' NOT NULL,
	`action_mailbox_id` text DEFAULT 'None' NOT NULL,
	`matched_count` integer NOT NULL,
	`applied_count` integer NOT NULL,
	`failed_count` integer NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`ttl` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `organize_job_request_by_account_config_id` ON `organize_job_request` (`account_config_id`,`created_at`);