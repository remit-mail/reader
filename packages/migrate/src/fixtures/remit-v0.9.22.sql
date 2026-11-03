-- The schema of the single remit.db a v0.9.22 install ran on: the v0.9.22
-- entities, auth and meta migration sets (git show v0.9.22:deploy/vps/migrations-sqlite/),
-- applied in journal order to an empty file and read back from sqlite_master.
CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`event` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`processed_at` integer
);
CREATE INDEX `outbox_message_id_idx` ON `outbox` (`message_id`);
CREATE INDEX `outbox_unprocessed_idx` ON `outbox` (`created_at`) WHERE "outbox"."processed_at" IS NULL;
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
CREATE INDEX `account_config_by_user_id` ON `account_config` (`user_id`,`account_config_id`);
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
CREATE INDEX `account_export_request_by_account_config_id` ON `account_export_request` (`account_config_id`,`created_at`);
CREATE TABLE `account_setting` (
	`account_setting_id` text PRIMARY KEY NOT NULL,
	`account_config_id` text NOT NULL,
	`name` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE INDEX `account_setting_by_account_config_id` ON `account_setting` (`account_config_id`,`name`);
CREATE TABLE `body_part_content` (
	`body_part_content_id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`body_part_id` text NOT NULL,
	`content` text NOT NULL,
	`content_length` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE INDEX `body_part_content_by_message_id` ON `body_part_content` (`message_id`,`body_part_content_id`);
CREATE TABLE `body_part_parameter` (
	`body_part_parameter_id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`body_part_id` text NOT NULL,
	`parameter_name` text NOT NULL,
	`parameter_value` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE INDEX `body_part_parameter_by_message_id` ON `body_part_parameter` (`message_id`,`body_part_parameter_id`);
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
CREATE INDEX `body_part_storage_by_message_id` ON `body_part_storage` (`message_id`,`body_part_storage_id`);
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
CREATE INDEX `body_part_by_message_id` ON `body_part` (`message_id`,`body_part_id`);
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
CREATE INDEX `envelope_address_by_message_id` ON `envelope_address` (`message_id`,`envelope_address_id`);
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
CREATE INDEX `envelope_by_message_id` ON `envelope` (`message_id`,`envelope_id`);
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
CREATE TABLE `label` (
	`label_id` text PRIMARY KEY NOT NULL,
	`account_config_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`color` text DEFAULT 'Default' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE INDEX `label_by_normalized_name` ON `label` (`account_config_id`,`normalized_name`);
CREATE INDEX `label_primary` ON `label` (`account_config_id`,`label_id`);
CREATE TABLE `mailbox_attribute_entry` (
	`mailbox_attribute_id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`attribute_name` text NOT NULL
);
CREATE INDEX `mailbox_attribute_entry_by_mailbox_id` ON `mailbox_attribute_entry` (`mailbox_id`,`mailbox_attribute_id`);
CREATE TABLE `mailbox_flag` (
	`mailbox_flag_id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`flag_name` text NOT NULL,
	`is_permanent` integer NOT NULL
);
CREATE INDEX `mailbox_flag_by_mailbox_id` ON `mailbox_flag` (`mailbox_id`,`mailbox_flag_id`);
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
CREATE INDEX `mailbox_lock_all_locks` ON `mailbox_lock` (`acquired_at`);
CREATE INDEX `mailbox_lock_by_account_id` ON `mailbox_lock` (`account_id`,`mailbox_id`,`event_name`);
CREATE TABLE `mailbox_special_use_entry` (
	`mailbox_special_use_id` text PRIMARY KEY NOT NULL,
	`mailbox_id` text NOT NULL,
	`special_use` text NOT NULL
);
CREATE INDEX `mailbox_special_use_entry_by_mailbox_id` ON `mailbox_special_use_entry` (`mailbox_id`,`mailbox_special_use_id`);
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
CREATE INDEX `message_flag_push_by_mailbox_id` ON `message_flag_push` (`mailbox_id`,`message_id`,`flag_name`);
CREATE INDEX `message_flag_push_by_account_id` ON `message_flag_push` (`account_id`,`message_id`,`flag_name`);
CREATE TABLE `message_flag` (
	`message_flag_id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`flag_name` text NOT NULL,
	`set_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE INDEX `message_flag_by_message_id` ON `message_flag` (`message_id`,`message_flag_id`);
CREATE TABLE `message_label` (
	`message_label_id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`label_id` text NOT NULL,
	`account_config_id` text NOT NULL,
	`applied_by_filter_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE INDEX `message_label_by_label_id` ON `message_label` (`account_config_id`,`label_id`,`created_at`);
CREATE INDEX `message_label_by_message_id` ON `message_label` (`message_id`,`label_id`);
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
CREATE INDEX `message_placement_move_by_account_id` ON `message_placement_move` (`account_id`,`message_id`);
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
CREATE INDEX `message_reference_by_message_id` ON `message_reference` (`message_id`,`message_reference_id`);
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
, `filter_move` text, `placement_decided_at` integer, `spam_report` text, `authenticity_verdict` text DEFAULT 'NotEvaluated' NOT NULL, `classification_state` text DEFAULT 'NotExamined' NOT NULL, `abandoned_mutation` text DEFAULT 'none' NOT NULL);
CREATE INDEX `message_by_mailbox_id` ON `message` (`mailbox_id`,`uid`);
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
CREATE INDEX `raw_message_storage_by_message_id` ON `raw_message_storage` (`message_id`,`raw_storage_id`);
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
, `list_id` text);
CREATE INDEX `thread_message_by_mailbox_and_read_status` ON `thread_message` (`account_config_id`,`mailbox_id`,`is_read`,`sent_date`);
CREATE INDEX `thread_message_by_starred` ON `thread_message` (`account_config_id`,`has_stars`,`sent_date`);
CREATE INDEX `thread_message_by_attachment` ON `thread_message` (`account_config_id`,`has_attachment`,`sent_date`);
CREATE INDEX `thread_message_by_mailbox_id` ON `thread_message` (`account_config_id`,`mailbox_id`,`sent_date`);
CREATE INDEX `thread_message_by_date` ON `thread_message` (`account_config_id`,`sent_date`);
CREATE INDEX `thread_message_by_unread` ON `thread_message` (`account_config_id`,`is_read`,`sent_date`);
CREATE INDEX `thread_message_by_message_id` ON `thread_message` (`message_id`);
CREATE INDEX `thread_message_by_thread_id` ON `thread_message` (`thread_id`,`sent_date`);
CREATE INDEX `thread_message_primary` ON `thread_message` (`account_config_id`,`thread_message_id`);
CREATE TABLE "outbox_message" (
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
, `appended_uid` integer DEFAULT 0 NOT NULL);
CREATE INDEX `outbox_message_by_account_id` ON `outbox_message` (`account_id`,`created_at`);
CREATE TABLE "quarantine" (
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
CREATE INDEX `quarantine_by_account_config_id` ON `quarantine` (`account_config_id`,`quarantined_at`);
CREATE TABLE "account" (
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
, `synced_services` text DEFAULT '["Mail"]' NOT NULL, `granted_scopes` text DEFAULT '[]' NOT NULL);
CREATE INDEX `account_by_account_config_id` ON `account` (`account_config_id`,`account_id`);
CREATE TABLE "address" (
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
CREATE INDEX `address_by_account_config_id` ON `address` (`account_config_id`,`normalized_compound`);
CREATE TABLE "organize_job_request" (
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
, `filter_id` text DEFAULT 'None' NOT NULL);
CREATE INDEX `organize_job_request_by_account_config_id` ON `organize_job_request` (`account_config_id`,`created_at`);
CREATE INDEX `tm_by_mailbox_category_date` ON `thread_message` (`account_config_id`,`mailbox_id`,`category`,`is_deleted`,`sent_date`);
CREATE TABLE "filter" (
	`filter_id` text PRIMARY KEY NOT NULL,
	`account_config_id` text NOT NULL,
	`name` text NOT NULL,
	`scope` text NOT NULL,
	`expires_at` text,
	`ttl` integer,
	`state` text DEFAULT 'Active' NOT NULL,
	`has_anchor` integer DEFAULT false NOT NULL,
	`rule_changed_at` integer NOT NULL,
	`action_changed_at` integer NOT NULL,
	`match_operator` text DEFAULT 'And' NOT NULL,
	`literal_clauses` text DEFAULT '[]' NOT NULL,
	`action_label_id` text DEFAULT 'None' NOT NULL,
	`action_mailbox_id` text DEFAULT 'None' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
, `disabled_reason` text DEFAULT 'None' NOT NULL);
CREATE INDEX `filter_by_account_and_state` ON `filter` (`account_config_id`,`state`,`filter_id`);
CREATE INDEX `filter_primary` ON `filter` (`account_config_id`,`filter_id`);
CREATE TABLE `outbox_attachment` (
	`outbox_attachment_id` text PRIMARY KEY NOT NULL,
	`outbox_message_id` text NOT NULL,
	`account_id` text NOT NULL,
	`account_config_id` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`state` text NOT NULL,
	`storage_key` text NOT NULL,
	`reservation_expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE INDEX `outbox_attachment_by_outbox_message_id` ON `outbox_attachment` (`outbox_message_id`,`created_at`);
CREATE TABLE `sender_signer_standing` (
	`account_config_id` text NOT NULL,
	`sender_key` text NOT NULL,
	`signer_domain` text NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`user_affirmed_at` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`account_config_id`, `sender_key`, `signer_domain`)
);
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
CREATE INDEX `config_import_by_account_config_id` ON `config_import` (`account_config_id`,`created_at`);
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
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
, `subscription_url` text DEFAULT '' NOT NULL, `subscription_enabled` integer DEFAULT false NOT NULL, `subscription_checked_at` integer DEFAULT 0 NOT NULL, `subscription_fetched_at` integer DEFAULT 0 NOT NULL, `subscription_error` text DEFAULT '' NOT NULL);
CREATE INDEX `calendar_by_url_segment` ON `calendar` (`account_config_id`,`url_segment`);
CREATE INDEX `calendar_primary` ON `calendar` (`account_config_id`,`calendar_id`);
CREATE TABLE `calendar_event_index` (
	`calendar_id` text NOT NULL,
	`calendar_object_id` text NOT NULL,
	`recurrence_id` text NOT NULL,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`all_day` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL, `summary` text DEFAULT '' NOT NULL, `status` text DEFAULT 'Confirmed' NOT NULL, `transparency` text DEFAULT 'Opaque' NOT NULL,
	PRIMARY KEY(`calendar_id`, `calendar_object_id`, `recurrence_id`)
);
CREATE INDEX `calendar_event_index_by_start` ON `calendar_event_index` (`calendar_id`,`start_at`);
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
CREATE INDEX `calendar_object_by_sync_sequence` ON `calendar_object` (`calendar_id`,`sync_sequence`);
CREATE INDEX `calendar_object_by_uid` ON `calendar_object` (`calendar_id`,`ical_uid`);
CREATE INDEX `calendar_object_primary` ON `calendar_object` (`calendar_id`,`calendar_object_id`);
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
	`updated_at` integer NOT NULL, `superseded_by_message_id` text DEFAULT '' NOT NULL, `ends_at_utc` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`account_config_id`, `suggestion_id`)
);
CREATE INDEX `calendar_suggestion_by_state` ON `calendar_suggestion` (`account_config_id`,`state`,`created_at`,`suggestion_id`);
CREATE INDEX `calendar_suggestion_by_message` ON `calendar_suggestion` (`account_config_id`,`message_id`,`suggestion_id`);
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
CREATE INDEX `calendar_feed_token_by_token_hash` ON `calendar_feed_token` (`token_hash`);
CREATE TABLE "mailbox" (
	`mailbox_id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`namespace_type` text DEFAULT 'personal' NOT NULL,
	`namespace_prefix` text NOT NULL,
	`hierarchy_delimiter` text NOT NULL,
	`full_path` text NOT NULL,
	`uid_validity` integer NOT NULL,
	`uid_next` integer NOT NULL,
	`highest_modseq` text NOT NULL,
	`message_count` integer NOT NULL,
	`unseen_count` integer NOT NULL,
	`deleted_count` integer NOT NULL,
	`total_size` integer NOT NULL,
	`last_sync_uid` integer NOT NULL,
	`high_water_mark_uid` integer NOT NULL,
	`last_message_sync_at` integer NOT NULL,
	`initial_sync_completed_at` integer,
	`parent_mailbox_id` text DEFAULT 'None' NOT NULL,
	`sync_status` text DEFAULT 'synced' NOT NULL,
	`cursor_state` text DEFAULT 'normal' NOT NULL,
	`special_use` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
, `pending_path` text, `sync_failure_reason` text DEFAULT '' NOT NULL);
CREATE INDEX `mailbox_by_account_id` ON `mailbox` (`account_id`);
CREATE UNIQUE INDEX `mailbox_by_account_full_path` ON `mailbox` (`account_id`,`full_path`);
CREATE INDEX `calendar_suggestion_by_accepted_calendar_object` ON `calendar_suggestion` (`account_config_id`,`accepted_calendar_object_id`);
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
CREATE INDEX `auth_account_userId_idx` ON `auth_account` (`user_id`);
CREATE TABLE `auth_jwks` (
	`id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer
);
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
CREATE UNIQUE INDEX `auth_session_token_unique` ON `auth_session` (`token`);
CREATE INDEX `auth_session_userId_idx` ON `auth_session` (`user_id`);
CREATE TABLE `auth_user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE UNIQUE INDEX `auth_user_email_unique` ON `auth_user` (`email`);
CREATE TABLE `auth_verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
CREATE INDEX `auth_verification_identifier_idx` ON `auth_verification` (`identifier`);
CREATE TABLE `instance_owner` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`user_id` text NOT NULL,
	`claimed_at` integer NOT NULL,
	CONSTRAINT "instance_owner_singleton" CHECK("instance_owner"."id" = 1)
);
