import { MailboxSpecialUse } from "@remit/domain-enums";

// At the API boundary the OpenAPI client types special-use values as
// `'\\Sent' | '\\Drafts' | ...` (literal RFC 6154 strings) while the runtime
// constant `MailboxSpecialUse.Sent` resolves to bare `"Sent"`. The two are
// equivalent at the wire level — the openapi-emitter quirk just produces a
// stricter TS type. Sidebar code accepts `readonly string[]` so callers can
// pass either shape without unsafe casts.
type SpecialUseFlags = readonly string[];

const SYSTEM_MAILBOX_ORDER: readonly string[][] = [
	["inbox"],
	["starred", "flagged"],
	["drafts", "draft"],
	["sent", "sent mail", "sent items", "sent messages"],
	["archive", "archives"],
	["all", "all mail"],
	["spam", "junk"],
	["trash", "bin", "deleted", "deleted items"],
];

export const NON_SYSTEM_PRIORITY = SYSTEM_MAILBOX_ORDER.length;

export const getMailboxDisplayName = (fullPath: string): string => {
	const parts = fullPath.split("/");
	return parts[parts.length - 1] || fullPath;
};

// Display order keyed by special-use flag. Used so a Dutch "Verzonden"
// mailbox (flag \Sent) sorts to the same slot as English "Sent". Indexed by
// the bare runtime values from `@remit/domain-enums` (e.g. "Sent"). Typed as
// `Record<string, ...>` so callers can pass the OpenAPI client's stricter
// `'\\Sent'` literal type without unsafe casts.
const SPECIAL_USE_PRIORITY: Record<string, number> = {
	[MailboxSpecialUse.Flagged]: 1,
	[MailboxSpecialUse.Drafts]: 2,
	[MailboxSpecialUse.Sent]: 3,
	[MailboxSpecialUse.Archive]: 4,
	[MailboxSpecialUse.All]: 5,
	[MailboxSpecialUse.Junk]: 6,
	[MailboxSpecialUse.Trash]: 7,
	[MailboxSpecialUse.Important]: NON_SYSTEM_PRIORITY,
};

export const getMailboxPriority = (
	fullPath: string,
	specialUse?: SpecialUseFlags,
): number => {
	if (specialUse && specialUse.length > 0) {
		let best = NON_SYSTEM_PRIORITY;
		for (const flag of specialUse) {
			const p = SPECIAL_USE_PRIORITY[flag];
			if (p !== undefined && p < best) best = p;
		}
		if (best < NON_SYSTEM_PRIORITY) return best;
	}
	if (fullPath.includes("/")) return NON_SYSTEM_PRIORITY;
	const name = getMailboxDisplayName(fullPath).toLowerCase();
	for (let i = 0; i < SYSTEM_MAILBOX_ORDER.length; i++) {
		if (SYSTEM_MAILBOX_ORDER[i].includes(name)) return i;
	}
	return NON_SYSTEM_PRIORITY;
};

export const isSystemMailbox = (
	fullPath: string,
	specialUse?: SpecialUseFlags,
): boolean => getMailboxPriority(fullPath, specialUse) < NON_SYSTEM_PRIORITY;

interface MailboxLike {
	mailboxId: string;
	fullPath: string;
	specialUse?: SpecialUseFlags;
}

// Local map (special-use → grouping key string). The values mirror the IMAP
// flag names so they stay readable in logs. Same `Record<string, ...>` reason
// as `SPECIAL_USE_PRIORITY` above.
const SPECIAL_USE_GROUP: Record<string, string> = {
	[MailboxSpecialUse.Sent]: "sent",
	[MailboxSpecialUse.Drafts]: "drafts",
	[MailboxSpecialUse.Trash]: "trash",
	[MailboxSpecialUse.Junk]: "junk",
	[MailboxSpecialUse.Archive]: "archive",
	[MailboxSpecialUse.All]: "all",
	[MailboxSpecialUse.Flagged]: "flagged",
	[MailboxSpecialUse.Important]: "important",
};

