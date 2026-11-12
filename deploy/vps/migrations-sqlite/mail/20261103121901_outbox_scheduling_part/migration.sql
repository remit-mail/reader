CREATE TABLE `outbox_scheduling_part` (
	`outbox_message_id` text PRIMARY KEY NOT NULL,
	`account_config_id` text NOT NULL,
	`calendar_object_id` text NOT NULL,
	`recipient` text NOT NULL,
	`method` text NOT NULL,
	`sequence` integer NOT NULL,
	`ical_data` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `outbox_scheduling_part_by_calendar_object` ON `outbox_scheduling_part` (`account_config_id`,`calendar_object_id`);