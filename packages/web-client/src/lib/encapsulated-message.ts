/**
 * A message/rfc822 part is a forwarded message carried whole. Its own parts
 * are stored under its path (`<partPath>.0` is its root), and they belong to
 * the forwarded message: the carrying message neither renders them as its body
 * nor lists them as its attachments.
 */
export interface NestablePart {
	partPath: string;
	mediaType: string;
	mediaSubtype: string;
}

const ENCAPSULATED_MESSAGE_SUBTYPES: ReadonlySet<string> = new Set([
	"RFC822",
	"GLOBAL",
]);

export const isEncapsulatedMessage = (part: NestablePart): boolean =>
	part.mediaType === "MESSAGE" &&
	ENCAPSULATED_MESSAGE_SUBTYPES.has(part.mediaSubtype.toUpperCase());

const isWithin = (
	part: NestablePart,
	message: Pick<NestablePart, "partPath">,
): boolean => part.partPath.startsWith(`${message.partPath}.`);

/** The parts that belong to the message itself, not to a message it carries. */
export const ownParts = <T extends NestablePart>(parts: readonly T[]): T[] => {
	const messages = parts.filter(isEncapsulatedMessage);
	return parts.filter(
		(part) => !messages.some((message) => isWithin(part, message)),
	);
};

/** Every part of the forwarded message `message`, nested ones included. */
export const encapsulatedParts = <T extends NestablePart>(
	parts: readonly T[],
	message: Pick<NestablePart, "partPath">,
): T[] => parts.filter((part) => isWithin(part, message));
