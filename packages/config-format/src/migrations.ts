import { ConfigVersionError } from "./errors.js";
import { CURRENT_SCHEMA_VERSION } from "./version.js";

export type ConfigDocumentShape = Record<string, unknown>;

/**
 * One step of the chain that lifts an older document to the current version.
 * A migration works on the raw object, before the strict parse: the shape it
 * receives satisfied an older schema, and the shape it returns is only claimed
 * to satisfy the next one.
 */
export type ConfigMigration = {
	readonly from: number;
	readonly to: number;
	migrate(document: ConfigDocumentShape): ConfigDocumentShape;
};

const dropFilterAnchors: ConfigMigration = {
	from: 1,
	to: 2,
	migrate: (document) => ({
		...document,
		schemaVersion: 2,
		filters: Array.isArray(document.filters)
			? document.filters.map(({ anchor: _anchor, ...filter }) => filter)
			: document.filters,
	}),
};

/**
 * The golden v1 fixture is the seed that keeps the chain honest: every step
 * has a committed v1 document to lift, so the chain is exercised by the same
 * test that proves v1 still reads.
 */
export const configMigrations: readonly ConfigMigration[] = [dropFilterAnchors];

/**
 * Apply the chain from `fromVersion` up to the current version. A gap in the
 * chain is a fault, not a skipped step — silently leaving a document at an old
 * version would hand the strict parse a shape it was never meant to see.
 */
export function liftToCurrentVersion(
	document: ConfigDocumentShape,
	fromVersion: number,
	migrations: readonly ConfigMigration[] = configMigrations,
	targetVersion: number = CURRENT_SCHEMA_VERSION,
): ConfigDocumentShape {
	let version = fromVersion;
	let lifted = document;
	while (version < targetVersion) {
		const step = migrations.find((migration) => migration.from === version);
		if (!step) throw new ConfigVersionError(fromVersion, targetVersion);
		lifted = step.migrate(lifted);
		version = step.to;
	}
	return lifted;
}
