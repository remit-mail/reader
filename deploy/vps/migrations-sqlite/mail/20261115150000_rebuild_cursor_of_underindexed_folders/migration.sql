UPDATE `mailbox` SET `cursor_state` = 'cursor_invalid'
WHERE `cursor_state` = 'normal'
	AND `sync_status` = 'synced'
	AND `message_count` > (
		SELECT count(*) FROM `message`
		WHERE `message`.`mailbox_id` = `mailbox`.`mailbox_id`
	)
	AND NOT EXISTS (
		SELECT 1 FROM `mailbox` AS `view`
		WHERE `view`.`account_id` = `mailbox`.`account_id`
			AND (
				lower(`view`.`full_path`) IN ('[gmail]/all mail', '[gmail]/starred', '[gmail]/important')
				OR EXISTS (
					SELECT 1 FROM json_each(CASE WHEN json_valid(`view`.`special_use`) THEN `view`.`special_use` ELSE '[]' END)
					WHERE `value` IN ('All', 'Flagged', 'Important')
				)
			)
	);