// English-name fallback. Used when no mailbox carries the IMAP SPECIAL-USE
// flag — typically older test servers or mailfuzz fixtures.
const SPECIAL_USE_ALIASES: Record<string, string> = {
	trash: "trash",
	bin: "trash",
	deleted: "trash",
	"deleted items": "trash",
	drafts: "drafts",
	draft: "drafts",
	sent: "sent",
	"sent mail": "sent",
	"sent items": "sent",
	"sent messages": "sent",
	junk: "junk",
	spam: "junk",
	archive: "archive",
	archives: "archive",
	all: "all",
	"all mail": "all",
};

// Canonical-name preference per special-use group. When multiple mailboxes
// share a group (e.g. Dovecot exposes both "Sent" and "Sent Messages"; Outlook
// in Dutch exposes "Sent", "Sent Messages", AND "Verzonden items"), pick the
// first match in this order. Mailboxes carrying the SPECIAL-USE IMAP flag
// always win over name-only matches.
const SPECIAL_USE_PREFERRED_NAMES: Record<string, string[]> = {
	sent: ["sent", "sent mail", "sent items", "sent messages"],
	drafts: ["drafts", "draft"],
	trash: ["trash", "bin", "deleted", "deleted items"],
	junk: ["junk", "spam"],
	archive: ["archive", "archives"],
	all: ["all mail", "all"],
};

const isBracketedNamespace = (fullPath: string): boolean =>
	/^\[[^\]]+\]\//.test(fullPath);

const pickCanonical = <T extends MailboxLike>(
	candidates: T[],
	group: string,
): T => {
	// 1. If any candidate has the IMAP SPECIAL-USE flag, prefer it. Server-side
	//    truth beats name guessing.
	const flagged = candidates.find((m) => mailboxHasGroup(m, group));
	if (flagged) return flagged;

	// 2. Else prefer a bracketed-namespace candidate (e.g. `[Gmail]/Sent Mail`)
	//    over a top-level English alias (issue #178). Gmail's `[Gmail]/Sent Mail`
	//    is the real folder; the top-level `Sent` is an auto-created proxy.
	const bracketed = candidates.find((m) => isBracketedNamespace(m.fullPath));
	if (bracketed) return bracketed;

	// 3. Else fall back to the canonical English name preference.
	const preferred = SPECIAL_USE_PREFERRED_NAMES[group] ?? [];
	for (const name of preferred) {
		const match = candidates.find(
			(m) => getMailboxDisplayName(m.fullPath).toLowerCase() === name,
		);
		if (match) return match;
	}
	return candidates[0];
};

const mailboxHasGroup = (m: MailboxLike, group: string): boolean => {
	if (!m.specialUse || m.specialUse.length === 0) return false;
	return m.specialUse.some((flag) => SPECIAL_USE_GROUP[flag] === group);
};

/**
 * Folder kind used by sidebar rendering decisions (e.g. whether to show an
 * unread badge). Returns "inbox" for the user's primary INBOX (drives
 * unread-badge rendering on the row, even though INBOX is not a SPECIAL-USE
 * flag), otherwise the special-use group string ("sent", "drafts", "trash",
 * "junk", "archive", "all", "flagged") or null for plain user folders.
 */
export const getMailboxKind = (
	fullPath: string,
	specialUse?: SpecialUseFlags,
): string | null => {
	if (specialUse && specialUse.length > 0) {
		for (const flag of specialUse) {
			const group = SPECIAL_USE_GROUP[flag];
			if (group) return group;
		}
	}
	const name = getMailboxDisplayName(fullPath).toLowerCase();
	if (name === "inbox") return "inbox";
	if (fullPath.includes("/")) return null;
	return SPECIAL_USE_ALIASES[name] ?? null;
};

/**
 * Render-ready label for a mailbox row. Localized via the supplied translator
 * for system folders (drives the i18n requirement in issue #194: an Outlook
 * NL account showing "Verzonden" instead of "Verzonden items"). User-defined
 * folders show their server-side leaf name verbatim — that's what users
 * named them.
 */
