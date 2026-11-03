CREATE TABLE `calendar_task` (
	`calendar_task_id` text PRIMARY KEY NOT NULL,
	`calendar_id` text NOT NULL,
	`resource_name` text NOT NULL,
	`ical_uid` text NOT NULL,
	`ical_data` text NOT NULL,
	`etag` text NOT NULL,
	`summary` text NOT NULL,
	`description` text NOT NULL,
	`due` text NOT NULL,
	`due_at` text NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`completed` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `calendar_task_by_due` ON `calendar_task` (`calendar_id`,`due_at`);--> statement-breakpoint
CREATE INDEX `calendar_task_primary` ON `calendar_task` (`calendar_id`,`calendar_task_id`);