ALTER TABLE `account` ADD `granted_scopes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE `account` SET `granted_scopes` = '["https://outlook.office.com/IMAP.AccessAsUser.All","https://outlook.office.com/SMTP.Send"]' WHERE `auth_type` = 'oauthMicrosoft';
