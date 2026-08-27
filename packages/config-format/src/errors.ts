import type { $ZodIssue } from "zod/v4/core";

/**
 * Every way reading a configuration document can fail, as a closed set. A
 * caller renders the failure from `code` rather than from an `instanceof`
 * ladder; the classes exist so the throw carries the offending detail with it.
 */
export const ConfigReadErrorCode = {
	NotAnObject: "NotAnObject",
	WrongKind: "WrongKind",
	UnsupportedVersion: "UnsupportedVersion",
	UnknownKeys: "UnknownKeys",
	CredentialPresent: "CredentialPresent",
	Malformed: "Malformed",
} as const;

export type ConfigReadErrorCodeValue =
	(typeof ConfigReadErrorCode)[keyof typeof ConfigReadErrorCode];

export abstract class ConfigReadError extends Error {
	abstract readonly code: ConfigReadErrorCodeValue;

	constructor(message: string) {
		super(message);
		this.name = new.target.name;
	}
}

export class ConfigNotAnObjectError extends ConfigReadError {
	readonly code = ConfigReadErrorCode.NotAnObject;
}

export class ConfigKindError extends ConfigReadError {
	readonly code = ConfigReadErrorCode.WrongKind;
	readonly expected: string;
	readonly received: unknown;

	constructor(expected: string, received: unknown) {
		super(
			`Not a reader configuration document: expected kind "${expected}", found ${JSON.stringify(received) ?? "nothing"}.`,
		);
		this.expected = expected;
		this.received = received;
	}
}

export class ConfigVersionError extends ConfigReadError {
	readonly code = ConfigReadErrorCode.UnsupportedVersion;
	readonly documentVersion: number;
	readonly supportedVersion: number;

	constructor(documentVersion: number, supportedVersion: number) {
		super(
			documentVersion > supportedVersion
				? `Document schemaVersion ${documentVersion} was written by a newer reader; this one reads up to ${supportedVersion}. Upgrade before importing.`
				: `Document schemaVersion ${documentVersion} has no migration to ${supportedVersion}.`,
		);
		this.documentVersion = documentVersion;
		this.supportedVersion = supportedVersion;
	}
}

export class ConfigUnknownKeysError extends ConfigReadError {
	readonly code = ConfigReadErrorCode.UnknownKeys;
	readonly keys: readonly string[];
	readonly path: string;

	constructor(path: string, keys: readonly string[]) {
		super(
			`Unknown ${keys.length === 1 ? "key" : "keys"} at ${path}: ${keys.join(", ")}. A document this reader does not fully understand is refused rather than partly applied.`,
		);
		this.keys = keys;
		this.path = path;
	}
}

/**
 * A configuration document is a description of accounts, never a copy of their
 * secrets. A file carrying one is refused outright: importing it would move a
 * credential through a channel that was never meant to hold one, and silently
 * dropping the field would teach the exporter that writing it is harmless.
 */
export class ConfigCredentialError extends ConfigReadError {
	readonly code = ConfigReadErrorCode.CredentialPresent;
	readonly keys: readonly string[];
	readonly path: string;

	constructor(path: string, keys: readonly string[]) {
		super(
			`Credential ${keys.length === 1 ? "field" : "fields"} at ${path}: ${keys.join(", ")}. A configuration document declares which credential an account needs; it never carries one.`,
		);
		this.keys = keys;
		this.path = path;
	}
}

export class ConfigMalformedError extends ConfigReadError {
	readonly code = ConfigReadErrorCode.Malformed;
	readonly issues: readonly $ZodIssue[];

	constructor(issues: readonly $ZodIssue[]) {
		super(
			`Configuration document does not match schema version: ${issues
				.map((issue) => `${formatPath(issue.path)}: ${issue.message}`)
				.join("; ")}`,
		);
		this.issues = issues;
	}
}

export function formatPath(path: readonly PropertyKey[]): string {
	if (path.length === 0) return "(document root)";
	return path
		.map((segment) =>
			typeof segment === "number" ? `[${segment}]` : `.${String(segment)}`,
		)
		.join("")
		.replace(/^\./, "");
}
