/**
 * Whether a list is narrowed, and by what — one derived fact for every list.
 *
 * `MessageListEmpty` reads the presence of a `MessageListFilter` as "something
 * is filtering this list". Both list panes used to build that object from the
 * category chip alone, so a reader who had narrowed by the Unread chip, the Has
 * attachment chip, or a typed `is:unread` was told the collection itself was
 * empty — "No messages in Starred" over a mailbox full of starred mail (#1126).
 *
 * Every narrowing the two panes offer therefore lands here: the chips the view
 * holds and the tokens parsed out of the search field. A chip beats a token
 * where both set the same parameter, exactly as the request builders resolve
 * them, so the sentence and the query can never disagree.
 */

import type { FilterReach, MessageListFilter } from "@remit/ui";
import { categoryLabel, type InboxFilterCriteria } from "./inbox-filters.js";
import type { SearchToken } from "./search-tokens.js";

/**
 * One narrowing, as words. `pre` qualifies "mail" before it ("unread mail"),
 * `post` after it ("mail with an attachment"). `dimension` is what it narrows
 * by, so two sources naming the same thing are said once.
 */
interface NarrowingPart {
	dimension: string;
	position: "pre" | "post";
	text: string;
}

const UNREAD: NarrowingPart = {
	dimension: "read",
	position: "pre",
	text: "unread",
};
const READ: NarrowingPart = {
	dimension: "read",
	position: "pre",
	text: "read",
};
const STARRED: NarrowingPart = {
	dimension: "starred",
	position: "pre",
	text: "starred",
};
const ATTACHMENT: NarrowingPart = {
	dimension: "attachment",
	position: "post",
	text: "with an attachment",
};

/** The attribute chips, in the order the phrase says them. */
const ATTRIBUTE_PARTS: readonly (readonly [string, NarrowingPart])[] = [
	["unread", UNREAD],
	["flagged", STARRED],
	["attachment", ATTACHMENT],
];

const tokenPart = (token: SearchToken): NarrowingPart => {
	switch (token.type) {
		case "category":
			return {
				dimension: "category",
				position: "pre",
				text: categoryLabel(token.category) ?? token.value,
			};
		case "isUnread":
			return UNREAD;
		case "isRead":
			return READ;
		case "isStarred":
			return STARRED;
		case "hasAttachment":
			return ATTACHMENT;
		case "from":
			return {
				dimension: token.raw,
				position: "post",
				text: `from ${token.value}`,
			};
		case "subject":
			return {
				dimension: token.raw,
				position: "post",
				text: `about “${token.value}”`,
			};
		case "before":
			return {
				dimension: token.raw,
				position: "post",
				text: `sent before ${token.value}`,
			};
		case "after":
			return {
				dimension: token.raw,
				position: "post",
				text: `sent on or after ${token.value}`,
			};
		case "in":
			return {
				dimension: token.raw,
				position: "post",
				text: `in ${token.value}`,
			};
		case "account":
			return {
				dimension: token.raw,
				position: "post",
				text: `in the ${token.value} account`,
			};
	}
};

/** Everything narrowing the list, chips first, each dimension said once. */
const narrowingParts = (
	chips: InboxFilterCriteria,
	tokens: readonly SearchToken[],
): NarrowingPart[] => {
	const byDimension = new Map<string, NarrowingPart>();
	const add = (part: NarrowingPart) => {
		if (byDimension.has(part.dimension)) return;
		byDimension.set(part.dimension, part);
	};

	const category = categoryLabel(chips.category);
	if (category) add({ dimension: "category", position: "pre", text: category });
	for (const [id, part] of ATTRIBUTE_PARTS) {
		if (chips.attributes.has(id)) add(part);
	}
	for (const token of tokens) add(tokenPart(token));

	return [...byDimension.values()];
};

/**
 * The narrowing as the noun phrase the empty state's headline reads "No " in
 * front of, or `undefined` when nothing narrows the list.
 */
export const narrowingLabel = (
	chips: InboxFilterCriteria,
	tokens: readonly SearchToken[],
): string | undefined => {
	const parts = narrowingParts(chips, tokens);
	if (parts.length === 0) return undefined;
	const said = (position: "pre" | "post") =>
		parts.filter((part) => part.position === position).map((p) => p.text);
	return [...said("pre"), "mail", ...said("post")].join(" ");
};

export interface ListNarrowing {
	/** The chip state the view holds. */
	chips: InboxFilterCriteria;
	/** Every token the search field carries, sent as a parameter or not. */
	tokens: readonly SearchToken[];
	/** How much of the collection the request reached, read off the request. */
	reach: FilterReach;
	/** Drops every narrowing the label names — the chips and the query alike. */
	onClear: () => void;
}

/** The filter a narrowed list hands its empty state, or `undefined` when it is
 *  not narrowed at all. */
export const listNarrowing = ({
	chips,
	tokens,
	reach,
	onClear,
}: ListNarrowing): MessageListFilter | undefined => {
	const label = narrowingLabel(chips, tokens);
	if (!label) return undefined;
	return { label, reach, onClear };
};
