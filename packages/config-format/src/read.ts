import type { $ZodIssue, $ZodIssueUnrecognizedKeys } from "zod/v4/core";
import {
	type ReaderConfigDocument,
	ReaderConfigDocumentSchema,
} from "./document.js";
import { ConfigEnvelopeSchema } from "./envelope.js";
import {
	ConfigCredentialError,
	ConfigKindError,
	ConfigMalformedError,
	ConfigNotAnObjectError,
	ConfigUnknownKeysError,
	ConfigVersionError,
	formatPath,
} from "./errors.js";
import {
	type ConfigDocumentShape,
	type ConfigMigration,
	liftToCurrentVersion,
} from "./migrations.js";
import { CONFIG_KIND, CURRENT_SCHEMA_VERSION } from "./version.js";

/**
 * Substrings that make a key a credential. Matched on the lowercased key so a
 * field arrives refused whatever the exporter chose to call it — `password`,
 * `smtpPasswordHash`, `oauthRefreshToken` are all the same mistake.
 */
const CREDENTIAL_MARKERS = [
	"password",
	"passphrase",
	"secret",
	"token",
	"apikey",
	"privatekey",
];

const isCredentialKey = (key: string): boolean => {
	const lowered = key.toLowerCase();
	return CREDENTIAL_MARKERS.some((marker) => lowered.includes(marker));
};

const unrecognizedKeys = (
	issues: readonly $ZodIssue[],
): $ZodIssueUnrecognizedKeys[] =>
	issues.filter(
		(issue): issue is $ZodIssueUnrecognizedKeys =>
			issue.code === "unrecognized_keys",
	);

/**
 * Read a configuration document in two passes: the envelope decides what the
 * file is and which version it claims, the migration chain lifts it to the
 * version this reader knows, and only then does the strict schema see it.
 * Doing it the other way round makes every older document look like a
 * malformed current one.
 */
export function readConfigDocument(
	input: unknown,
	migrations?: readonly ConfigMigration[],
): ReaderConfigDocument {
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		throw new ConfigNotAnObjectError(
			"Not a reader configuration document: expected a JSON object.",
		);
	}

	const envelope = ConfigEnvelopeSchema.safeParse(input);
	if (!envelope.success) {
		const kindIssue = envelope.error.issues.find(
			(issue) => issue.path[0] === "kind",
		);
		if (kindIssue) {
			throw new ConfigKindError(
				CONFIG_KIND,
				(input as ConfigDocumentShape).kind,
			);
		}
		throw new ConfigMalformedError(envelope.error.issues);
	}

	if (envelope.data.schemaVersion > CURRENT_SCHEMA_VERSION) {
		throw new ConfigVersionError(
			envelope.data.schemaVersion,
			CURRENT_SCHEMA_VERSION,
		);
	}

	const lifted = liftToCurrentVersion(
		input as ConfigDocumentShape,
		envelope.data.schemaVersion,
		migrations,
	);

	const parsed = ReaderConfigDocumentSchema.safeParse(lifted);
	if (parsed.success) return parsed.data;

	const unknown = unrecognizedKeys(parsed.error.issues);
	for (const issue of unknown) {
		const credentials = issue.keys.filter(isCredentialKey);
		if (credentials.length > 0) {
			throw new ConfigCredentialError(formatPath(issue.path), credentials);
		}
	}
	const first = unknown[0];
	if (first)
		throw new ConfigUnknownKeysError(formatPath(first.path), first.keys);

	throw new ConfigMalformedError(parsed.error.issues);
}
