import shortUuid from "short-uuid";
import { v5 as uuidv5 } from "uuid";
import type { MessageIdSource } from "./types.js";

const translator = shortUuid.createTranslator(shortUuid.constants.uuid25Base36);

export const base36uuid = (): string => translator.generate();

export const fromUUID = (uuid: string): string => translator.fromUUID(uuid);

export const toUUID = (shortId: string): string => translator.toUUID(shortId);

export const generateUuidv5 = (name: string, namespace: string): string =>
	uuidv5(name, namespace);

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

export const deriveEnvelopeAddressId = (
	messageId: string,
	role: string,
	order: number,
): string =>
	base36uuidv5(
		`envelopeaddress:${messageId}:${role}:${order}`,
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

export const deriveThreadId = (
	accountId: string,
	rootMessageIdHeader: string,
): string =>
	base36uuidv5(
		`thread:${accountId}:${rootMessageIdHeader.toLowerCase()}`,
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

export const deriveBodyPartParameterId = (
	messageId: string,
	partPath: string,
	parameterName: string,
): string =>
	base36uuidv5(
		`bodypartparam:${messageId}:${partPath}:${parameterName.toLowerCase()}`,
		REMIT_NAMESPACE,
	);

/**
 * Identity of a quarantined message (issue #72). Derived rather than generated
 * so re-quarantining the same message rewrites its own row: the sync path can
 * write without first checking whether an entry already exists.
 */
export const deriveQuarantineId = (
	accountId: string,
	mailboxId: string,
	uid: number,
): string =>
	base36uuidv5(`quarantine:${accountId}:${mailboxId}:${uid}`, REMIT_NAMESPACE);
