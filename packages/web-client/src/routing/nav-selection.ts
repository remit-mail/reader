import { useLocation, useParams } from "@tanstack/react-router";
import { locationIsOnList } from "@/lib/mail-route";

/**
 * The nav entry the address selects, or `""` where none does.
 *
 *   - `/settings/*` → "settings"
 *   - `/mail/outbox`, `/mail/flagged`, `/mail/brief` → that list
 *   - `/mail/$mailboxId` → the mailbox id, which is what the sidebar keys on
 *
 * Read off the pathname rather than the matches: the router commits the new
 * location before it swaps them, so the entry the reader just tapped highlights
 * on the tap instead of when its list finishes loading.
 */
export function useSelectedNavId(): string {
	const { pathname } = useLocation();
	const mailbox = useParams({ from: "/mail/$mailboxId", shouldThrow: false });

	if (locationIsOnList(pathname, "/settings")) return "settings";
	if (locationIsOnList(pathname, "/mail/outbox")) return "outbox";
	if (locationIsOnList(pathname, "/mail/flagged")) return "flagged";
	if (locationIsOnList(pathname, "/mail/brief")) return "brief";
	return mailbox?.mailboxId ?? "";
}
