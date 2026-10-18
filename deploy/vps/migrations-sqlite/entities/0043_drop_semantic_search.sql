DROP TABLE `outbox`;--> statement-breakpoint
DROP TABLE `filter_anchor`;--> statement-breakpoint
ALTER TABLE `filter` DROP COLUMN `has_anchor`;--> statement-breakpoint
ALTER TABLE `organize_job_request` DROP COLUMN `anchor_message_id`;--> statement-breakpoint
ALTER TABLE `organize_job_request` DROP COLUMN `similarity_threshold`;