-- Custom SQL migration file, put your code below! --
CREATE TEMP TABLE `mailbox_path_duplicate` AS
WITH `ranked` AS (
	SELECT
		`mailbox`.`mailbox_id`,
		`mailbox`.`account_id`,
		`mailbox`.`full_path`,
		`mailbox`.`uid_validity`,
		ROW_NUMBER() OVER (
			PARTITION BY `mailbox`.`account_id`, `mailbox`.`full_path`
			ORDER BY
				(SELECT COUNT(*) FROM `message` WHERE `message`.`mailbox_id` = `mailbox`.`mailbox_id`) DESC,
				`mailbox`.`created_at` ASC,
				`mailbox`.`mailbox_id` ASC
		) AS `rank`
	FROM `mailbox`
)
SELECT
	`loser`.`mailbox_id` AS `loser_id`,
	`survivor`.`mailbox_id` AS `survivor_id`,
	`loser`.`uid_validity` = `survivor`.`uid_validity` AS `same_uid_validity`
FROM `ranked` AS `loser`
JOIN `ranked` AS `survivor`
	ON `survivor`.`account_id` = `loser`.`account_id`
	AND `survivor`.`full_path` = `loser`.`full_path`
	AND `survivor`.`rank` = 1
WHERE `loser`.`rank` > 1;
--> statement-breakpoint
CREATE TEMP TABLE `mailbox_path_duplicate_move` AS
SELECT `message`.`message_id`, `duplicate`.`survivor_id`
FROM `message`
JOIN `mailbox_path_duplicate` AS `duplicate` ON `duplicate`.`loser_id` = `message`.`mailbox_id`
WHERE `duplicate`.`same_uid_validity`
	AND NOT EXISTS (
		SELECT 1 FROM `message` AS `held`
		WHERE `held`.`mailbox_id` = `duplicate`.`survivor_id` AND `held`.`uid` = `message`.`uid`
	)
	AND `message`.`message_id` = (
		SELECT MIN(`rival`.`message_id`)
		FROM `message` AS `rival`
		JOIN `mailbox_path_duplicate` AS `rival_duplicate` ON `rival_duplicate`.`loser_id` = `rival`.`mailbox_id`
		WHERE `rival_duplicate`.`survivor_id` = `duplicate`.`survivor_id`
			AND `rival_duplicate`.`same_uid_validity`
			AND `rival`.`uid` = `message`.`uid`
	);
--> statement-breakpoint
UPDATE `message` SET `mailbox_id` = (
	SELECT `survivor_id` FROM `mailbox_path_duplicate_move` AS `move` WHERE `move`.`message_id` = `message`.`message_id`
) WHERE `message_id` IN (SELECT `message_id` FROM `mailbox_path_duplicate_move`);
--> statement-breakpoint
UPDATE `thread_message` SET `mailbox_id` = (
	SELECT `survivor_id` FROM `mailbox_path_duplicate_move` AS `move` WHERE `move`.`message_id` = `thread_message`.`message_id`
) WHERE `message_id` IN (SELECT `message_id` FROM `mailbox_path_duplicate_move`)
	AND `mailbox_id` IN (SELECT `loser_id` FROM `mailbox_path_duplicate`);
--> statement-breakpoint
UPDATE `message_flag_push` SET `mailbox_id` = (
	SELECT `survivor_id` FROM `mailbox_path_duplicate_move` AS `move` WHERE `move`.`message_id` = `message_flag_push`.`message_id`
) WHERE `message_id` IN (SELECT `message_id` FROM `mailbox_path_duplicate_move`)
	AND `mailbox_id` IN (SELECT `loser_id` FROM `mailbox_path_duplicate`);
--> statement-breakpoint
UPDATE `message_placement_move` SET `source_mailbox_id` = (
	SELECT `survivor_id` FROM `mailbox_path_duplicate_move` AS `move` WHERE `move`.`message_id` = `message_placement_move`.`message_id`
) WHERE `message_id` IN (SELECT `message_id` FROM `mailbox_path_duplicate_move`)
	AND `source_mailbox_id` IN (SELECT `loser_id` FROM `mailbox_path_duplicate`);
