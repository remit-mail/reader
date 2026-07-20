PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_filter` (
	`filter_id` text PRIMARY KEY NOT NULL,
	`account_config_id` text NOT NULL,
	`name` text NOT NULL,
	`scope` text NOT NULL,
	`expires_at` text,
	`ttl` integer,
	`state` text DEFAULT 'Active' NOT NULL,
	`has_anchor` integer DEFAULT false NOT NULL,
	`rule_changed_at` integer NOT NULL,
	`match_operator` text DEFAULT 'And' NOT NULL,
	`literal_clauses` text DEFAULT '[]' NOT NULL,
	`action_label_id` text DEFAULT 'None' NOT NULL,
	`action_mailbox_id` text DEFAULT 'None' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_filter`("filter_id", "account_config_id", "name", "scope", "expires_at", "ttl", "state", "has_anchor", "rule_changed_at", "match_operator", "literal_clauses", "action_label_id", "action_mailbox_id", "created_at", "updated_at") SELECT "filter_id", "account_config_id", "name", "scope", "expires_at", "ttl", "state", "has_anchor", "rule_changed_at", "match_operator", "literal_clauses", "action_label_id", "action_mailbox_id", "created_at", "updated_at" FROM `filter`;--> statement-breakpoint
DROP TABLE `filter`;--> statement-breakpoint
ALTER TABLE `__new_filter` RENAME TO `filter`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `filter_by_account_and_state` ON `filter` (`account_config_id`,`state`,`filter_id`);--> statement-breakpoint
CREATE INDEX `filter_primary` ON `filter` (`account_config_id`,`filter_id`);--> statement-breakpoint
CREATE TABLE `__new_organize_job_request` (
	`organize_job_id` text PRIMARY KEY NOT NULL,
	`account_config_id` text NOT NULL,
	`user_id` text NOT NULL,
	`state` text DEFAULT 'Pending' NOT NULL,
	`anchor_message_id` text DEFAULT 'None' NOT NULL,
	`match_operator` text DEFAULT 'And' NOT NULL,
	`literal_clauses` text DEFAULT '[]' NOT NULL,
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
INSERT INTO `__new_organize_job_request`("organize_job_id", "account_config_id", "user_id", "state", "anchor_message_id", "match_operator", "literal_clauses", "similarity_threshold", "action_label_id", "action_mailbox_id", "matched_count", "applied_count", "failed_count", "error_message", "ttl", "created_at", "updated_at") SELECT "organize_job_id", "account_config_id", "user_id", "state", "anchor_message_id", "match_operator", "literal_clauses", "similarity_threshold", "action_label_id", "action_mailbox_id", "matched_count", "applied_count", "failed_count", "error_message", "ttl", "created_at", "updated_at" FROM `organize_job_request`;--> statement-breakpoint
DROP TABLE `organize_job_request`;--> statement-breakpoint
ALTER TABLE `__new_organize_job_request` RENAME TO `organize_job_request`;--> statement-breakpoint
CREATE INDEX `organize_job_request_by_account_config_id` ON `organize_job_request` (`account_config_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_outbox_message` (
	`outbox_message_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`account_config_id` text NOT NULL,
	`from_address` text NOT NULL,
	`from_name` text,
	`to_addresses` text NOT NULL,
	`cc_addresses` text DEFAULT '[]' NOT NULL,
	`bcc_addresses` text DEFAULT '[]' NOT NULL,
	`reply_to_address` text,
	`subject` text,
	`message_id_value` text NOT NULL,
	`in_reply_to` text,
	`references` text DEFAULT '[]' NOT NULL,
	`text_body` text,
	`html_body` text,
	`status` text NOT NULL,
	`last_error` text,
	`last_smtp_code` integer,
	`sent_at` integer,
	`smtp_message_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_outbox_message`("outbox_message_id", "account_id", "account_config_id", "from_address", "from_name", "to_addresses", "cc_addresses", "bcc_addresses", "reply_to_address", "subject", "message_id_value", "in_reply_to", "references", "text_body", "html_body", "status", "last_error", "last_smtp_code", "sent_at", "smtp_message_id", "created_at", "updated_at") SELECT "outbox_message_id", "account_id", "account_config_id", "from_address", "from_name", "to_addresses", "cc_addresses", "bcc_addresses", "reply_to_address", "subject", "message_id_value", "in_reply_to", "references", "text_body", "html_body", "status", "last_error", "last_smtp_code", "sent_at", "smtp_message_id", "created_at", "updated_at" FROM `outbox_message`;--> statement-breakpoint
DROP TABLE `outbox_message`;--> statement-breakpoint
ALTER TABLE `__new_outbox_message` RENAME TO `outbox_message`;--> statement-breakpoint
CREATE INDEX `outbox_message_by_account_id` ON `outbox_message` (`account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `__new_quarantine` (
	`quarantine_id` text PRIMARY KEY NOT NULL,
	`account_config_id` text NOT NULL,
	`account_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`uid_validity` integer NOT NULL,
	`uid` integer NOT NULL,
	`mailbox_role` text,
	`mailbox_path` text NOT NULL,
	`quarantined_at` integer NOT NULL,
	`attempts` integer NOT NULL,
	`failure_stage` text NOT NULL,
	`failure_code` text NOT NULL,
	`failure_message` text NOT NULL,
	`failure_part_path` text,
	`worker_version` text NOT NULL,
	`content_type` text,
	`transfer_encoding` text,
	`charset` text,
	`size_bytes` integer,
	`structure` text DEFAULT '[]' NOT NULL,
	`message_id_hash` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_quarantine`("quarantine_id", "account_config_id", "account_id", "mailbox_id", "uid_validity", "uid", "mailbox_role", "mailbox_path", "quarantined_at", "attempts", "failure_stage", "failure_code", "failure_message", "failure_part_path", "worker_version", "content_type", "transfer_encoding", "charset", "size_bytes", "structure", "message_id_hash", "created_at", "updated_at") SELECT "quarantine_id", "account_config_id", "account_id", "mailbox_id", "uid_validity", "uid", "mailbox_role", "mailbox_path", "quarantined_at", "attempts", "failure_stage", "failure_code", "failure_message", "failure_part_path", "worker_version", "content_type", "transfer_encoding", "charset", "size_bytes", "structure", "message_id_hash", "created_at", "updated_at" FROM `quarantine`;--> statement-breakpoint
DROP TABLE `quarantine`;--> statement-breakpoint
ALTER TABLE `__new_quarantine` RENAME TO `quarantine`;--> statement-breakpoint
CREATE INDEX `quarantine_by_account_config_id` ON `quarantine` (`account_config_id`,`quarantined_at`);