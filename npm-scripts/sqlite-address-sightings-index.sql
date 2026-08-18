CREATE INDEX IF NOT EXISTS envelope_address_by_address_id
  ON envelope_address (address_id, message_id);
