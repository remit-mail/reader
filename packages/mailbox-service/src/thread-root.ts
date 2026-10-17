import type { MessageReferenceInput } from "@remit/data-ports";
import {
	bareMessageId,
	isValidMessageId,
	wireMessageId,
} from "@remit/data-ports/id";
import { ReferenceType } from "@remit/domain-enums";
import type { ImapEnvelope } from "./types.js";

type ThreadingHeaders = Pick<ImapEnvelope, "messageId" | "inReplyTo">;

const firstUsable = (
	candidates: readonly (string | undefined)[],
): string | undefined => {
	const found = candidates.find(isValidMessageId);
	return found === undefined ? undefined : wireMessageId(found);
};

export const threadRootOf = (
	envelope: ThreadingHeaders,
	references: readonly string[] | undefined,
	messageId: string,
): string =>
	firstUsable([references?.[0], envelope.inReplyTo, envelope.messageId]) ??
	messageId;

export const parentOf = (
	envelope: ThreadingHeaders,
	references: readonly string[] | undefined,
): string | undefined =>
	firstUsable([envelope.inReplyTo, references?.[references.length - 1]]);

export const messageReferencesOf = (
	envelope: ThreadingHeaders,
	references: readonly string[] | undefined,
): MessageReferenceInput[] => [
	...(isValidMessageId(envelope.inReplyTo)
		? [
				{
					messageIdValue: bareMessageId(envelope.inReplyTo),
					referenceType: ReferenceType.InReplyTo,
					referenceOrder: 0,
				},
			]
		: []),
	...(references ?? []).filter(isValidMessageId).map((reference, index) => ({
		messageIdValue: bareMessageId(reference),
		referenceType: ReferenceType.References,
		referenceOrder: index,
	})),
];
