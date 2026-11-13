PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_account` (
	`account_id` text PRIMARY KEY,
	`account_config_id` text NOT NULL,
	`username` text NOT NULL,
	`email` text NOT NULL,
	`auth_type` text DEFAULT 'password' NOT NULL,
	`synced_services` text DEFAULT '["Mail"]' NOT NULL,
	`granted_scopes` text DEFAULT '[]' NOT NULL,
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
INSERT INTO `__new_account`(`account_id`, `account_config_id`, `username`, `email`, `auth_type`, `synced_services`, `granted_scopes`, `password_hash`, `oauth_refresh_token_hash`, `oauth_token_updated_at`, `imap_host`, `imap_port`, `imap_tls`, `imap_start_tls`, `smtp_enabled`, `smtp_host`, `smtp_port`, `smtp_tls`, `smtp_start_tls`, `smtp_username`, `smtp_password_hash`, `is_active`, `connection_state`, `last_connected_at`, `last_sync_at`, `last_error`, `sync_phase`, `mailbox_count_total`, `mailbox_count_synced`, `created_at`, `updated_at`, `deleted_at`) SELECT `account_id`, `account_config_id`, `username`, `email`, `auth_type`, `synced_services`, `granted_scopes`, `password_hash`, `oauth_refresh_token_hash`, `oauth_token_updated_at`, `imap_host`, `imap_port`, `imap_tls`, `imap_start_tls`, `smtp_enabled`, `smtp_host`, `smtp_port`, `smtp_tls`, `smtp_start_tls`, `smtp_username`, `smtp_password_hash`, `is_active`, `connection_state`, `last_connected_at`, `last_sync_at`, `last_error`, `sync_phase`, `mailbox_count_total`, `mailbox_count_synced`, `created_at`, `updated_at`, `deleted_at` FROM `account`;--> statement-breakpoint
DROP TABLE `account`;--> statement-breakpoint
ALTER TABLE `__new_account` RENAME TO `account`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `account_by_account_config_id` ON `account` (`account_config_id`,`account_id`);