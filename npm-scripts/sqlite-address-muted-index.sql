-- The address lookup the muted-sender predicate walks, applied by the migrator
-- (packages/migrate/src/run-migrate.ts) beside the other hand-installed indexes.
--
-- `muted` is a flag on the Address, not a column on thread_message, so the
-- listing and the count reach it through a correlated `exists` keyed on
-- (account_config_id, normalized_email). The only index the generated schema
-- carries is (account_config_id, normalized_compound), which that predicate
-- cannot use: without this the subquery is a table scan of every address, once
-- per candidate row, and a brief that counts seven sections pays it seven times.
CREATE INDEX IF NOT EXISTS address_by_normalized_email
  ON address (account_config_id, normalized_email);
