-- Custom data migration (issue #64). No schema change.
--
-- Until the generated-enum fix, `MessageSystemFlag.Seen` held the string
-- `Seen` rather than `\Seen`: the emitter wrote the TypeSpec value into
-- JavaScript source unescaped, so `\S` collapsed to `S`. Every
-- `message_flag.flag_name` written by `FlagQueueService` therefore landed
-- under the unprefixed spelling.
--
-- `hasFlag` is an exact string match, so once the code queries `\Seen` a
-- pre-existing `Seen` row is invisible: unstarring a starred message reads
-- "not starred" and re-stars it, and marking a read message unread does
-- nothing at all. Rename the rows to the RFC 9051 spelling the corrected
-- code queries.
--
-- Idempotent: after the first run no unprefixed rows remain, so the UPDATE
-- matches nothing on any later run. Restricted to the five RFC 9051 system
-- flag names — keyword flags (`$Forwarded`) and custom keywords were never
-- affected and must not be touched.
--
-- `message_flag_push` is deliberately left alone. Its markers are read back
-- by the stored `flag_name` (`drainPendingFlagPushes` re-arms from
-- `marker.flagName`, and `handleFlagPush` threads that same value through
-- `find`/`updateState`/`delete`), so a marker keyed on the old spelling
-- still matches itself and drains. Renaming them would orphan any marker
-- already in `queued` or `processing`, whose in-flight event carries the old
-- name and which the periodic drain only re-arms from `pending`.

DELETE FROM `message_flag`
WHERE `flag_name` IN ('Seen', 'Answered', 'Flagged', 'Deleted', 'Draft')
  AND EXISTS (
    SELECT 1 FROM `message_flag` AS `prefixed`
    WHERE `prefixed`.`message_id` = `message_flag`.`message_id`
      AND `prefixed`.`flag_name` = '\' || `message_flag`.`flag_name`
  );
--> statement-breakpoint
UPDATE `message_flag`
SET `flag_name` = '\' || `flag_name`,
    `updated_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE `flag_name` IN ('Seen', 'Answered', 'Flagged', 'Deleted', 'Draft');
