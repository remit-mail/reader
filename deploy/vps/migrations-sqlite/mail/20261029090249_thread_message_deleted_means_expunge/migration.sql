UPDATE `thread_message` SET `is_deleted` = 0
WHERE `is_deleted` = 1
	AND NOT EXISTS (
		SELECT 1 FROM `message`
		WHERE `message`.`message_id` = `thread_message`.`message_id`
			AND `message`.`status` IN ('deleting', 'deleted')
	);
