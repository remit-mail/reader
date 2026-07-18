CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`event` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`processed_at` integer
);
--> statement-breakpoint
CREATE INDEX `outbox_message_id_idx` ON `outbox` (`message_id`);--> statement-breakpoint
CREATE INDEX `outbox_unprocessed_idx` ON `outbox` (`created_at`) WHERE "outbox"."processed_at" IS NULL;--> statement-breakpoint
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
	`password_hash` text,
	`oauth_refresh_token_hash` text,
	`oauth_token_updated_at` integer,
	`imap_host` text NOT NULL,
	`imap_port` integer NOT NULL,
	`imap_tls` integer NOT NULL,
	`imap_start_tls` integer NOT NULL,
	`smtp_enabled` integer DEFAULT false NOT NULL,
	`smtp_host` text DEFAULT '' NOT NULL,
	`smtp_port` integer NOT NULL,
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
CREATE TABLE `address` (
	`address_id` text PRIMARY KEY NOT NULL,
	`account_config_id` text NOT NULL,
	`display_name` text,
	`local_part` text NOT NULL,
	`domain` text NOT NULL,
	`normalized_email` text NOT NULL,
	`normalized_compound` text NOT NULL,
	`flags` text NOT NULL,
	`inbound_count` integer NOT NULL,
	`outbound_count` integer NOT NULL,
	`reply_count` integer NOT NULL,
	`last_inbound_at` integer NOT NULL,
	`last_outbound_at` integer,
	`last_reply_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `address_by_account_config_id` ON `address` (`account_config_id`,`normalized_compound`);--> statement-breakpoint
CREATE TABLE `body_part_content` (
	`body_part_content_id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`body_part_id` text NOT NULL,
	`content` text NOT NULL,
	`content_length` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_part_content_by_message_id` ON `body_part_content` (`message_id`,`body_part_content_id`);--> statement-breakpoint
CREATE TABLE `body_part_parameter` (
	`body_part_parameter_id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`body_part_id` text NOT NULL,
	`parameter_name` text NOT NULL,
	`parameter_value` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_part_parameter_by_message_id` ON `body_part_parameter` (`message_id`,`body_part_parameter_id`);--> statement-breakpoint
CREATE TABLE `body_part_storage` (
	`body_part_storage_id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`body_part_id` text NOT NULL,
	`storage_type` text NOT NULL,
	`storage_location` text NOT NULL,
	`storage_key` text NOT NULL,
	`decoded_size_bytes` integer NOT NULL,
	`checksum_sha256` text NOT NULL,
	`content_encoding` text NOT NULL,
	`is_deduped` integer NOT NULL,
	`dedup_hash` text,
	`stored_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_part_storage_by_message_id` ON `body_part_storage` (`message_id`,`body_part_storage_id`);--> statement-breakpoint
CREATE TABLE `body_part` (
	`body_part_id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`parent_body_part_id` text,
	`part_path` text NOT NULL,
	`media_type` text NOT NULL,
	`media_subtype` text NOT NULL,
	`content_id` text,
	`content_description` text,
	`transfer_encoding` text NOT NULL,
	`size_octets` integer NOT NULL,
	`line_count` integer,
	`md5_hash` text,
	`disposition` text,
	`disposition_filename` text,
	`language` text,
	`location` text,
	`is_multipart` integer NOT NULL,
	`multipart_subtype` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_part_by_message_id` ON `body_part` (`message_id`,`body_part_id`);--> statement-breakpoint
CREATE TABLE `envelope_address` (
	`envelope_address_id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`address_id` text NOT NULL,
	`display_name` text,
	`normalized_email` text NOT NULL,
	`address_role` text NOT NULL,
	`address_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `envelope_address_by_message_id` ON `envelope_address` (`message_id`,`envelope_address_id`);--> statement-breakpoint
CREATE TABLE `envelope` (
	`envelope_id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`date_value` integer NOT NULL,
	`date_raw` text NOT NULL,
	`subject` text,
	`message_id_value` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `envelope_by_message_id` ON `envelope` (`message_id`,`envelope_id`);--> statement-breakpoint
CREATE TABLE `filter_anchor` (
	`account_config_id` text NOT NULL,
	`filter_id` text NOT NULL,
	`anchor_embedding` text NOT NULL,
	`anchor_embedding_id` text NOT NULL,
	`anchor_source_text` text NOT NULL,
	`anchor_message_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`account_config_id`, `filter_id`)
);
--> statement-breakpoint
CREATE TABLE `filter` (
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
CREATE TABLE `mailbox_attribute_entry` (
	`mailbox_attribute_id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`attribute_name` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mailbox_attribute_entry_by_mailbox_id` ON `mailbox_attribute_entry` (`mailbox_id`,`mailbox_attribute_id`);--> statement-breakpoint
CREATE TABLE `mailbox_flag` (
	`mailbox_flag_id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`flag_name` text NOT NULL,
	`is_permanent` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mailbox_flag_by_mailbox_id` ON `mailbox_flag` (`mailbox_id`,`mailbox_flag_id`);--> statement-breakpoint
CREATE TABLE `mailbox_lock` (
	`mailbox_id` text NOT NULL,
	`event_name` text NOT NULL,
	`account_id` text NOT NULL,
	`lock_id` text NOT NULL,
	`acquired_at` integer NOT NULL,
	`locked_by` text NOT NULL,
	`ttl` integer NOT NULL,
	PRIMARY KEY(`mailbox_id`, `event_name`)
);
--> statement-breakpoint
CREATE INDEX `mailbox_lock_all_locks` ON `mailbox_lock` (`acquired_at`);--> statement-breakpoint
CREATE INDEX `mailbox_lock_by_account_id` ON `mailbox_lock` (`account_id`,`mailbox_id`,`event_name`);--> statement-breakpoint
CREATE TABLE `mailbox_special_use_entry` (
	`mailbox_special_use_id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`special_use` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mailbox_special_use_entry_by_mailbox_id` ON `mailbox_special_use_entry` (`mailbox_id`,`mailbox_special_use_id`);--> statement-breakpoint
CREATE TABLE `mailbox` (
	`mailbox_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`namespace_type` text DEFAULT 'personal' NOT NULL,
	`namespace_prefix` text NOT NULL,
	`hierarchy_delimiter` text NOT NULL,
	`full_path` text NOT NULL,
	`uid_validity` integer NOT NULL,
	`uid_next` integer NOT NULL,
	`highest_modseq` integer NOT NULL,
	`message_count` integer NOT NULL,
	`unseen_count` integer NOT NULL,
	`deleted_count` integer NOT NULL,
	`total_size` integer NOT NULL,
	`last_sync_uid` integer NOT NULL,
	`high_water_mark_uid` integer NOT NULL,
	`last_message_sync_at` integer NOT NULL,
	`initial_sync_completed_at` integer,
	`parent_mailbox_id` text DEFAULT 'None' NOT NULL,
	`sync_status` text,
	`cursor_state` text DEFAULT 'normal' NOT NULL,
	`old_path` text,
	`special_use` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mailbox_by_account_id` ON `mailbox` (`account_id`);--> statement-breakpoint
CREATE TABLE `message_flag_push` (
	`message_id` text NOT NULL,
	`flag_name` text NOT NULL,
	`account_id` text NOT NULL,
	`account_config_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`operation` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`message_id`, `flag_name`)
);
--> statement-breakpoint
CREATE INDEX `message_flag_push_by_mailbox_id` ON `message_flag_push` (`mailbox_id`,`message_id`,`flag_name`);--> statement-breakpoint
CREATE INDEX `message_flag_push_by_account_id` ON `message_flag_push` (`account_id`,`message_id`,`flag_name`);--> statement-breakpoint
CREATE TABLE `message_flag` (
	`message_flag_id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`flag_name` text NOT NULL,
	`set_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `message_flag_by_message_id` ON `message_flag` (`message_id`,`message_flag_id`);--> statement-breakpoint
CREATE TABLE `message_label` (
	`message_label_id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`label_id` text NOT NULL,
	`account_config_id` text NOT NULL,
	`applied_by_filter_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `message_label_by_label_id` ON `message_label` (`account_config_id`,`label_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `message_label_by_message_id` ON `message_label` (`message_id`,`label_id`);--> statement-breakpoint
CREATE TABLE `message_placement_move` (
	`message_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`account_config_id` text NOT NULL,
	`source_mailbox_id` text NOT NULL,
	`destination_mailbox_id` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `message_placement_move_by_account_id` ON `message_placement_move` (`account_id`,`message_id`);--> statement-breakpoint
CREATE TABLE `message_reference` (
	`message_reference_id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`envelope_id` text NOT NULL,
	`message_id_value` text NOT NULL,
	`reference_type` text NOT NULL,
	`reference_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `message_reference_by_message_id` ON `message_reference` (`message_id`,`message_reference_id`);--> statement-breakpoint
CREATE TABLE `message` (
	`message_id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`uid` integer NOT NULL,
	`sequence_number` integer NOT NULL,
	`rfc822_size` integer NOT NULL,
	`internal_date` integer NOT NULL,
	`message_id_header` text,
	`envelope_id` text NOT NULL,
	`root_body_part_id` text NOT NULL,
	`body_storage_key` text,
	`status` text DEFAULT 'active' NOT NULL,
	`sync_status` text DEFAULT 'synced' NOT NULL,
	`original_mailbox_id` text,
	`original_uid` integer,
	`category` text DEFAULT 'uncategorized' NOT NULL,
	`authenticity` text,
	`auth_result` text,
	`provider_spam` text,
	`has_list_unsubscribe` integer DEFAULT false NOT NULL,
	`moved_by_remit` integer DEFAULT false NOT NULL,
	`placement_verdict` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `message_by_mailbox_id` ON `message` (`mailbox_id`,`uid`);--> statement-breakpoint
CREATE TABLE `outbox_message` (
	`outbox_message_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`account_config_id` text NOT NULL,
	`from_address` text NOT NULL,
	`from_name` text,
	`to_addresses` text NOT NULL,
	`cc_addresses` text NOT NULL,
	`bcc_addresses` text NOT NULL,
	`reply_to_address` text,
	`subject` text,
	`message_id_value` text NOT NULL,
	`in_reply_to` text,
	`references` text NOT NULL,
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
CREATE INDEX `outbox_message_by_account_id` ON `outbox_message` (`account_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `raw_message_storage` (
	`raw_storage_id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`storage_type` text NOT NULL,
	`storage_location` text NOT NULL,
	`storage_key` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`checksum_sha256` text NOT NULL,
	`content_encoding` text NOT NULL,
	`stored_at` integer NOT NULL,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `raw_message_storage_by_message_id` ON `raw_message_storage` (`message_id`,`raw_storage_id`);--> statement-breakpoint
CREATE TABLE `thread_message` (
	`thread_message_id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`message_id` text NOT NULL,
	`account_config_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`uid` integer NOT NULL,
	`message_id_header` text,
	`in_reply_to` text,
	`reference_order` integer NOT NULL,
	`from_email` text,
	`from_name` text,
	`subject` text,
	`internal_date` integer NOT NULL,
	`sent_date` integer NOT NULL,
	`is_read` integer NOT NULL,
	`has_attachment` integer NOT NULL,
	`star` text DEFAULT 'none' NOT NULL,
	`has_stars` integer NOT NULL,
	`is_deleted` integer NOT NULL,
	`snippet` text,
	`category` text DEFAULT 'uncategorized' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `thread_message_by_mailbox_and_read_status` ON `thread_message` (`account_config_id`,`mailbox_id`,`is_read`,`sent_date`);--> statement-breakpoint
CREATE INDEX `thread_message_by_starred` ON `thread_message` (`account_config_id`,`has_stars`,`sent_date`);--> statement-breakpoint
CREATE INDEX `thread_message_by_attachment` ON `thread_message` (`account_config_id`,`has_attachment`,`sent_date`);--> statement-breakpoint
CREATE INDEX `thread_message_by_mailbox_id` ON `thread_message` (`account_config_id`,`mailbox_id`,`sent_date`);--> statement-breakpoint
CREATE INDEX `thread_message_by_date` ON `thread_message` (`account_config_id`,`sent_date`);--> statement-breakpoint
CREATE INDEX `thread_message_by_unread` ON `thread_message` (`account_config_id`,`is_read`,`sent_date`);--> statement-breakpoint
CREATE INDEX `thread_message_by_message_id` ON `thread_message` (`message_id`);--> statement-breakpoint
CREATE INDEX `thread_message_by_thread_id` ON `thread_message` (`thread_id`,`sent_date`);--> statement-breakpoint
CREATE INDEX `thread_message_primary` ON `thread_message` (`account_config_id`,`thread_message_id`);