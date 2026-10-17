const ENCAPSULATED_MESSAGE_SUBTYPES: ReadonlySet<string> = new Set([
	"rfc822",
	"global",
]);

/** A message/rfc822 (or message/global) part: a forwarded message carried whole. */
export const isEncapsulatedMessage = (part: {
	mediaType: string;
	mediaSubtype: string;
}): boolean =>
	part.mediaType === "MESSAGE" &&
	ENCAPSULATED_MESSAGE_SUBTYPES.has(part.mediaSubtype.toLowerCase());
