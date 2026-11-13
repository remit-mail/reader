ALTER TABLE `organize_job_request` ADD `sent_after` text DEFAULT 'None' NOT NULL;--> statement-breakpoint
ALTER TABLE `organize_job_request` ADD `sent_before` text DEFAULT 'None' NOT NULL;