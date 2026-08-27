import {
	AccountAuthType,
	CanonicalMailboxRole,
	FilterClauseField,
	FilterMatchOperator,
	FilterScope,
	LabelColor,
	MessageCategory,
} from "@remit/domain-enums";
import { z } from "zod/v4";
import { CONFIG_KIND, CURRENT_SCHEMA_VERSION } from "./version.js";

const NonEmpty = z.string().min(1);

/**
 * A reader identifier in the form it is stored and travels: a UUID re-encoded
 * base36 to a fixed 25 characters, which is what the `UUID` scalar in the API
 * contract means here and what every id in the database actually holds. The
 * account id crosses verbatim — resynced message ids hash from it — so the file
 * has to accept the stored spelling rather than the RFC 4122 one.
 */
const StoredId = z.string().length(25);
const IsoDateTime = z.iso.datetime({ offset: true });
const Port = z.int().min(1).max(65535);
const FlagTimestamp = z.int();

/**
 * An IMAP path, as the server spells it. Folders travel by path rather than by
 * id: the ids are local to the instance that wrote the file, the path is what
 * the receiving instance can actually resolve against its own mailbox list.
 */
const ImapPath = z.string().min(1).max(512);

/**
 * Which reader wrote the file, and when. A reader that does not recognise the
 * generator still reads the document: the envelope already said it could.
 */
export const GeneratorSchema = z
	.strictObject({
		app: NonEmpty,
		version: NonEmpty,
		exportedAt: IsoDateTime,
	})
	.describe("Which reader wrote this file, and when.");

/**
 * Where the file came from, recorded and never authoritative. A database drop
 * can change the account config id, so the importing instance rebinds to its
 * own; this block only lets a person tell two exports apart.
 */
export const ProvenanceSchema = z
	.strictObject({
		accountConfigId: StoredId,
		instance: z.string(),
	})
	.describe("The instance this file was exported from. Never applied.");

/** The audit metadata every sender-level flag and mute carries. */
export const FlagMetadataSchema = z.strictObject({
	value: z.boolean(),
	setAt: FlagTimestamp,
	setBy: z.string().optional(),
	expiresAt: FlagTimestamp.optional(),
	reason: z.string().optional(),
});

export const MutedFlagSchema = FlagMetadataSchema;

const CategoryFlagSchema = z.strictObject({
	value: z.enum(MessageCategory),
	setAt: FlagTimestamp,
	setBy: z.string().optional(),
	expiresAt: FlagTimestamp.optional(),
	reason: z.string().optional(),
});

/**
 * Sender-level flags, sparse exactly as they are stored: a key's presence is
 * the flag being set. Each entry carries its full payload — who set it, when,
 * why, and when it lapses — because a flag stripped to a boolean arrives on the
 * other side as an assertion nobody can date or explain.
 *
 * `wellknown` and `junkOnly` have no place here. The machine derives both, from
 * engagement counters and from where mail was seen, and both come back on their
 * own after a resync; carrying them would let a stale file overrule what the
 * receiving instance has since worked out for itself.
 */
export const AddressFlagsSchema = z.strictObject({
	trusted: FlagMetadataSchema.optional(),
	blocked: FlagMetadataSchema.optional(),
	muted: FlagMetadataSchema.optional(),
	vip: FlagMetadataSchema.optional(),
	category: CategoryFlagSchema.optional(),
	autoArchive: FlagMetadataSchema.optional(),
	unsubscribed: FlagMetadataSchema.optional(),
});

export const AddressFlagsEntrySchema = z.strictObject({
	/** Lowercased address. The identity an importing instance matches on. */
	normalizedEmail: NonEmpty,
	/**
	 * The personal name last seen on mail from this address. A display hint for
	 * an import preview and nothing more: it is not authoritative, it is never
	 * matched on, and an importing instance overwrites it from its own mail.
	 */
	displayName: z.string(),
	flags: AddressFlagsSchema,
});

/**
 * Which credential the account needs to come back to life, never the credential
 * itself. The importing instance prompts for what this names.
 */
export const CredentialRequirementSchema = z.strictObject({
	required: z.enum(["password", "oauth"]),
	provider: z.literal("microsoft").optional(),
});

export const ImapEndpointSchema = z.strictObject({
	host: NonEmpty,
	port: Port,
	tls: z.boolean(),
	startTls: z.boolean(),
});

export const SmtpEndpointSchema = z.strictObject({
	enabled: z.boolean(),
	host: z.string(),
	port: Port,
	tls: z.boolean(),
	startTls: z.boolean(),
	/** Empty when sending reuses the IMAP username. */
	username: z.string(),
});

export const SignatureSchema = z.strictObject({
	plainText: z.string(),
	html: z.string(),
});

/** A canonical role, bound to the folder that fills it by IMAP path. */
export const FolderRoleSchema = z.strictObject({
	role: z.enum(CanonicalMailboxRole),
	folderPath: ImapPath,
});