export const getMailboxDisplayLabel = (
	fullPath: string,
	specialUse: SpecialUseFlags | undefined,
	t?: (key: string, fallback: string) => string,
): string => {
	const kind = getMailboxKind(fullPath, specialUse);
	const fallback = getMailboxDisplayName(fullPath);
	if (!kind) return fallback;
	if (!t) return fallback;
	return t(`sidebar.${kind}`, fallback);
};

// Folder kinds where a user-action-oriented unread badge isn't useful: Sent
// items aren't "incoming things to read", neither are Drafts (the user
// authored them), neither is Trash (deleted). Per issue #195 these should
// not show a count badge at all.
const COUNTLESS_KINDS = new Set(["sent", "drafts", "trash"]);

export const shouldShowUnreadBadge = (
	fullPath: string,
	specialUse?: SpecialUseFlags,
): boolean => {
	const kind = getMailboxKind(fullPath, specialUse);
	if (kind === null) return true;
	return !COUNTLESS_KINDS.has(kind);
};

// True when this mailbox should participate in a special-use dedup group.
// Top-level English-aliased mailboxes always qualify (issue #178). Nested
// mailboxes only qualify if they carry an IMAP SPECIAL-USE flag — otherwise
// `Folders/Sent` (a user-label called "Sent" inside "Folders") would be
// treated as a Sent folder and clash with the real one.
const candidateGroup = <T extends MailboxLike>(m: T): string | null => {
	if (m.specialUse && m.specialUse.length > 0) {
		for (const flag of m.specialUse) {
			const group = SPECIAL_USE_GROUP[flag];
			if (group) return group;
		}
	}
	const name = getMailboxDisplayName(m.fullPath).toLowerCase();
	if (m.fullPath.includes("/")) {
		// Nested, no flag: only treat `[Gmail]/Sent Mail`-style auto-aliases
		// (those whose leaf name maps to a known special-use group) as
		// candidates — these are typically auto-created by the server alongside
		// a top-level synonym we want to drop.
		const aliasGroup = SPECIAL_USE_ALIASES[name];
		// Defensive: only consider the bracketed-namespace pattern. User
		// folders named after a system folder (e.g. `Personal/Sent`) are kept.
		if (aliasGroup && /^\[[^\]]+\]\//.test(m.fullPath)) {
			return aliasGroup;
		}
		return null;
	}
	return SPECIAL_USE_ALIASES[name] ?? null;
};

/**
 * Drop duplicate special-use mailboxes (issues #178, #194).
 *
 * Three duplicate flavours occur in the wild:
 *  - Prefixed (`[Gmail]/Sent Mail` alongside `Sent`): the prefixed entry is
 *    auto-created — drop it in favour of the top-level one (or vice versa
 *    when SPECIAL-USE flags steer things).
 *  - Top-level twins (`Sent` + `Sent Messages` on Dovecot fixtures): keep one,
 *    preferring the canonical English name.
 *  - Localized variants (Outlook NL: `Sent` + `Sent Messages` +
 *    `Verzonden items`, the last carrying `\Sent`): keep the flagged one only.
 *
 * Custom user folders without a SPECIAL-USE flag and without an English
 * system-name match pass through untouched. So Outlook's "Nieuwsbrieven"
 * (Newsletters) is preserved.
 */
export const filterDuplicateSpecialUse = <T extends MailboxLike>(
	mailboxes: T[],
): T[] => {
	const byGroup = new Map<string, T[]>();
	for (const mailbox of mailboxes) {
		const group = candidateGroup(mailbox);
		if (!group) continue;
		const list = byGroup.get(group) ?? [];
		list.push(mailbox);
		byGroup.set(group, list);
	}

	const keepIds = new Set<string>();
	for (const [group, candidates] of byGroup) {
		keepIds.add(pickCanonical(candidates, group).mailboxId);
	}

	return mailboxes.filter((mailbox) => {
		const group = candidateGroup(mailbox);
		if (!group) return true;
		return keepIds.has(mailbox.mailboxId);
	});
};
