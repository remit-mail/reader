-- Custom SQL migration file, put your code below! --

-- `message.created` was appended once per message and drained by nothing, so
-- every database predating this migration carries a row per message that stays
-- unprocessed forever, in the partial index the drain polls (reader#1063). No
-- consumer ever wanted the rows, so they go rather than being marked processed.
DELETE FROM `outbox` WHERE `event` = 'message.created';