--> statement-breakpoint
UPDATE `mailbox` SET `last_sync_uid` = 0, `high_water_mark_uid` = 0, `highest_modseq` = '0'
WHERE `mailbox_id` IN (
	SELECT `duplicate`.`survivor_id`
	FROM `mailbox_path_duplicate` AS `duplicate`
	JOIN `message` ON `message`.`mailbox_id` = `duplicate`.`loser_id`
);
--> statement-breakpoint
UPDATE `thread_message` SET `mailbox_id` = 'DuplicateMailboxRemoved'
WHERE `mailbox_id` IN (SELECT `loser_id` FROM `mailbox_path_duplicate`);
--> statement-breakpoint
UPDATE `message` SET `mailbox_id` = 'DuplicateMailboxRemoved'
WHERE `mailbox_id` IN (SELECT `loser_id` FROM `mailbox_path_duplicate`);
--> statement-breakpoint
UPDATE `filter` SET `action_mailbox_id` = (
	SELECT `survivor_id` FROM `mailbox_path_duplicate` WHERE `loser_id` = `filter`.`action_mailbox_id`
) WHERE `action_mailbox_id` IN (SELECT `loser_id` FROM `mailbox_path_duplicate`);
--> statement-breakpoint
UPDATE `organize_job_request` SET `action_mailbox_id` = (
	SELECT `survivor_id` FROM `mailbox_path_duplicate` WHERE `loser_id` = `organize_job_request`.`action_mailbox_id`
) WHERE `action_mailbox_id` IN (SELECT `loser_id` FROM `mailbox_path_duplicate`);
--> statement-breakpoint
UPDATE `account_setting` SET `value` = json_set(`value`, '$.value', (
	SELECT `survivor_id` FROM `mailbox_path_duplicate` WHERE `loser_id` = json_extract(`account_setting`.`value`, '$.value')
)) WHERE json_valid(`value`)
	AND json_extract(`value`, '$.kind') = 'String'
	AND json_extract(`value`, '$.value') IN (SELECT `loser_id` FROM `mailbox_path_duplicate`);
--> statement-breakpoint
CREATE TEMP TABLE `mailbox_path_duplicate_setting` AS
SELECT
	`account_setting`.`account_setting_id`,
	`kind`.`prefix` || `duplicate`.`survivor_id` AS `survivor_name`
FROM `account_setting`
JOIN (SELECT 'MailboxDisplayName#' AS `prefix` UNION ALL SELECT 'MailboxMuted#') AS `kind`
JOIN `mailbox_path_duplicate` AS `duplicate`
	ON `account_setting`.`name` = `kind`.`prefix` || `duplicate`.`loser_id`
WHERE NOT EXISTS (
		SELECT 1 FROM `account_setting` AS `held`
		WHERE `held`.`account_config_id` = `account_setting`.`account_config_id`
			AND `held`.`name` = `kind`.`prefix` || `duplicate`.`survivor_id`
	)
	AND `duplicate`.`loser_id` = (
		SELECT MIN(`rival`.`loser_id`)
		FROM `mailbox_path_duplicate` AS `rival`
		JOIN `account_setting` AS `rival_setting`
			ON `rival_setting`.`name` = `kind`.`prefix` || `rival`.`loser_id`
			AND `rival_setting`.`account_config_id` = `account_setting`.`account_config_id`
		WHERE `rival`.`survivor_id` = `duplicate`.`survivor_id`
	);
