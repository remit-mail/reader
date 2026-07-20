// App/dev-facing drizzle schema: every table under a single `*Table` alias,
// the names the repos and `pushSchema` (test-db.ts) consume. Each table appears
// exactly once here — `pushSchema` registers a table's indexes per exported
// binding, so exposing one table under two names creates duplicate index names
// and breaks `apply()`. The committed-migration `generate` reads schema-full.ts
// instead (the entity package wholesale), so the migration is driven by the
// entities, not by this hand-maintained alias list.

import { entities } from "./schema/active-entities.js";

export const filterAnchorTable = entities.filterAnchors;
export const filterTable = entities.filters;
export const labelTable = entities.labels;
export const mailboxAttributeEntryTable = entities.mailboxAttributeEntries;
export const mailboxFlagTable = entities.mailboxFlags;
export const messageLabelTable = entities.messageLabels;
export * from "./schema/i4-account-config.js";
export * from "./schema/i4-account-export-request.js";
export * from "./schema/i4-account-setting.js";
export * from "./schema/i4-address.js";
export * from "./schema/i4-mailbox.js";
export * from "./schema/i4-mailbox-lock.js";
export * from "./schema/i4-message-flag-push.js";
export * from "./schema/i4-message-placement-move.js";
export * from "./schema/i4-organize-job-request.js";
export * from "./schema/i4-outbox-message.js";
export * from "./schema/message-data.js";
export * from "./schema/quarantine.js";
export { threadMessageTable } from "./schema/thread-message.js";
