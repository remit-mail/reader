-- Post-commit change-data-capture for search indexing (pg-parity, R5).
--
-- The message write inserts an `outbox` row in the same transaction (durable,
-- transactional outbox). This trigger fires AFTER that insert; pg_notify is
-- delivered on COMMIT, so the search-index worker is woken event-triggered
-- (no constant poller that would keep a scale-to-zero database awake).
--
-- Kept out of the drizzle schema on purpose: the unit-test harness pushes the
-- drizzle schema into an extension-less embedded Postgres, and this trigger is
-- only meaningful where the worker runs.

-- Three events wake the indexer:
--   message.body_synced — the parsed body just landed (new content to embed).
--   message.moved       — the message settled in a new mailbox; its body is
--                         unchanged, so the worker re-indexes with force to
--                         refresh the stored mailbox metadata.
--   message.removed     — the message's rows were deleted (account purge); the
--                         worker relays a search-index REMOVE to drop the vectors.
-- The message-created row lands before the body and threadMessage exist, so it
-- is not notified — it would only produce a no-op job.
--
-- The payload carries the event so the worker can tell a move (force) from a
-- body-sync: `<event>:<message_id>`.
--
-- The outbox is append-only, so every body change / move is its own INSERT and
-- fires exactly one NOTIFY. Fires on INSERT only: the worker's `processed_at`
-- update must not re-fire it (no self-perpetuating drain loop).
CREATE OR REPLACE FUNCTION remit_outbox_notify() RETURNS trigger AS $$
BEGIN
	IF NEW.event IN ('message.body_synced', 'message.moved', 'message.removed') THEN
		PERFORM pg_notify('remit_outbox_index', NEW.event || ':' || NEW.message_id);
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS remit_outbox_notify_trg ON outbox;

CREATE TRIGGER remit_outbox_notify_trg
	AFTER INSERT ON outbox
	FOR EACH ROW
	EXECUTE FUNCTION remit_outbox_notify();
