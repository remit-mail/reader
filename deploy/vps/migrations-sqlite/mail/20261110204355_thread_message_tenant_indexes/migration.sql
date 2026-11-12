DROP INDEX `thread_message_by_message_id`;--> statement-breakpoint
DROP INDEX `thread_message_by_thread_id`;--> statement-breakpoint
CREATE INDEX `thread_message_by_message_id` ON `thread_message` (`message_id`,`account_config_id`);--> statement-breakpoint
CREATE INDEX `thread_message_by_thread_id` ON `thread_message` (`account_config_id`,`thread_id`,`sent_date`,`thread_message_id`);