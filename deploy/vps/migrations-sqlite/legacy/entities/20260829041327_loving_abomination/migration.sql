CREATE TABLE `calendar_suggestion` (
	`suggestion_id` text NOT NULL,
	`account_config_id` text NOT NULL,
	`message_id` text NOT NULL,
	`body_part_id` text NOT NULL,
	`ical_uid` text NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`method` text DEFAULT 'None' NOT NULL,
	`source` text DEFAULT 'IcalendarPart' NOT NULL,
	`state` text DEFAULT 'Pending' NOT NULL,
	`summary` text NOT NULL,
	`dt_start` text NOT NULL,
	`dt_end` text NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`organizer` text DEFAULT '' NOT NULL,
	`zone_certainty` text DEFAULT 'Explicit' NOT NULL,
	`ical_data` text DEFAULT '' NOT NULL,
	`accepted_calendar_object_id` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`account_config_id`, `suggestion_id`)
);
--> statement-breakpoint
CREATE INDEX `calendar_suggestion_by_state` ON `calendar_suggestion` (`account_config_id`,`state`,`created_at`,`suggestion_id`);--> statement-breakpoint
CREATE INDEX `calendar_suggestion_by_message` ON `calendar_suggestion` (`account_config_id`,`message_id`,`suggestion_id`);