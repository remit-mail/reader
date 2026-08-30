import { createHash } from "node:crypto";
import shortUuid from "short-uuid";
import { v5 as uuidv5 } from "uuid";
import type { MessageIdSource } from "./types.js";

const translator = shortUuid.createTranslator(shortUuid.constants.uuid25Base36);

export const base36uuid = (): string => translator.generate();

export const base36uuidv5 = (name: string, namespace: string): string =>
	translator.fromUUID(uuidv5(name, namespace));

export const REMIT_NAMESPACE = "9e89694d-214b-4d9b-99f5-214b4d9b99f5";

export const deriveAddressId = (
	accountConfigId: string,
	email: string,
): string =>
	base36uuidv5(
		`address:${accountConfigId}:${email.toLowerCase()}`,
		REMIT_NAMESPACE,
	);

/**
 * The stored form of a calendar's URL segment (issue #15). A DAV path segment
 * is matched case-insensitively by the clients that bookmark one, so the folded
 * form is what both the derived id and the stored column are built from — the
 * id derivation folding on its own would let `findByUrlSegment` and a `get` by
 * derived id disagree about the same path.
 */
export const normalizeCalendarUrlSegment = (urlSegment: string): string =>
	urlSegment.trim().toLowerCase();

/**
 * Identity of a calendar collection (issue #15). Derived from the account
 * config and the collection's URL segment, so the CalDAV path a client
 * bookmarks resolves to a row with no lookup table, and provisioning the
 * default collection twice — two concurrent first uses of the same account —
 * writes the same row rather than a second, unreachable one.
 */
export const deriveCalendarId = (
	accountConfigId: string,
	urlSegment: string,
): string =>
	base36uuidv5(
		`calendar:${accountConfigId}:${normalizeCalendarUrlSegment(urlSegment)}`,
		REMIT_NAMESPACE,
	);

/**
 * Identity of a calendar resource (issue #15). Derived from its collection and
 * its resource name — the last path segment of the resource's URL — so a
 * repeated PUT of the same resource rewrites its own row instead of forking a
 * duplicate the collection can never reach.
 *
 * The resource name, not the iCalendar UID, is the name: CalDAV addresses a
 * resource by URL, and a client is free to store the same UID under a second
 * name (RFC 4791 4.1). Keying on the UID would make those two resources one
 * row and silently lose the second.
 */
export const deriveCalendarObjectId = (
	calendarId: string,
	resourceName: string,
): string =>
	base36uuidv5(`calendarobject:${calendarId}:${resourceName}`, REMIT_NAMESPACE);

/**
 * Identity of a suggestion read out of a message (issue #1033). Derived from
 * the message, the MIME part the bytes came from and the event's iCalendar
 * UID, so re-reading the same message converges on the row it already wrote
 * instead of stacking a second card on the message every pass.
 *
 * All three parts are needed. The message alone would merge two invitations
 * sent in one mail; the part alone is not stable enough to key on across a
 * re-parse; and the UID keeps two events sent as one part apart.
 *
 * The message is in the seed, so identity is per message, not per event: a
 * later message carrying the same UID derives its own id, and the earlier
 * suggestion survives beside it as `Superseded`. The user can see which
 * revision they are being asked about, and the older message still has a card.
 * The same holds for a plain resend — a redelivered copy is a new message and
 * so a new card, which the SEQUENCE comparison then declines to supersede
 * anything for.
 */
export const deriveCalendarSuggestionId = (
	messageId: string,
	bodyPartId: string,
	icalUid: string,
): string =>
	base36uuidv5(
		`calendarsuggestion:${messageId}:${bodyPartId}:${icalUid}`,
		REMIT_NAMESPACE,
	);

export const isValidMessageId = (messageId: string | undefined): boolean => {
	if (!messageId) return false;
	const trimmed = messageId.trim();
	return trimmed !== "" && trimmed !== "<>";
};

export const normalizeMessageIdHeader = (source: MessageIdSource): string => {
	if (isValidMessageId(source.messageId)) {
		return source.messageId as string;
	}

	const parts = [
		"generated",
		source.mailboxId,
		source.uid.toString(),
		source.date || "",
		source.subject || "",
		source.fromMailbox || "",
		source.fromHost || "",
	];

	return parts.join(":");
};

