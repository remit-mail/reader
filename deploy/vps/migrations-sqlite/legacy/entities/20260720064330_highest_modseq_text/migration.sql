PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mailbox` (
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
	`sync_status` text,
	`cursor_state` text DEFAULT 'normal' NOT NULL,
	`old_path` text,
	`special_use` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_mailbox`("mailbox_id", "account_id", "namespace_type", "namespace_prefix", "hierarchy_delimiter", "full_path", "uid_validity", "uid_next", "highest_modseq", "message_count", "unseen_count", "deleted_count", "total_size", "last_sync_uid", "high_water_mark_uid", "last_message_sync_at", "initial_sync_completed_at", "parent_mailbox_id", "sync_status", "cursor_state", "old_path", "special_use", "created_at", "updated_at") SELECT "mailbox_id", "account_id", "namespace_type", "namespace_prefix", "hierarchy_delimiter", "full_path", "uid_validity", "uid_next", "highest_modseq", "message_count", "unseen_count", "deleted_count", "total_size", "last_sync_uid", "high_water_mark_uid", "last_message_sync_at", "initial_sync_completed_at", "parent_mailbox_id", "sync_status", "cursor_state", "old_path", "special_use", "created_at", "updated_at" FROM `mailbox`;--> statement-breakpoint
DROP TABLE `mailbox`;--> statement-breakpoint
ALTER TABLE `__new_mailbox` RENAME TO `mailbox`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `mailbox_by_account_id` ON `mailbox` (`account_id`);