import {
	useLocation,
	useNavigate,
	useParams,
	useRouterState,
} from "@tanstack/react-router";
import { useCallback } from "react";
import {
	type BrowsedList,
	locationOpensDetail,
	mailListRoute,
} from "@/lib/mail-route";
import { useRetainOpenPanels } from "./fragment";

export type { BrowsedList };

/**
 * The list the address is browsing, as the two values a navigation to it needs.
 *
 * Every surface a list can open — compose, a reply, a conversation — reads the
 * same answer, so the four lists cannot disagree about which one is underneath.
 */
export function useBrowsedList(): BrowsedList {
	const list = useRouterState({
		select: (state) => mailListRoute(state.matches)?.list,
	});
	const mailbox = useParams({ from: "/mail/$mailboxId", shouldThrow: false });
	return { list, mailboxId: mailbox?.mailboxId };
}

/**
 * Whether the address names something the list has open below it — a
 * conversation, a draft, the compose surface.
 *
 * Answers off the pathname, which is what says where the reader is going while
 * the destination mounts; see `locationOpensDetail`.
 */
export function useOpensDetail(): boolean {
	const { pathname } = useLocation();
	return locationOpensDetail(pathname);
}

/**
 * Back up to the list, leaving whatever it had open.
 *
 * A push, like the open was: leaving is a move the reader makes, and Back is how
 * they undo it. Every branch lands somewhere real — the brief is the fallback,
 * because a list this cannot name still has to put them on one rather than
 * strand them inside a surface they just dismissed.
 */
export function useNavigateToBrowsedList(): () => void {
	const navigate = useNavigate();
	const retainPanels = useRetainOpenPanels();
	const { list, mailboxId } = useBrowsedList();

	return useCallback(() => {
		const search = (prev: Record<string, unknown>) => prev;
		const hash = retainPanels;
		if (list === "flagged") {
			navigate({ to: "/mail/flagged", search, hash });
			return;
		}
		if (list === "outbox") {
			navigate({ to: "/mail/outbox", search, hash });
			return;
		}
		if (list === "mailbox" && mailboxId) {
			navigate({ to: "/mail/$mailboxId", params: { mailboxId }, search, hash });
			return;
		}
		navigate({ to: "/mail/brief", search, hash });
	}, [navigate, retainPanels, list, mailboxId]);
}
