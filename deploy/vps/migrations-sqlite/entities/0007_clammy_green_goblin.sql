PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_account` (
	`account_id` text PRIMARY KEY NOT NULL,
	`account_config_id` text NOT NULL,
	`username` text NOT NULL,
	`email` text NOT NULL,
	`auth_type` text DEFAULT 'password' NOT NULL,
	`password_hash` text,
	`oauth_refresh_token_hash` text,
	`oauth_token_updated_at` integer,
	`imap_host` text NOT NULL,
	`imap_port` integer NOT NULL,
	`imap_tls` integer NOT NULL,
	`imap_start_tls` integer NOT NULL,
	`smtp_enabled` integer DEFAULT false NOT NULL,
	`smtp_host` text DEFAULT '' NOT NULL,
	`smtp_port` integer DEFAULT 587 NOT NULL,
	`smtp_tls` integer DEFAULT false NOT NULL,
	`smtp_start_tls` integer DEFAULT true NOT NULL,
	`smtp_username` text DEFAULT '' NOT NULL,
	`smtp_password_hash` text,
	`is_active` integer NOT NULL,
	`connection_state` text NOT NULL,
	`last_connected_at` integer,
	`last_sync_at` integer,
	`last_error` text,
	`sync_phase` text,
	`mailbox_count_total` integer,
	`mailbox_count_synced` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_account`("account_id", "account_config_id", "username", "email", "auth_type", "password_hash", "oauth_refresh_token_hash", "oauth_token_updated_at", "imap_host", "imap_port", "imap_tls", "imap_start_tls", "smtp_enabled", "smtp_host", "smtp_port", "smtp_tls", "smtp_start_tls", "smtp_username", "smtp_password_hash", "is_active", "connection_state", "last_connected_at", "last_sync_at", "last_error", "sync_phase", "mailbox_count_total", "mailbox_count_synced", "created_at", "updated_at", "deleted_at") SELECT "account_id", "account_config_id", "username", "email", "auth_type", "password_hash", "oauth_refresh_token_hash", "oauth_token_updated_at", "imap_host", "imap_port", "imap_tls", "imap_start_tls", "smtp_enabled", "smtp_host", "smtp_port", "smtp_tls", "smtp_start_tls", "smtp_username", "smtp_password_hash", "is_active", "connection_state", "last_connected_at", "last_sync_at", "last_error", "sync_phase", "mailbox_count_total", "mailbox_count_synced", "created_at", "updated_at", "deleted_at" FROM `account`;--> statement-breakpoint
DROP TABLE `account`;--> statement-breakpoint
ALTER TABLE `__new_account` RENAME TO `account`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `account_by_account_config_id` ON `account` (`account_config_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `__new_address` (
	`address_id` text PRIMARY KEY NOT NULL,
	`account_config_id` text NOT NULL,
	`display_name` text,
	`local_part` text NOT NULL,
	`domain` text NOT NULL,
	`normalized_email` text NOT NULL,
	`normalized_compound` text NOT NULL,
	`flags` text NOT NULL,
	`inbound_count` integer DEFAULT 0 NOT NULL,
	`outbound_count` integer DEFAULT 0 NOT NULL,
	`reply_count` integer DEFAULT 0 NOT NULL,
	`last_inbound_at` integer DEFAULT 0 NOT NULL,
	`last_outbound_at` integer,
	`last_reply_at` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_address`("address_id", "account_config_id", "display_name", "local_part", "domain", "normalized_email", "normalized_compound", "flags", "inbound_count", "outbound_count", "reply_count", "last_inbound_at", "last_outbound_at", "last_reply_at", "created_at", "updated_at") SELECT "address_id", "account_config_id", "display_name", "local_part", "domain", "normalized_email", "normalized_compound", "flags", "inbound_count", "outbound_count", "reply_count", "last_inbound_at", "last_outbound_at", "last_reply_at", "created_at", "updated_at" FROM `address`;--> statement-breakpoint
DROP TABLE `address`;--> statement-breakpoint
ALTER TABLE `__new_address` RENAME TO `address`;--> statement-breakpoint
CREATE INDEX `address_by_account_config_id` ON `address` (`account_config_id`,`normalized_compound`);--> statement-breakpoint
CREATE TABLE `__new_organize_job_request` (
	`organize_job_id` text PRIMARY KEY NOT NULL,
	`account_config_id` text NOT NULL,
	`user_id` text NOT NULL,
	`state` text DEFAULT 'Pending' NOT NULL,
	`anchor_message_id` text DEFAULT 'None' NOT NULL,
	`match_operator` text DEFAULT 'And' NOT NULL,
	`literal_clauses` text DEFAULT '[]' NOT NULL,
	`similarity_threshold` real DEFAULT 0.75 NOT NULL,
	`action_label_id` text DEFAULT 'None' NOT NULL,
	`action_mailbox_id` text DEFAULT 'None' NOT NULL,
	`matched_count` integer DEFAULT 0 NOT NULL,
	`applied_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`ttl` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_organize_job_request`("organize_job_id", "account_config_id", "user_id", "state", "anchor_message_id", "match_operator", "literal_clauses", "similarity_threshold", "action_label_id", "action_mailbox_id", "matched_count", "applied_count", "failed_count", "error_message", "ttl", "created_at", "updated_at") SELECT "organize_job_id", "account_config_id", "user_id", "state", "anchor_message_id", "match_operator", "literal_clauses", "similarity_threshold", "action_label_id", "action_mailbox_id", "matched_count", "applied_count", "failed_count", "error_message", "ttl", "created_at", "updated_at" FROM `organize_job_request`;--> statement-breakpoint
DROP TABLE `organize_job_request`;--> statement-breakpoint
ALTER TABLE `__new_organize_job_request` RENAME TO `organize_job_request`;--> statement-breakpoint
CREATE INDEX `organize_job_request_by_account_config_id` ON `organize_job_request` (`account_config_id`,`created_at`);