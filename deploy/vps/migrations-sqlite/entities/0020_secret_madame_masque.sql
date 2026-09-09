CREATE TABLE `calendar_feed_token` (
	`feed_token_id` text NOT NULL,
	`account_config_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`rotated_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`account_config_id`, `feed_token_id`)
);
--> statement-breakpoint
CREATE INDEX `calendar_feed_token_by_token_hash` ON `calendar_feed_token` (`token_hash`);