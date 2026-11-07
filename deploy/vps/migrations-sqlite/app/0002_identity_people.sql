CREATE TABLE `identity_audit_event` (
	`audit_event_id` text PRIMARY KEY NOT NULL,
	`occurred_at` integer NOT NULL,
	`actor` text NOT NULL,
	`target` text NOT NULL,
	`action` text NOT NULL,
	`outcome` text NOT NULL,
	`client_ip` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `identity_audit_event_occurred_at_idx` ON `identity_audit_event` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `identity_step_up` (
	`digest` text NOT NULL,
	`caller_user_id` text NOT NULL,
	`action` text NOT NULL,
	`target_user_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_step_up_digest_idx` ON `identity_step_up` (`digest`);--> statement-breakpoint
CREATE INDEX `identity_step_up_caller_idx` ON `identity_step_up` (`caller_user_id`);--> statement-breakpoint
ALTER TABLE `auth_user` ADD `disabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `auth_user` ADD `last_sign_in_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `auth_user` SET `last_sign_in_at` = coalesce((SELECT max(`created_at`) FROM `auth_session` WHERE `auth_session`.`user_id` = `auth_user`.`id`), `created_at`);
