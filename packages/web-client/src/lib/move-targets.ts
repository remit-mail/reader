import type {
	RemitImapMailboxResponse,
	RemitImapMailboxSpecialUse,
} from "@remit/api-http-client/types.gen.ts";
import { MailboxSpecialUse } from "@remit/domain-enums";
import {
	filterDuplicateSpecialUse,
	getMailboxDisplayName,
	getMailboxPriority,
} from "./mailbox-order.js";

// Mailboxes whose semantic role makes them invalid manual move destinations.
// Drafts/Outbox/Sent are managed by compose/SMTP flows — moving an arbitrary
// message into them would break the invariant that those folders only hold
// messages the user authored. Per issue #236 + locked decisions, Trash and
// Spam stay valid manual destinations.
//
// The runtime `MailboxSpecialUse.*` enum stores values without the RFC 6154
// leading backslash (`"Sent"`, not `"\Sent"`) — see the comment on
// `SPECIAL_USE_PRIORITY` in `mailbox-order.ts`. The OpenAPI client types
// claim the backslashed form, so we accept both shapes defensively rather
// than trusting the wire format never drifts.
const normalizeSpecialUseFlag = (
	flag: RemitImapMailboxSpecialUse,
): RemitImapMailboxSpecialUse =>
	(flag.startsWith("\\") ? flag.slice(1) : flag) as RemitImapMailboxSpecialUse;

const normalizeMailboxSpecialUse = (
	mailbox: RemitImapMailboxResponse,
): RemitImapMailboxResponse => {
	if (!mailbox.specialUse || mailbox.specialUse.length === 0) return mailbox;
	const normalized = mailbox.specialUse.map(normalizeSpecialUseFlag);
	if (normalized.every((flag, i) => flag === mailbox.specialUse?.[i])) {
		return mailbox;
	}
	return { ...mailbox, specialUse: normalized };
};

const EXCLUDED_SPECIAL_USE: ReadonlySet<string> = new Set([
	normalizeSpecialUseFlag(
		MailboxSpecialUse.Drafts as RemitImapMailboxSpecialUse,
	),
	normalizeSpecialUseFlag(MailboxSpecialUse.Sent as RemitImapMailboxSpecialUse),
]);

// Outbox has no IMAP special-use flag (RFC 6154 doesn't define one), so we
// fall back to a hand-curated list of localized names. KISS: covers the
// languages we expect to encounter; extend as needed. Stored lowercased and
// trimmed; comparisons normalize the input the same way.
const OUTBOX_LOCALE_NAMES: ReadonlySet<string> = new Set([
	"outbox",
	"postvak uit",
	"boîte d'envoi",
	"postausgang",
	"buzón de salida",
	"posta in uscita",
	"送信トレイ",
	"送件匣",
	"发件箱",
	"skrzynka nadawcza",
]);

const EXCLUDED_NAME_ALIASES: ReadonlySet<string> = new Set([
	"drafts",
	"draft",
	"sent",
	"sent mail",
	"sent items",
	"sent messages",
]);

const normalizeLeafName = (fullPath: string): string =>
	getMailboxDisplayName(fullPath).trim().toLowerCase();

const isExcludedDestination = (mailbox: RemitImapMailboxResponse): boolean => {
	if (mailbox.specialUse) {
		for (const flag of mailbox.specialUse) {
			if (EXCLUDED_SPECIAL_USE.has(flag)) return true;
		}
	}
	const leaf = normalizeLeafName(mailbox.fullPath);
	if (EXCLUDED_NAME_ALIASES.has(leaf)) return true;
	return OUTBOX_LOCALE_NAMES.has(leaf);
};

/**
 * Filter and order a flat mailbox list for the Move-to picker.
 *
 * Drops Drafts/Outbox/Sent (per issue #236), de-duplicates aliased
 * special-use folders (e.g. `[Gmail]/Sent Mail` paired with `Sent`), and
 * sorts by the existing system→labels priority used by the sidebar so the
 * picker order matches what the user already sees on the left.
 *
 * Special-use values are normalized to bare names (RFC 6154 leading
 * backslash stripped) at the boundary so every downstream call —
 * exclusion, dedup, priority sort — sees the same shape regardless of
 * what the wire format happens to send.
 */
export const buildMoveTargets = (
	mailboxes: readonly RemitImapMailboxResponse[],
): RemitImapMailboxResponse[] => {
	const normalized = mailboxes.map(normalizeMailboxSpecialUse);
	const filtered = filterDuplicateSpecialUse(normalized).filter(
		(mailbox) => !isExcludedDestination(mailbox),
	);
	return filtered.sort((a, b) => {
		const aPriority = getMailboxPriority(a.fullPath, a.specialUse);
		const bPriority = getMailboxPriority(b.fullPath, b.specialUse);
		if (aPriority !== bPriority) return aPriority - bPriority;
		return getMailboxDisplayName(a.fullPath).localeCompare(
			getMailboxDisplayName(b.fullPath),
			undefined,
			{ sensitivity: "base", numeric: true },
		);
	});
};
