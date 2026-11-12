PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mcp_device_code` (
	`id` text PRIMARY KEY NOT NULL,
	`device_code` text NOT NULL,
	`user_code` text NOT NULL,
	`user_id` text,
	`expires_at` integer NOT NULL,
	`status` text NOT NULL,
	`last_polled_at` integer,
	`polling_interval` integer,
	`client_id` text,
	`scope` text,
	`resources` text,
	`oauth_client_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_mcp_device_code`("id", "device_code", "user_code", "user_id", "expires_at", "status", "last_polled_at", "polling_interval", "client_id", "scope", "resources", "oauth_client_id") SELECT "id", "device_code", "user_code", "user_id", "expires_at", "status", "last_polled_at", "polling_interval", "client_id", "scope", "resources", "oauth_client_id" FROM `mcp_device_code`;--> statement-breakpoint
DROP TABLE `mcp_device_code`;--> statement-breakpoint
ALTER TABLE `__new_mcp_device_code` RENAME TO `mcp_device_code`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_device_code_deviceCode_uidx` ON `mcp_device_code` (`device_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_device_code_userCode_uidx` ON `mcp_device_code` (`user_code`);