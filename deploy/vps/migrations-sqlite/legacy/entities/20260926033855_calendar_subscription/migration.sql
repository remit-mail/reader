ALTER TABLE `calendar` ADD `subscription_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `calendar` ADD `subscription_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `calendar` ADD `subscription_checked_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `calendar` ADD `subscription_fetched_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `calendar` ADD `subscription_error` text DEFAULT '' NOT NULL;