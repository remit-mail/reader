-- Custom SQL migration file, put your code below! --

-- `active` + `failed` was the whole signal for "Remit gave up" before this
-- release, and the surfaces now gate on the give-up's own value, so a row
-- already carrying the old pair would go quiet: the message stays where it was
-- handed back, the user is told nothing, and nothing else settles the row.
--
-- `active` + `failed` had no other writer. Every transient attempt leaves
-- `moving` or `deleting` beside `failed`, and every settle writes `synced`, so
-- this predicate names the give-ups and nothing else.
--
-- It names two of them, and they cannot be told apart. `abandonDelete` and the
-- paused-cursor hand-back for an unproven MOVE both go through the same
-- `restoreSourcePlacement` write — same pair, same restored source, same
-- `original_mailbox_id` and `original_uid` — so no column distinguishes a
-- refused delete from a move that gave up. That is the defect this release
-- fixes going forward, by having the give-up name itself; it cannot be undone
-- for rows already written.
--
-- So they are labelled `move`, deliberately, because the two mistakes are not
-- the same size. Labelling a handed-back move as a delete is reader#1229
-- exactly: the reading pane says "This message was not deleted" and offers a
-- button that deletes it — mail destroyed on a press the user believed was a
-- repair. Labelling a refused delete as a move offers a folder picker instead:
-- wrong copy, and nothing happens until the user chooses a folder. A picker
-- someone dismisses is recoverable; a delete is not.
UPDATE `message`
SET `sync_status` = 'abandoned', `abandoned_mutation` = 'move'
WHERE `status` = 'active' AND `sync_status` = 'failed';
