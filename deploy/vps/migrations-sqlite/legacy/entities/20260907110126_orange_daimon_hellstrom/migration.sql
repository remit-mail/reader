-- Custom SQL migration file, put your code below! --

-- `original_uid` says the row's `uid` was recorded under `originalMailboxId`,
-- which stops being true the moment a placement settles. `updateUid` only began
-- clearing it on settle in #1217, so every database written before that carries
-- settled rows with a stale one — and `carriesForeignUid` reads the pair
-- without consulting `status`, on purpose, so those rows answer "this uid
-- belongs to another folder" forever (reader#1230).
--
-- What that costs: Empty Trash refuses to remove such a row after the server
-- copy is already expunged, leaving mail that no longer exists visible in Trash
-- with nothing able to clear it. The collision is not exotic — two folders
-- count uids independently, so a young account hands back the same number most
-- of the time.
--
-- `active` is exactly the set with no mutation outstanding
-- (docs/architecture/imap-mutations.md R3), so it is exactly the set whose
-- `original_uid` is stale. `originalMailboxId` stays: Undo restores to it.
UPDATE `message` SET `original_uid` = NULL WHERE `status` = 'active';
