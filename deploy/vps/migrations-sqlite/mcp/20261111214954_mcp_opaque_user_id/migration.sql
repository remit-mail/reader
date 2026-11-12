-- Hand-ordered from drizzle-kit's output: the migrator runs inside a transaction, where PRAGMA foreign_keys is a no-op, so dropping a parent table would cascade-delete its children. Every new child references the new parent, and old tables are dropped children first.
CREATE TABLE `__new_mcp_session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `__new_mcp_oauth_client` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`client_secret` text,
	`client_discovery_id` text,
	`disabled` integer DEFAULT false,
	`skip_consent` integer,
	`enable_end_session` integer,
	`subject_type` text,
	`scopes` text,
	`client_credentials_scopes` text DEFAULT '[]',
	`user_id` text,
	`created_at` integer,
	`updated_at` integer,
	`name` text,
	`uri` text,
	`icon` text,
	`contacts` text,
	`tos` text,
	`policy` text,
	`software_id` text,
	`software_version` text,
	`software_statement` text,
	`redirect_uris` text NOT NULL,
	`post_logout_redirect_uris` text,
	`backchannel_logout_uri` text,
	`backchannel_logout_session_required` integer,
	`token_endpoint_auth_method` text,
	`application_type` text,
	`jwks` text,
	`jwks_uri` text,
	`grant_types` text,
	`response_types` text,
	`require_pkce` integer,
	`dpop_bound_access_tokens` integer DEFAULT false,
	`reference_id` text,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `__new_mcp_oauth_client_client_id_unique` ON `__new_mcp_oauth_client` (`client_id`);--> statement-breakpoint
CREATE TABLE `__new_mcp_oauth_client_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`metadata` text,
	`created_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `__new_mcp_oauth_client`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_id`) REFERENCES `mcp_oauth_resource`(`identifier`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `__new_mcp_oauth_refresh_token` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`client_id` text NOT NULL,
	`session_id` text,
	`user_id` text NOT NULL,
	`reference_id` text,
	`authorization_code_id` text,
	`resources` text,
	`requested_user_info_claims` text,
	`expires_at` integer,
	`created_at` integer,
	`revoked` integer,
	`rotated_at` integer,
	`rotation_replay_response` text,
	`rotation_replay_expires_at` integer,
	`auth_time` integer,
	`confirmation` text,
	`scopes` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `__new_mcp_oauth_client`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `__new_mcp_session`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `__new_mcp_oauth_access_token` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text,
	`client_id` text NOT NULL,
	`session_id` text,
	`user_id` text,
	`reference_id` text,
	`authorization_code_id` text,
	`resources` text,
	`requested_user_info_claims` text,
	`refresh_id` text,
	`expires_at` integer,
	`created_at` integer,
	`revoked` integer,
	`confirmation` text,
	`scopes` text NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `__new_mcp_oauth_client`(`client_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `__new_mcp_session`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`refresh_id`) REFERENCES `__new_mcp_oauth_refresh_token`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `__new_mcp_oauth_consent` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text,
	`reference_id` text,
	`resources` text,
	`requested_user_info_claims` text,
	`scopes` text NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `__new_mcp_oauth_client`(`client_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
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
	`oauth_client_id` text
);
--> statement-breakpoint
INSERT INTO `__new_mcp_session`("id", "expires_at", "token", "created_at", "updated_at", "ip_address", "user_agent", "user_id") SELECT "id", "expires_at", "token", "created_at", "updated_at", "ip_address", "user_agent", "user_id" FROM `mcp_session`;--> statement-breakpoint
INSERT INTO `__new_mcp_oauth_client`("id", "client_id", "client_secret", "client_discovery_id", "disabled", "skip_consent", "enable_end_session", "subject_type", "scopes", "client_credentials_scopes", "user_id", "created_at", "updated_at", "name", "uri", "icon", "contacts", "tos", "policy", "software_id", "software_version", "software_statement", "redirect_uris", "post_logout_redirect_uris", "backchannel_logout_uri", "backchannel_logout_session_required", "token_endpoint_auth_method", "application_type", "jwks", "jwks_uri", "grant_types", "response_types", "require_pkce", "dpop_bound_access_tokens", "reference_id", "metadata") SELECT "id", "client_id", "client_secret", "client_discovery_id", "disabled", "skip_consent", "enable_end_session", "subject_type", "scopes", "client_credentials_scopes", "user_id", "created_at", "updated_at", "name", "uri", "icon", "contacts", "tos", "policy", "software_id", "software_version", "software_statement", "redirect_uris", "post_logout_redirect_uris", "backchannel_logout_uri", "backchannel_logout_session_required", "token_endpoint_auth_method", "application_type", "jwks", "jwks_uri", "grant_types", "response_types", "require_pkce", "dpop_bound_access_tokens", "reference_id", "metadata" FROM `mcp_oauth_client`;--> statement-breakpoint
INSERT INTO `__new_mcp_oauth_client_resource`("id", "client_id", "resource_id", "metadata", "created_at") SELECT "id", "client_id", "resource_id", "metadata", "created_at" FROM `mcp_oauth_client_resource`;--> statement-breakpoint
INSERT INTO `__new_mcp_oauth_refresh_token`("id", "token", "client_id", "session_id", "user_id", "reference_id", "authorization_code_id", "resources", "requested_user_info_claims", "expires_at", "created_at", "revoked", "rotated_at", "rotation_replay_response", "rotation_replay_expires_at", "auth_time", "confirmation", "scopes") SELECT "id", "token", "client_id", "session_id", "user_id", "reference_id", "authorization_code_id", "resources", "requested_user_info_claims", "expires_at", "created_at", "revoked", "rotated_at", "rotation_replay_response", "rotation_replay_expires_at", "auth_time", "confirmation", "scopes" FROM `mcp_oauth_refresh_token`;--> statement-breakpoint
INSERT INTO `__new_mcp_oauth_access_token`("id", "token", "client_id", "session_id", "user_id", "reference_id", "authorization_code_id", "resources", "requested_user_info_claims", "refresh_id", "expires_at", "created_at", "revoked", "confirmation", "scopes") SELECT "id", "token", "client_id", "session_id", "user_id", "reference_id", "authorization_code_id", "resources", "requested_user_info_claims", "refresh_id", "expires_at", "created_at", "revoked", "confirmation", "scopes" FROM `mcp_oauth_access_token`;--> statement-breakpoint
INSERT INTO `__new_mcp_oauth_consent`("id", "client_id", "user_id", "reference_id", "resources", "requested_user_info_claims", "scopes", "created_at", "updated_at") SELECT "id", "client_id", "user_id", "reference_id", "resources", "requested_user_info_claims", "scopes", "created_at", "updated_at" FROM `mcp_oauth_consent`;--> statement-breakpoint
INSERT INTO `__new_mcp_device_code`("id", "device_code", "user_code", "user_id", "expires_at", "status", "last_polled_at", "polling_interval", "client_id", "scope", "resources", "oauth_client_id") SELECT "id", "device_code", "user_code", "user_id", "expires_at", "status", "last_polled_at", "polling_interval", "client_id", "scope", "resources", "oauth_client_id" FROM `mcp_device_code`;--> statement-breakpoint
DROP TABLE `mcp_oauth_access_token`;--> statement-breakpoint
DROP TABLE `mcp_oauth_consent`;--> statement-breakpoint
DROP TABLE `mcp_oauth_client_resource`;--> statement-breakpoint
DROP TABLE `mcp_oauth_refresh_token`;--> statement-breakpoint
DROP TABLE `mcp_session`;--> statement-breakpoint
DROP TABLE `mcp_oauth_client`;--> statement-breakpoint
DROP TABLE `mcp_device_code`;--> statement-breakpoint
ALTER TABLE `__new_mcp_session` RENAME TO `mcp_session`;--> statement-breakpoint
ALTER TABLE `__new_mcp_oauth_client` RENAME TO `mcp_oauth_client`;--> statement-breakpoint
ALTER TABLE `__new_mcp_oauth_client_resource` RENAME TO `mcp_oauth_client_resource`;--> statement-breakpoint
ALTER TABLE `__new_mcp_oauth_refresh_token` RENAME TO `mcp_oauth_refresh_token`;--> statement-breakpoint
ALTER TABLE `__new_mcp_oauth_access_token` RENAME TO `mcp_oauth_access_token`;--> statement-breakpoint
ALTER TABLE `__new_mcp_oauth_consent` RENAME TO `mcp_oauth_consent`;--> statement-breakpoint
ALTER TABLE `__new_mcp_device_code` RENAME TO `mcp_device_code`;--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_session_token_unique` ON `mcp_session` (`token`);--> statement-breakpoint
CREATE INDEX `mcp_session_userId_idx` ON `mcp_session` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_oauth_client_client_id_unique` ON `mcp_oauth_client` (`client_id`);--> statement-breakpoint
DROP INDEX `__new_mcp_oauth_client_client_id_unique`;--> statement-breakpoint
CREATE INDEX `mcp_oauth_client_userId_idx` ON `mcp_oauth_client` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_oauth_client_resource_clientId_resourceId_uidx` ON `mcp_oauth_client_resource` (`client_id`,`resource_id`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_client_resource_clientId_idx` ON `mcp_oauth_client_resource` (`client_id`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_client_resource_resourceId_idx` ON `mcp_oauth_client_resource` (`resource_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_oauth_refresh_token_token_unique` ON `mcp_oauth_refresh_token` (`token`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_refresh_token_clientId_idx` ON `mcp_oauth_refresh_token` (`client_id`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_refresh_token_sessionId_idx` ON `mcp_oauth_refresh_token` (`session_id`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_refresh_token_userId_idx` ON `mcp_oauth_refresh_token` (`user_id`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_refresh_token_authorizationCodeId_idx` ON `mcp_oauth_refresh_token` (`authorization_code_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_oauth_access_token_token_unique` ON `mcp_oauth_access_token` (`token`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_access_token_clientId_idx` ON `mcp_oauth_access_token` (`client_id`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_access_token_sessionId_idx` ON `mcp_oauth_access_token` (`session_id`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_access_token_userId_idx` ON `mcp_oauth_access_token` (`user_id`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_access_token_authorizationCodeId_idx` ON `mcp_oauth_access_token` (`authorization_code_id`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_access_token_refreshId_idx` ON `mcp_oauth_access_token` (`refresh_id`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_consent_clientId_idx` ON `mcp_oauth_consent` (`client_id`);--> statement-breakpoint
CREATE INDEX `mcp_oauth_consent_userId_idx` ON `mcp_oauth_consent` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_device_code_deviceCode_uidx` ON `mcp_device_code` (`device_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_device_code_userCode_uidx` ON `mcp_device_code` (`user_code`);
