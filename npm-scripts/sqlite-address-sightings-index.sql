-- The index behind "where else has this address been seen", applied by the
-- migrator (packages/migrate/src/run-migrate.ts) and by the repair's own test.
--
-- envelope_address is generated from TypeSpec, whose only secondary index on it
-- is by message_id; the reverse direction needs a third GSI on the shared
-- DynamoDB table, which no deployment provisions. It is installed here for the
-- same reason the FTS objects are: SQLite needs it and the entity emitter
-- cannot express it.
CREATE INDEX IF NOT EXISTS envelope_address_by_address_id
  ON envelope_address (address_id, message_id);
