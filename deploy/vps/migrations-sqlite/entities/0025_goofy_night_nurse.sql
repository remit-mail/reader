-- Custom SQL migration file, put your code below! --

-- `active` + `failed` was the whole signal for "Remit gave up on your delete"
-- before this release, written by `abandonDelete` and read by the row chip and
-- the reading-pane notice. The give-up now has a value of its own, and the
-- surfaces gate on it, so a row already carrying the old pair would go quiet:
-- the message stays where it was handed back, the user is told nothing, and
-- nothing else settles the row afterwards.
--
-- `active` + `failed` had no other writer. Every transient attempt leaves
-- `moving` or `deleting` beside `failed`, and every settle writes `synced`, so
-- this predicate names the abandoned deletes and nothing else.
UPDATE `message`
SET `sync_status` = 'abandoned', `abandoned_mutation` = 'delete'
WHERE `status` = 'active' AND `sync_status` = 'failed';
