ALTER TABLE `organize_job_request` ADD `start_position` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `organize_job_request` ADD `next_position` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `organize_job_request` ADD `remaining_count` integer DEFAULT 0 NOT NULL;