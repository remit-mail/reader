import { useParams, useRouterState } from "@tanstack/react-router";
import { type MailListRoute, mailListRoute } from "@/lib/mail-route";

export interface BrowsedList {
	list: MailListRoute["list"] | undefined;
	mailboxId: string | undefined;
}

/**
 * The list the address is browsing, as the two values a navigation to it needs.
 *
 * Both are primitives, so a caller holding them in a dependency array settles.
 * Every surface a list can open — compose, a reply — reads the same answer, so
 * the four lists cannot disagree about which one is underneath.
 */
export function useBrowsedList(): BrowsedList {
	const list = useRouterState({
		select: (state) => mailListRoute(state.matches)?.list,
	});
	const mailbox = useParams({ from: "/mail/$mailboxId", shouldThrow: false });
	return { list, mailboxId: mailbox?.mailboxId };
}
