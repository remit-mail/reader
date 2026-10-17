/**
 * Which body parts belong to which message.
 *
 * A message/rfc822 (or message/global) part is a forwarded message carried
 * whole. Its own parts are stored under its path — `<partPath>.0` is its root —
 * and they belong to the forwarded message: the carrying message neither
 * renders them as its body nor lists them as its attachments.
 */
export interface MessagePart {
	partPath: string;
	mediaType: string;
	mediaSubtype: string;
}

const ENCAPSULATED_MESSAGE_SUBTYPES: ReadonlySet<string> = new Set([
	"rfc822",
	"global",
]);

export const isEncapsulatedMessage = (
	part: Pick<MessagePart, "mediaType" | "mediaSubtype">,
): boolean =>
	part.mediaType.toUpperCase() === "MESSAGE" &&
	ENCAPSULATED_MESSAGE_SUBTYPES.has(part.mediaSubtype.toLowerCase());

/** Whether `part` sits inside the forwarded message at `messagePath`. */
export const isWithinMessage = (
	part: Pick<MessagePart, "partPath">,
	messagePath: string,
): boolean => part.partPath.startsWith(`${messagePath}.`);

/** The forwarded messages a message carries itself, not those nested in them. */
export const outermostMessages = <T extends MessagePart>(
	parts: readonly T[],
): T[] =>
	parts.filter(
		(part) =>
			isEncapsulatedMessage(part) &&
			!parts.some(
				(outer) =>
					isEncapsulatedMessage(outer) && isWithinMessage(part, outer.partPath),
			),
	);

/** The parts that belong to the message itself, not to a message it carries. */
export const ownParts = <T extends MessagePart>(parts: readonly T[]): T[] => {
	const messages = parts.filter(isEncapsulatedMessage);
	return parts.filter(
		(part) =>
			!messages.some((message) => isWithinMessage(part, message.partPath)),
	);
};

/** Every part of the forwarded message at `messagePath`, nested ones included. */
export const encapsulatedParts = <T extends MessagePart>(
	parts: readonly T[],
	messagePath: string,
): T[] => parts.filter((part) => isWithinMessage(part, messagePath));
