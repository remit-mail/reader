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
CREATE INDEX `config_import_by_account_config_id` ON `config_import` (`account_config_id`,`created_at`);