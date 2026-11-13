ALTER TABLE `message` ADD `spam_cleared` integer DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE `message` SET `authenticity` = json_remove(`authenticity`, '$.displayNameCorrespondence', '$.offDomainLinkDomains') WHERE `authenticity` IS NOT NULL;
