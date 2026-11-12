CREATE TABLE `mcp_device_code` (
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
	`oauth_client_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_device_code_deviceCode_uidx` ON `mcp_device_code` (`device_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_device_code_userCode_uidx` ON `mcp_device_code` (`user_code`);