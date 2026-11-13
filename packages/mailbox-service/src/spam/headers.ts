import type { SpamRequest } from "@remit/data-ports";

type SpamHeader = SpamRequest["message"]["headers"][number];

export interface HeaderAddress {
	name: string;
	address: string;
	domain: string;
}

export const headerValue = (
	headers: readonly SpamHeader[],
	name: string,
): string | undefined =>
	headers.find((header) => header.name.toLowerCase() === name.toLowerCase())
		?.value;

const ADDRESS = /([^\s<>"@,;:]+@([a-z0-9.-]+\.[a-z0-9-]+))/i;

/** The first mailbox of an address header: display name, address and domain. */
export const parseAddressHeader = (
	value: string | undefined,
): HeaderAddress | undefined => {
	if (value === undefined) return undefined;
	const decoded = value.trim();
	const angle = /^(.*)<([^<>]+)>\s*$/s.exec(decoded);
	const raw = angle ? angle[2] : decoded;
	const match = ADDRESS.exec(raw);
	if (!match) return undefined;
	const name = angle
		? angle[1]
				.trim()
				.replace(/^"(.*)"$/s, "$1")
				.trim()
		: "";
	return {
		name,
		address: match[1].toLowerCase(),
		domain: match[2].toLowerCase(),
	};
};
