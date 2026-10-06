ALTER TABLE `calendar_suggestion` ADD `ends_at_utc` text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE `calendar_suggestion` SET `ends_at_utc` = CASE WHEN `ical_data` LIKE '%RRULE%' OR `ical_data` LIKE '%RDATE%' THEN '9999-12-31T23:59:59Z' ELSE strftime('%Y-%m-%dT%H:%M:%SZ', `dt_end`) END;