/** Per-folder settings that survive the move, keyed by IMAP path. */
export const FolderOverrideSchema = z.strictObject({
	folderPath: ImapPath,
	/** Empty when the folder keeps the name the server gives it. */
	displayName: z.string(),
	muted: MutedFlagSchema.nullable(),
});

export const AccountSchema = z.strictObject({
	accountId: StoredId,
	email: NonEmpty,
	username: NonEmpty,
	authType: z.enum(AccountAuthType),
	credentials: CredentialRequirementSchema,
	isActive: z.boolean(),
	imap: ImapEndpointSchema,
	smtp: SmtpEndpointSchema,
	/** Empty when the client derives a label from the address. */
	displayName: z.string(),
	muted: MutedFlagSchema.nullable(),
	composeLanguages: z.array(NonEmpty),
	signature: SignatureSchema,
	folderRoles: z.array(FolderRoleSchema),
	folderOverrides: z.array(FolderOverrideSchema),
	pinnedFolders: z.array(ImapPath),
});

export const AccountConfigSchema = z.strictObject({
	name: z.string(),
	/**
	 * Which body format the composer opens on. A server-held setting rather than
	 * a browser one — it is stored per configuration and travels with it, so a
	 * database drop loses it unless the file carries it. Optional because a
	 * configuration that has never been asked holds no row.
	 */
	defaultComposerFormat: z.string().optional(),
});

export const LabelSchema = z.strictObject({
	name: z.string().min(1).max(140),
	color: z.enum(LabelColor),
});

export const FilterClauseSchema = z.strictObject({
	field: z.enum(FilterClauseField),
	value: z.string().min(1).max(256),
});

/**
 * A semantic anchor as text, never as numbers. The vector is a function of the
 * embedding model that produced it, so it means nothing on an instance running
 * a different one; the source text re-embeds against whatever model the
 * importing instance actually has.
 */
export const FilterAnchorSchema = z.strictObject({
	sourceText: z.string().min(1).max(512),
	/** `<modelId>@<dimensions>` the vector was built with, for provenance. */
	embeddingId: NonEmpty,
	sourceMessageId: StoredId,
});

/** A folder named the only way it can be named across instances. */
export const FolderRefSchema = z.strictObject({
	accountId: StoredId,
	folderPath: ImapPath,
});

export const FilterSchema = z.strictObject({
	name: z.string().min(1).max(256),
	scope: z.enum(FilterScope),
	/** ISO 8601 with offset when the scope is Temporary, otherwise null. */
	expiresAt: IsoDateTime.nullable(),
	matchOperator: z.enum(FilterMatchOperator),
	literalClauses: z.array(FilterClauseSchema),
	/** The label this filter applies, by name — ids are local to an instance. */
	actionLabelName: z.string().min(1).max(140).nullable(),
	actionFolder: FolderRefSchema.nullable(),
	anchor: FilterAnchorSchema.nullable(),
});

export const SavedSearchSchema = z.strictObject({
	name: NonEmpty,
	query: z.string(),
});

/**
 * Preferences the browser holds, not the server. They survive a database drop
 * already; they ride along so they also survive a change of browser. The server
 * ignores this block.
 */
export const ClientPreferencesSchema = z.strictObject({
	theme: z.string(),
	density: z.string(),
	savedSearches: z.array(SavedSearchSchema),
});

/**
 * Reserved. Per-message decisions — what was filed where, what was dismissed —
 * are the one part of a mailbox's history this format does not yet describe,
 * and the slot is named here so a later version can fill it without moving
 * anything else. Nothing writes it and nothing reads it, so v1 requires it to
 * be empty: accepting entries a reader would then drop is worse than refusing
 * the file.
 */
export const MessageDecisionsSchema = z
	.array(z.unknown())
	.max(0)
	.describe("Reserved for a later schema version; must be empty in v1.");

export const ReaderConfigDocumentSchema = z.strictObject({
	kind: z.literal(CONFIG_KIND),
	schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
	generator: GeneratorSchema,
	provenance: ProvenanceSchema,
	accountConfig: AccountConfigSchema,
	accounts: z.array(AccountSchema),
	labels: z.array(LabelSchema),
	filters: z.array(FilterSchema),
	addressFlags: z.array(AddressFlagsEntrySchema),
	clientPreferences: ClientPreferencesSchema.optional(),
	messageDecisions: MessageDecisionsSchema.optional(),
});

export type ReaderConfigDocument = z.infer<typeof ReaderConfigDocumentSchema>;
export type ConfigAccount = z.infer<typeof AccountSchema>;
export type ConfigFilter = z.infer<typeof FilterSchema>;
export type ConfigLabel = z.infer<typeof LabelSchema>;
export type ConfigAddressFlagsEntry = z.infer<typeof AddressFlagsEntrySchema>;
export type ConfigAddressFlags = z.infer<typeof AddressFlagsSchema>;
export type ConfigClientPreferences = z.infer<typeof ClientPreferencesSchema>;
