import {
	DomainRegistrationSchema,
	MessageRecordSchema,
} from "@remit/api-zod-schemas";
import type { DomainRegistrationItem, MessageSpamVerdict } from "./types.js";

const StoredSpamVerdictSchema = MessageRecordSchema.shape.spamVerdict;
const StoredDomainRegistrationSchema =
	DomainRegistrationSchema.shape.registration;

export const readStoredSpamVerdict = (stored: unknown): MessageSpamVerdict =>
	StoredSpamVerdictSchema.parse(stored);

export const readStoredDomainRegistration = (
	stored: unknown,
): DomainRegistrationItem["registration"] =>
	StoredDomainRegistrationSchema.parse(stored);

export const NOT_CHECKED: MessageSpamVerdict = { state: "NotChecked" };
