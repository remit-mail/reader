/**
 * What a recipient field is holding in its text input, read as addresses.
 *
 * A field takes one address at a time when it is typed, and a whole list when
 * one is pasted, so what is in it is a list either way. Anything in that list
 * that is not an address is kept rather than dropped: it is what the reader
 * typed, and losing it silently is how a message goes out to fewer people than
 * it was addressed to.
 */

export interface AddressEntry {
	email: string;
	displayName?: string;
}

export interface ParsedAddressInput {
	/** The addresses the text names, in the order it names them. */
	entries: AddressEntry[];
	/** The parts that are not addresses, rejoined. Empty when there are none. */
	unparsed: string;
}

const isValidEmail = (value: string): boolean =>
	/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const parseOne = (value: string): AddressEntry | undefined => {
	const trimmed = value.trim();
	if (!trimmed) return undefined;

	const angleMatch = trimmed.match(/^(.+?)\s*<([^>]+)>$/);
	if (angleMatch) {
		const displayName = angleMatch[1].trim().replace(/^"(.*)"$/, "$1");
		const email = angleMatch[2].trim();
		if (isValidEmail(email)) return { email, displayName };
	}

	if (isValidEmail(trimmed)) return { email: trimmed };
	return undefined;
};

/**
 * Split on the separators a mail client writes between addresses, ignoring the
 * ones inside a quoted display name or an angle-bracketed address — `"Hopper,
 * Grace" <grace@example.com>` is one address, not two.
 */
const splitAddresses = (value: string): string[] => {
	const parts: string[] = [];
	let current = "";
	let quoted = false;
	let angled = false;

	for (const char of value) {
		if (char === '"') quoted = !quoted;
		if (char === "<") angled = true;
		if (char === ">") angled = false;
		if ((char === "," || char === ";") && !quoted && !angled) {
			parts.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	parts.push(current);
	return parts;
};

export const parseAddressInput = (value: string): ParsedAddressInput => {
	const entries: AddressEntry[] = [];
	const leftovers: string[] = [];

	for (const part of splitAddresses(value)) {
		const entry = parseOne(part);
		if (entry) {
			entries.push(entry);
			continue;
		}
		if (part.trim()) leftovers.push(part.trim());
	}

	return { entries, unparsed: leftovers.join(", ") };
};
