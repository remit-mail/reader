/**
 * The name a rule is offered under before the user writes their own (#477 4.10).
 * A suggestion and never a decision: the field it fills is editable and
 * clearable, and a rule with no name is held by `ruleBlockedCopy.unnamed`, not
 * by a guess.
 */

export interface RuleNameParts {
	/** What a property match is anchored on — the leading clause value. */
	match?: string;
	/** The sender carrying most of the selection, as it reads on screen. */
	sender?: string;
	/** The destination, once one has been chosen. */
	folder?: string;
}

export const suggestRuleName = ({
	match,
	sender,
	folder,
}: RuleNameParts): string => {
	const subject = match ?? sender;
	if (!subject) return folder ? `Mail to ${folder}` : "";
	if (folder) return `${subject} → ${folder}`;
	if (match) return `Mail matching ${match}`;
	return `Mail from ${subject}`;
};
