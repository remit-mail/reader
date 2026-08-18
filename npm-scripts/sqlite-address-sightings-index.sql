-- Applied by the migrator (packages/migrate/src/run-migrate.ts). It lives here
-- rather than on the entity because the reverse of envelope_address's generated
-- by-message index needs a third GSI on the shared DynamoDB table, which no
-- deployment provisions.
CREATE INDEX IF NOT EXISTS envelope_address_by_address_id
  ON envelope_address (address_id, message_id);
