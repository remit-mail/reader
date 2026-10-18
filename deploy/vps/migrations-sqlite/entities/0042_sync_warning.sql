CREATE TABLE `sync_warning` (
	`sync_warning_id` text PRIMARY KEY NOT NULL,
	`account_config_id` text NOT NULL,
	`account_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`uid_validity` integer NOT NULL,
	`uid` integer NOT NULL,
	`stage` text NOT NULL,
	`attempts` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sync_warning_by_mailbox_id` ON `sync_warning` (`mailbox_id`,`uid`);--> statement-breakpoint
CREATE INDEX `sync_warning_by_account_config_id` ON `sync_warning` (`account_config_id`,`created_at`);