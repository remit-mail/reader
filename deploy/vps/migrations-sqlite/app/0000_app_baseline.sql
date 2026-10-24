CREATE TABLE `account_config` (
	`account_config_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text,
	`state` text DEFAULT 'active' NOT NULL,
	`deleted_at` integer,
	`cascade_started_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `account_config_by_user_id` ON `account_config` (`user_id`,`account_config_id`);--> statement-breakpoint
CREATE TABLE `account_export_request` (
	`account_export_request_id` text PRIMARY KEY NOT NULL,
	`account_config_id` text NOT NULL,
	`user_id` text NOT NULL,
	`state` text DEFAULT 'Pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer,
	`object_key` text,
	`download_url` text,
	`error_message` text
);
--> statement-breakpoint
CREATE INDEX `account_export_request_by_account_config_id` ON `account_export_request` (`account_config_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `account_setting` (
	`account_setting_id` text PRIMARY KEY NOT NULL,
	`account_config_id` text NOT NULL,
	`name` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `account_setting_by_account_config_id` ON `account_setting` (`account_config_id`,`name`);--> statement-breakpoint
CREATE TABLE `account` (
	`account_id` text PRIMARY KEY NOT NULL,
	`account_config_id` text NOT NULL,
	`username` text NOT NULL,
	`email` text NOT NULL,
	`auth_type` text DEFAULT 'password' NOT NULL,
	`synced_services` text NOT NULL,
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
CREATE INDEX `account_by_account_config_id` ON `account` (`account_config_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `calendar` (
	`calendar_id` text PRIMARY KEY NOT NULL,
	`account_config_id` text NOT NULL,
	`url_segment` text NOT NULL,
	`display_name` text NOT NULL,
	`color` text DEFAULT 'Cal1' NOT NULL,
	`component_set` text DEFAULT 'VeventOnly' NOT NULL,
	`source` text DEFAULT 'UserCreated' NOT NULL,
	`timezone` text DEFAULT '' NOT NULL,
	`sync_sequence` integer DEFAULT 0 NOT NULL,
	`subscription_url` text DEFAULT '' NOT NULL,
	`subscription_enabled` integer DEFAULT false NOT NULL,
	`subscription_checked_at` integer DEFAULT 0 NOT NULL,
	`subscription_fetched_at` integer DEFAULT 0 NOT NULL,
	`subscription_error` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `calendar_by_url_segment` ON `calendar` (`account_config_id`,`url_segment`);--> statement-breakpoint
CREATE INDEX `calendar_primary` ON `calendar` (`account_config_id`,`calendar_id`);--> statement-breakpoint
CREATE TABLE `calendar_event_index` (
	`calendar_id` text NOT NULL,
	`calendar_object_id` text NOT NULL,
	`recurrence_id` text NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Confirmed' NOT NULL,
	`transparency` text DEFAULT 'Opaque' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`calendar_id`, `calendar_object_id`, `recurrence_id`)
);
--> statement-breakpoint
CREATE INDEX `calendar_event_index_by_start` ON `calendar_event_index` (`calendar_id`,`start_at`);--> statement-breakpoint
CREATE TABLE `calendar_feed_token` (
	`feed_token_id` text NOT NULL,
	`account_config_id` text NOT NULL,
	`calendar_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`rotated_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`account_config_id`, `feed_token_id`)
);
--> statement-breakpoint
CREATE INDEX `calendar_feed_token_by_token_hash` ON `calendar_feed_token` (`token_hash`);--> statement-breakpoint
CREATE TABLE `calendar_object` (
	`calendar_object_id` text PRIMARY KEY NOT NULL,
	`calendar_id` text NOT NULL,
	`resource_name` text NOT NULL,
	`ical_uid` text NOT NULL,
	`ical_data` text NOT NULL,
	`etag` text NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`sync_sequence` integer DEFAULT 0 NOT NULL,
	`summary` text NOT NULL,
	`dt_start` text NOT NULL,
	`dt_end` text NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`zone_certainty` text DEFAULT 'Explicit' NOT NULL,
	`status` text DEFAULT 'Confirmed' NOT NULL,
	`transparency` text DEFAULT 'Opaque' NOT NULL,
	`has_recurrence` integer DEFAULT false NOT NULL,
	`expanded_through` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `calendar_object_by_sync_sequence` ON `calendar_object` (`calendar_id`,`sync_sequence`);--> statement-breakpoint
CREATE INDEX `calendar_object_by_uid` ON `calendar_object` (`calendar_id`,`ical_uid`);--> statement-breakpoint
CREATE INDEX `calendar_object_primary` ON `calendar_object` (`calendar_id`,`calendar_object_id`);--> statement-breakpoint
CREATE TABLE `config_import` (
	`import_id` text PRIMARY KEY NOT NULL,
	`account_config_id` text NOT NULL,
	`schema_version` integer NOT NULL,
	`state` text DEFAULT 'Pending' NOT NULL,
	`document` text NOT NULL,
	`unresolved_refs` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `config_import_by_account_config_id` ON `config_import` (`account_config_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `filter` (
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
CREATE INDEX `filter_by_account_and_state` ON `filter` (`account_config_id`,`state`,`filter_id`);--> statement-breakpoint
CREATE INDEX `filter_primary` ON `filter` (`account_config_id`,`filter_id`);--> statement-breakpoint
CREATE TABLE `label` (
	`label_id` text PRIMARY KEY NOT NULL,
	`account_config_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`color` text DEFAULT 'Default' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `label_by_normalized_name` ON `label` (`account_config_id`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `label_primary` ON `label` (`account_config_id`,`label_id`);--> statement-breakpoint
CREATE TABLE `auth_account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `auth_account_userId_idx` ON `auth_account` (`user_id`);--> statement-breakpoint
CREATE TABLE `auth_jwks` (
	`id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`alg` text,
	`crv` text
);
--> statement-breakpoint
CREATE TABLE `auth_session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_session_token_unique` ON `auth_session` (`token`);--> statement-breakpoint
CREATE INDEX `auth_session_userId_idx` ON `auth_session` (`user_id`);--> statement-breakpoint
CREATE TABLE `auth_user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_user_email_unique` ON `auth_user` (`email`);--> statement-breakpoint
CREATE TABLE `auth_verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_verification_identifier_idx` ON `auth_verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `instance_owner` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`user_id` text NOT NULL,
	`claimed_at` integer NOT NULL,
	CONSTRAINT "instance_owner_singleton" CHECK("instance_owner"."id" = 1)
);