export const deriveMessageId = (
	accountId: string,
	messageIdHeader: string,
): string =>
	base36uuidv5(`message:${accountId}:${messageIdHeader}`, REMIT_NAMESPACE);

export const deriveMessageIdFromSource = (
	accountId: string,
	source: MessageIdSource,
): string => deriveMessageId(accountId, normalizeMessageIdHeader(source));

/**
 * Identity of a message copied into another folder (issue #75). Derived from
 * the source message and the destination mailbox so a copy is deterministic:
 * copying the same mail into the same folder twice — a replayed COPY event or a
 * repeated user copy — resolves to one row instead of a fresh unreachable
 * duplicate each time. A random id, which is what the copy path used before,
 * gave every attempt a new identity that no later sync or delete could reach.
 *
 * The destination mailbox is part of the name so a copy of one mail into two
 * folders is two rows, one per folder. It also keeps this id out of the space
 * sync assigns: sync keys a message on `deriveMessageId(accountId,
 * messageIdHeader)`, which is folder-independent, so the copy row can never
 * collide with, or be overwritten by, the canonical synced row.
 */
export const deriveCopyMessageId = (
	sourceMessageId: string,
	destinationMailboxId: string,
): string =>
	base36uuidv5(
		`messagecopy:${sourceMessageId}:${destinationMailboxId}`,
		REMIT_NAMESPACE,
	);

/**
 * Identity of a conversation (issue #1017). Keyed on the account config, not on
 * the account: two mailboxes connected to one config hold the same conversation,
 * and keying on the account gave each of them its own thread rooted at the same
 * header — so a reply sent from the second account opened a conversation of one
 * beside the one it answered.
 *
 * Messages stay per account (`deriveMessageId`). Each account keeps its own copy
 * of a mail, and the copies meet in one thread through the shared root header.
 */
export const deriveThreadId = (
	accountConfigId: string,
	rootMessageIdHeader: string,
): string =>
	base36uuidv5(
		`thread:${accountConfigId}:${rootMessageIdHeader.toLowerCase()}`,
		REMIT_NAMESPACE,
	);

export const deriveEnvelopeId = (messageId: string): string =>
	base36uuidv5(`envelope:${messageId}`, REMIT_NAMESPACE);

/**
 * Canonical IMAP path for the root MIME node. BODYSTRUCTURE leaves the
 * root's `part` blank; we assign "0" so it has a stable, unambiguous key
 * across the codebase (BodyPart row id, S3 key, seed scripts).
 */
export const ROOT_PART_PATH = "0";

export const deriveBodyPartId = (messageId: string, partPath: string): string =>
	base36uuidv5(`bodypart:${messageId}:${partPath}`, REMIT_NAMESPACE);

/**
 * Identity of a quarantined message (issue #72). Derived rather than generated
 * so re-quarantining the same message rewrites its own row: the sync path can
 * write without first checking whether an entry already exists.
 *
 * `uidValidity` is part of the name because a uid alone does not identify a
 * message — only uidValidity + uid does, forever (RFC 9051 2.3.1.1). A mailbox
 * keeps its `mailboxId` across a UIDVALIDITY bump (the sync path updates the
 * same row), so without this a stale entry would derive the same id as a later,
 * unrelated message and suppress it from a sync round.
 */
export const deriveQuarantineId = (
	accountId: string,
	mailboxId: string,
	uidValidity: number,
	uid: number,
): string =>
	base36uuidv5(
		`quarantine:${accountId}:${mailboxId}:${uidValidity}:${uid}`,
		REMIT_NAMESPACE,
	);

/**
 * The `sha256:`-prefixed Message-ID hash a quarantine record carries, or
 * undefined when the message declared no usable Message-ID.
 *
 * The sync path coerces a missing Message-ID to `""`, and hashing that would
 * give every Message-ID-less message the same hash — so the one field whose
 * purpose is correlating reports of the same message would silently correlate
 * unrelated ones. Absent is the honest value, and this is the only way the
 * value is produced, so the empty hash cannot be written by accident.
 */
export const quarantineMessageIdHash = (
	messageIdHeader: string | undefined,
): string | undefined => {
	if (!messageIdHeader || !isValidMessageId(messageIdHeader)) return undefined;
	const digest = createHash("sha256")
		.update(messageIdHeader.trim())
		.digest("hex");
	return `sha256:${digest}`;
};
