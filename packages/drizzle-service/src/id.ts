import shortUuid from "short-uuid";
import { v5 as uuidv5 } from "uuid";

const REMIT_NAMESPACE = "9e89694d-214b-4d9b-99f5-214b4d9b99f5";

const base36 = shortUuid.createTranslator(shortUuid.constants.uuid25Base36);

// A 25-char base36-encoded UUID, matching the id format the API contract
// enforces (path params carry minLength 25) and the electrodb adapter's
// base36uuid. The prior Math.random-based generator produced variable-length
// ids (~19 chars) that failed `{accountId}`/`{messageId}` path validation.
export const randomId = (): string => base36.generate();

export const generateDeterministicId = (name: string): string =>
	uuidv5(name, REMIT_NAMESPACE);

// Deterministic base36-encoded UUIDv5, byte-identical to the electrodb
// adapter's `base36uuidv5` so a `MessageLabel` derived from the same
// (messageId, labelId) keys the same row on either backend.
export const deterministicBase36Id = (name: string): string =>
	base36.fromUUID(uuidv5(name, REMIT_NAMESPACE));

export const bodyPartId = (messageId: string, partPath: string): string =>
	generateDeterministicId(`${messageId}:${partPath}`);

export const rootBodyPartId = (messageId: string): string =>
	bodyPartId(messageId, "0");

export const bodyPartParameterId = (
	messageId: string,
	partPath: string,
	parameterName: string,
): string =>
	generateDeterministicId(`${messageId}:${partPath}:${parameterName}`);

export const envelopeId = (messageId: string): string =>
	generateDeterministicId(`envelope:${messageId}`);

export const envelopeAddressId = (
	messageId: string,
	role: string,
	order: number,
): string =>
	generateDeterministicId(`envelopeaddress:${messageId}:${role}:${order}`);

export const bodyPartContentId = (
	messageId: string,
	bodyPartId: string,
): string =>
	generateDeterministicId(`bodypartcontent:${messageId}:${bodyPartId}`);
