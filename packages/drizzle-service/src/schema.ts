// App/dev-facing drizzle schema: every table under a single `*Table` alias,
// the names the repos and `pushSchema` (test-db.ts) consume. Each table appears
// exactly once here — `pushSchema` registers a table's indexes per exported
// binding, so exposing one table under two names creates duplicate index names
// and breaks `apply()`. The committed-migration `generate` reads schema-full.ts
// instead (the entity package wholesale), so the migration is driven by the
// entities, not by this hand-maintained alias list.

export {
	filterAnchors as filterAnchorTable,
	filters as filterTable,
	labels as labelTable,
	mailboxAttributeEntries as mailboxAttributeEntryTable,
	mailboxFlags as mailboxFlagTable,
	messageLabels as messageLabelTable,
} from "@remit/drizzle-pg-schema";
export * from "./schema/i4-account-config.js";
export * from "./schema/i4-account-export-request.js";
export * from "./schema/i4-account-setting.js";
export * from "./schema/i4-address.js";
export * from "./schema/i4-mailbox.js";
export * from "./schema/i4-mailbox-lock.js";
export * from "./schema/i4-message-flag-push.js";
export * from "./schema/i4-message-placement-move.js";
export * from "./schema/i4-outbox-message.js";
export * from "./schema/message-data.js";
export { threadMessageTable } from "./schema/thread-message.js";
