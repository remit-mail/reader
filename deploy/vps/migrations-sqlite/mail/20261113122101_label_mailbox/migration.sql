CREATE TABLE `label_mailbox` (
	`label_mailbox_id` text PRIMARY KEY,
	`label_id` text NOT NULL,
	`account_id` text NOT NULL,
	`mailbox_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `label_mailbox_by_label_id` ON `label_mailbox` (`label_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `label_mailbox_by_account_id` ON `label_mailbox` (`account_id`,`label_id`);