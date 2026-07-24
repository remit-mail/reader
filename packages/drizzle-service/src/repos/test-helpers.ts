import { rmSync } from "node:fs";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import EmbeddedPostgres from "embedded-postgres";
import {
	type MessageDataSchema,
	messageDataSchema,
} from "../schema/message-data.js";

export type TestDb = NodePgDatabase<MessageDataSchema>;

function randomPort(): number {
	return 54500 + Math.floor(Math.random() * 400);
}

export async function createTestDb(): Promise<{
	db: TestDb;
	stop: () => Promise<void>;
}> {
	const port = randomPort();
	const databaseDir = `/tmp/drizzle-test-pg-${port}-${Date.now()}`;

	const pg = new EmbeddedPostgres({
		databaseDir,
		user: "test",
		password: "test",
		port,
		persistent: false,
	});

	await pg.initialise();
	await pg.start();

	const connectionString = `postgresql://test:test@localhost:${port}/postgres`;
	const db = drizzle(connectionString, { schema: messageDataSchema }) as TestDb;

	await db.execute(sql.raw(DDL));

	return {
		db,
		stop: async () => {
			const client = (
				db as unknown as { $client: { end: () => Promise<void> } }
			).$client;
			await client.end();
			await pg.stop();
			try {
				rmSync(databaseDir, { recursive: true, force: true });
			} catch {
				// best-effort cleanup
			}
		},
	};
}