--> statement-breakpoint
UPDATE `account_setting` SET `name` = (
	SELECT `survivor_name` FROM `mailbox_path_duplicate_setting` AS `rekey`
	WHERE `rekey`.`account_setting_id` = `account_setting`.`account_setting_id`
) WHERE `account_setting_id` IN (SELECT `account_setting_id` FROM `mailbox_path_duplicate_setting`);
--> statement-breakpoint
DELETE FROM `account_setting` WHERE `name` IN (
	SELECT 'MailboxDisplayName#' || `loser_id` FROM `mailbox_path_duplicate`
	UNION ALL
	SELECT 'MailboxMuted#' || `loser_id` FROM `mailbox_path_duplicate`
);
--> statement-breakpoint
UPDATE `mailbox` SET `parent_mailbox_id` = (
	SELECT `survivor_id` FROM `mailbox_path_duplicate` WHERE `loser_id` = `mailbox`.`parent_mailbox_id`
) WHERE `parent_mailbox_id` IN (SELECT `loser_id` FROM `mailbox_path_duplicate`);
--> statement-breakpoint
UPDATE `message` SET `original_mailbox_id` = (
	SELECT `survivor_id` FROM `mailbox_path_duplicate` WHERE `loser_id` = `message`.`original_mailbox_id`
) WHERE `original_mailbox_id` IN (SELECT `loser_id` FROM `mailbox_path_duplicate`);
--> statement-breakpoint
UPDATE `message_placement_move` SET `destination_mailbox_id` = (
	SELECT `survivor_id` FROM `mailbox_path_duplicate` WHERE `loser_id` = `message_placement_move`.`destination_mailbox_id`
) WHERE `destination_mailbox_id` IN (SELECT `loser_id` FROM `mailbox_path_duplicate`);
--> statement-breakpoint
UPDATE `quarantine` SET `mailbox_id` = (
	SELECT `survivor_id` FROM `mailbox_path_duplicate` WHERE `loser_id` = `quarantine`.`mailbox_id`
) WHERE `mailbox_id` IN (SELECT `loser_id` FROM `mailbox_path_duplicate`)
	AND NOT EXISTS (
		SELECT 1 FROM `quarantine` AS `held`
		JOIN `mailbox_path_duplicate` AS `duplicate` ON `duplicate`.`survivor_id` = `held`.`mailbox_id`
		WHERE `duplicate`.`loser_id` = `quarantine`.`mailbox_id`
			AND `held`.`uid_validity` = `quarantine`.`uid_validity`
			AND `held`.`uid` = `quarantine`.`uid`
	);
--> statement-breakpoint
DELETE FROM `quarantine` WHERE `mailbox_id` IN (SELECT `loser_id` FROM `mailbox_path_duplicate`);
--> statement-breakpoint
DELETE FROM `message_placement_move` WHERE `source_mailbox_id` IN (SELECT `loser_id` FROM `mailbox_path_duplicate`);
--> statement-breakpoint
DELETE FROM `message_flag_push` WHERE `mailbox_id` IN (SELECT `loser_id` FROM `mailbox_path_duplicate`);
--> statement-breakpoint
DELETE FROM `mailbox_lock` WHERE `mailbox_id` IN (SELECT `loser_id` FROM `mailbox_path_duplicate`);
--> statement-breakpoint
DELETE FROM `mailbox_flag` WHERE `mailbox_id` IN (SELECT `loser_id` FROM `mailbox_path_duplicate`);
--> statement-breakpoint
DELETE FROM `mailbox_attribute_entry` WHERE `mailbox_id` IN (SELECT `loser_id` FROM `mailbox_path_duplicate`);
--> statement-breakpoint
DELETE FROM `mailbox_special_use_entry` WHERE `mailbox_id` IN (SELECT `loser_id` FROM `mailbox_path_duplicate`);
--> statement-breakpoint
DELETE FROM `mailbox` WHERE `mailbox_id` IN (SELECT `loser_id` FROM `mailbox_path_duplicate`);
--> statement-breakpoint
DROP TABLE `mailbox_path_duplicate_setting`;
--> statement-breakpoint
DROP TABLE `mailbox_path_duplicate_move`;
--> statement-breakpoint
DROP TABLE `mailbox_path_duplicate`;
