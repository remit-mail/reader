DROP TABLE `outbox`;--> statement-breakpoint
DROP TABLE `filter_anchor`;--> statement-breakpoint
DELETE FROM `filter` WHERE `literal_clauses` = '[]';--> statement-breakpoint
ALTER TABLE `filter` DROP COLUMN `has_anchor`;--> statement-breakpoint
ALTER TABLE `organize_job_request` DROP COLUMN `anchor_message_id`;--> statement-breakpoint
ALTER TABLE `organize_job_request` DROP COLUMN `similarity_threshold`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_filter` (
	`filter_id` text PRIMARY KEY NOT NULL,
	`account_config_id` text NOT NULL,
	`name` text NOT NULL,
	`scope` text NOT NULL,
	`expires_at` text,
	`ttl` integer,
	`state` text DEFAULT 'Active' NOT NULL,
	`disabled_reason` text DEFAULT 'None' NOT NULL,
	`rule_changed_at` integer NOT NULL,
	`action_changed_at` integer NOT NULL,
	`match_operator` text DEFAULT 'And' NOT NULL,
	`literal_clauses` text NOT NULL,
	`action_label_id` text DEFAULT 'None' NOT NULL,
	`action_mailbox_id` text DEFAULT 'None' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_filter`("filter_id", "account_config_id", "name", "scope", "expires_at", "ttl", "state", "disabled_reason", "rule_changed_at", "action_changed_at", "match_operator", "literal_clauses", "action_label_id", "action_mailbox_id", "created_at", "updated_at") SELECT "filter_id", "account_config_id", "name", "scope", "expires_at", "ttl", "state", "disabled_reason", "rule_changed_at", "action_changed_at", "match_operator", "literal_clauses", "action_label_id", "action_mailbox_id", "created_at", "updated_at" FROM `filter`;--> statement-breakpoint
DROP TABLE `filter`;--> statement-breakpoint
ALTER TABLE `__new_filter` RENAME TO `filter`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `filter_by_account_and_state` ON `filter` (`account_config_id`,`state`,`filter_id`);--> statement-breakpoint
CREATE INDEX `filter_primary` ON `filter` (`account_config_id`,`filter_id`);