const DDL = `
CREATE TABLE IF NOT EXISTS envelope (
  envelope_id       UUID PRIMARY KEY,
  message_id        UUID NOT NULL,
  date_value        BIGINT NOT NULL,
  date_raw          TEXT NOT NULL,
  subject           TEXT,
  message_id_value  TEXT,
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS envelope_message_id_idx ON envelope (message_id);

CREATE TABLE IF NOT EXISTS message_reference (
  message_reference_id  UUID PRIMARY KEY,
  message_id            UUID NOT NULL,
  envelope_id           UUID NOT NULL,
  message_id_value      TEXT NOT NULL,
  reference_type        TEXT NOT NULL,
  reference_order       INTEGER NOT NULL,
  created_at            BIGINT NOT NULL,
  updated_at            BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS message_reference_message_id_idx ON message_reference (message_id);

CREATE TABLE IF NOT EXISTS envelope_address (
  envelope_address_id UUID PRIMARY KEY,
  message_id          UUID NOT NULL,
  address_id          UUID NOT NULL,
  display_name        TEXT,
  normalized_email    TEXT NOT NULL,
  address_role        TEXT NOT NULL,
  address_order       INTEGER NOT NULL,
  created_at          BIGINT NOT NULL,
  updated_at          BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS envelope_address_message_id_idx ON envelope_address (message_id);

CREATE TABLE IF NOT EXISTS body_part (
  body_part_id          UUID PRIMARY KEY,
  message_id            UUID NOT NULL,
  parent_body_part_id   UUID,
  part_path             TEXT NOT NULL,
  media_type            TEXT NOT NULL,
  media_subtype         TEXT NOT NULL,
  content_id            TEXT,
  content_description   TEXT,
  transfer_encoding     TEXT NOT NULL,
  size_octets           INTEGER NOT NULL,
  line_count            INTEGER,
  md5_hash              TEXT,
  disposition           TEXT,
  disposition_filename  TEXT,
  language              TEXT,
  location              TEXT,
  is_multipart          BOOLEAN NOT NULL,
  multipart_subtype     TEXT,
  created_at            BIGINT NOT NULL,
  updated_at            BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS body_part_message_id_idx ON body_part (message_id);

CREATE TABLE IF NOT EXISTS body_part_parameter (
  body_part_parameter_id  UUID PRIMARY KEY,
  message_id              UUID NOT NULL,
  body_part_id            UUID NOT NULL,
  parameter_name          TEXT NOT NULL,
  parameter_value         TEXT NOT NULL,
  created_at              BIGINT NOT NULL,
  updated_at              BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS body_part_parameter_message_id_idx ON body_part_parameter (message_id);

CREATE TABLE IF NOT EXISTS raw_message_storage (
  raw_storage_id    UUID PRIMARY KEY,
  message_id        UUID NOT NULL,
  storage_type      TEXT NOT NULL,
  storage_location  TEXT NOT NULL,
  storage_key       TEXT NOT NULL,
  size_bytes        INTEGER NOT NULL,
  checksum_sha256   TEXT NOT NULL,
  content_encoding  TEXT NOT NULL,
  stored_at         BIGINT NOT NULL,
  expires_at        BIGINT,
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS raw_message_storage_message_id_idx ON raw_message_storage (message_id);

CREATE TABLE IF NOT EXISTS body_part_storage (
  body_part_storage_id  UUID PRIMARY KEY,
  message_id            UUID NOT NULL,
  body_part_id          UUID NOT NULL,
  storage_type          TEXT NOT NULL,
  storage_location      TEXT NOT NULL,
  storage_key           TEXT NOT NULL,
  decoded_size_bytes    INTEGER NOT NULL,
  checksum_sha256       TEXT NOT NULL,
  content_encoding      TEXT NOT NULL,
  is_deduped            BOOLEAN NOT NULL,
  dedup_hash            TEXT,
  stored_at             BIGINT NOT NULL,
  created_at            BIGINT NOT NULL,
  updated_at            BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS body_part_storage_message_id_idx ON body_part_storage (message_id);

CREATE TABLE IF NOT EXISTS body_part_content (
  body_part_content_id  UUID PRIMARY KEY,
  message_id            UUID NOT NULL,
  body_part_id          UUID NOT NULL,
  content               TEXT NOT NULL,
  content_length        INTEGER NOT NULL,
  created_at            BIGINT NOT NULL,
  updated_at            BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS body_part_content_message_id_idx ON body_part_content (message_id);

CREATE TABLE IF NOT EXISTS message (
  message_id              UUID PRIMARY KEY,
  mailbox_id              UUID NOT NULL,
  uid                     INTEGER NOT NULL,
  sequence_number         INTEGER NOT NULL,
  rfc822_size             INTEGER NOT NULL,
  internal_date           BIGINT NOT NULL,
  message_id_header       TEXT,
  envelope_id             UUID NOT NULL,
  root_body_part_id       UUID NOT NULL,
  body_storage_key        TEXT,
  status                  TEXT NOT NULL DEFAULT 'active',
  sync_status             TEXT NOT NULL DEFAULT 'pending',
  original_mailbox_id     UUID,
  original_uid            INTEGER,
  category                TEXT NOT NULL DEFAULT 'uncategorized',
  authenticity            JSONB,
  auth_result             JSONB,
  provider_spam           JSONB,
  has_list_unsubscribe    BOOLEAN NOT NULL DEFAULT false,
  moved_by_remit          BOOLEAN NOT NULL DEFAULT false,
  placement_verdict       JSONB,
  filter_move             JSONB,
  created_at              BIGINT NOT NULL,
  updated_at              BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS message_mailbox_id_idx ON message (mailbox_id);

CREATE TABLE IF NOT EXISTS message_flag (
  message_flag_id   UUID PRIMARY KEY,
  message_id        UUID NOT NULL,
  flag_name         TEXT NOT NULL,
  set_at            BIGINT NOT NULL,
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS message_flag_message_id_idx ON message_flag (message_id);

CREATE TABLE IF NOT EXISTS outbox (
  id           UUID PRIMARY KEY,
  message_id   UUID NOT NULL,
  event        TEXT NOT NULL,
  payload      JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at BIGINT
);
CREATE INDEX IF NOT EXISTS outbox_message_id_idx ON outbox (message_id);
CREATE INDEX IF NOT EXISTS outbox_unprocessed_idx ON outbox (created_at) WHERE processed_at IS NULL;
`;
