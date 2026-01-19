/**
 * Maps IMAP mailbox attributes to entity enum values
 */

import { MailboxAttribute, MailboxSpecialUse } from "@remit/domain-enums";

// Type for enum values
type MailboxAttributeValue =
	(typeof MailboxAttribute)[keyof typeof MailboxAttribute];
type MailboxSpecialUseValue =
	(typeof MailboxSpecialUse)[keyof typeof MailboxSpecialUse];

/**
 * Map from IMAP attribute strings to MailboxAttribute enum values
 * IMAP attributes have backslash prefix, our enum values don't
 */
const ATTRIBUTE_MAP: Record<string, MailboxAttributeValue> = {
	"\\NonExistent": MailboxAttribute.NonExistent,
	"\\Noinferiors": MailboxAttribute.NoInferiors,
	"\\Noselect": MailboxAttribute.NoSelect,
	"\\HasChildren": MailboxAttribute.HasChildren,
	"\\HasNoChildren": MailboxAttribute.HasNoChildren,
	"\\Marked": MailboxAttribute.Marked,
	"\\Unmarked": MailboxAttribute.Unmarked,
	"\\Subscribed": MailboxAttribute.Subscribed,
	"\\Remote": MailboxAttribute.Remote,
};

/**
 * Map from IMAP special-use attribute strings to MailboxSpecialUse enum values
 */
const SPECIAL_USE_MAP: Record<string, MailboxSpecialUseValue> = {
	"\\All": MailboxSpecialUse.All,
	"\\Archive": MailboxSpecialUse.Archive,
	"\\Drafts": MailboxSpecialUse.Drafts,
	"\\Flagged": MailboxSpecialUse.Flagged,
	"\\Junk": MailboxSpecialUse.Junk,
	"\\Sent": MailboxSpecialUse.Sent,
	"\\Trash": MailboxSpecialUse.Trash,
	"\\Important": MailboxSpecialUse.Important,
};

/**
 * Set of all known special-use attributes for quick lookup
 */
const SPECIAL_USE_ATTRS = new Set(Object.keys(SPECIAL_USE_MAP));

/**
 * Result of parsing IMAP attributes
 */
export interface ParsedAttributes {
	/** Standard mailbox attributes */
	attributes: MailboxAttributeValue[];
	/** Special-use designations */
	specialUse: MailboxSpecialUseValue[];
	/** Unknown attributes that couldn't be mapped */
	unknown: string[];
}

/**
 * Parse IMAP mailbox attributes into our enum types
 *
 * IMAP attributes come as strings like "\\Noselect", "\\Drafts", etc.
 * This function categorizes them into:
 * - Standard attributes (MailboxAttribute)
 * - Special-use attributes (MailboxSpecialUse)
 * - Unknown attributes
 */
export const parseImapAttributes = (attribs: string[]): ParsedAttributes => {
	const result: ParsedAttributes = {
		attributes: [],
		specialUse: [],
		unknown: [],
	};

	for (const attr of attribs) {
		// Normalize attribute (IMAP attributes are case-insensitive)
		const normalized = normalizeAttribute(attr);

		if (SPECIAL_USE_ATTRS.has(normalized)) {
			const specialUse = SPECIAL_USE_MAP[normalized];
			if (specialUse) {
				result.specialUse.push(specialUse);
			}
		} else if (ATTRIBUTE_MAP[normalized]) {
			result.attributes.push(ATTRIBUTE_MAP[normalized]);
		} else {
			result.unknown.push(attr);
		}
	}

	return result;
};

/**
 * Normalize an IMAP attribute to canonical form
 *
 * IMAP attributes are case-insensitive per RFC 9051.
 * We normalize to the canonical form used in the RFCs.
 */
const normalizeAttribute = (attr: string): string => {
	// Handle common variations
	const lower = attr.toLowerCase();

	// Map common case variations to canonical form
	const canonicalMap: Record<string, string> = {
		"\\nonexistent": "\\NonExistent",
		"\\noinferiors": "\\Noinferiors",
		"\\noselect": "\\Noselect",
		"\\haschildren": "\\HasChildren",
		"\\hasnochildren": "\\HasNoChildren",
		"\\marked": "\\Marked",
		"\\unmarked": "\\Unmarked",
		"\\subscribed": "\\Subscribed",
		"\\remote": "\\Remote",
		"\\all": "\\All",
		"\\archive": "\\Archive",
		"\\drafts": "\\Drafts",
		"\\flagged": "\\Flagged",
		"\\junk": "\\Junk",
		"\\sent": "\\Sent",
		"\\trash": "\\Trash",
		"\\important": "\\Important",
	};

	return canonicalMap[lower] ?? attr;
};

/**
 * Check if an attribute indicates the mailbox cannot be selected
 */
export const isNoSelect = (attribs: string[]): boolean => {
	return attribs.some((attr) => {
		const normalized = normalizeAttribute(attr);
		return normalized === "\\Noselect" || normalized === "\\NonExistent";
	});
};

/**
 * Check if an attribute indicates the mailbox has children
 */
export const hasChildren = (attribs: string[]): boolean => {
	return attribs.some((attr) => {
		const normalized = normalizeAttribute(attr);
		return normalized === "\\HasChildren";
	});
};
