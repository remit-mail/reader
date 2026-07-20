import type { RemitImapAccountResponse } from "@remit/api-http-client/types.gen.ts";
import { useLocation } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { useCompose } from "@/components/compose/ComposeProvider";
import { useGlobalCompose } from "@/hooks/useComposeTarget";

/**
 * Primary mobile surfaces where the FAB belongs: anywhere under
 * `/mail` or under `/settings`. The bare `/` route (sign-in / OAuth
 * landing) is intentionally excluded — compose has no useful target
 * before the user has an account.
 */
const isOnPrimaryMobileRoute = (pathname: string): boolean =>
	pathname.startsWith("/mail") || pathname.startsWith("/settings");

interface ComposeFabProps {
	accounts: RemitImapAccountResponse[];
}

/**
 * Floating Action Button for composing a new message. Mobile-only.
 *
 * Layout follows Material 3: 56×56 surface, 16px from the right and
 * bottom edges (plus the iOS safe-area inset). Hidden when any of:
 *   - Viewport is `≥ lg` (1024px), where the top bar owns compose. The
 *     `/mail` shell also stops mounting the FAB above that width; the
 *     `lg:hidden` class covers the pre-hydration frame.
 *   - The compose surface is already open.
 *   - The user is reading a thread (`?selectedMessageId=…`) — the
 *     conversation's Reply/Forward action bar covers that workflow.
 *   - The user is not on a primary mobile route (`/mail` or
 *     `/settings`).
 *
 * The tap itself is `useGlobalCompose`, shared with the desktop top bar:
 * it opens compose in place on routes that mount `FullCompose` and
 * otherwise carries the user to a real mailbox that does. Compose state
 * survives that transition because `ComposeProvider` lives in
 * `__root.tsx`.
 */
export const ComposeFab = ({ accounts }: ComposeFabProps) => {
	const { state } = useCompose();
	const location = useLocation();
	const compose = useGlobalCompose(accounts);

	const search = location.search as Record<string, unknown> | undefined;
	const isReadingThread =
		typeof search?.selectedMessageId === "string" &&
		search.selectedMessageId.length > 0;

	if (
		!isOnPrimaryMobileRoute(location.pathname) ||
		state.isOpen ||
		isReadingThread
	)
		return null;

	return (
		<button
			type="button"
			onClick={compose}
			aria-label="Compose new message"
			className="lg:hidden fixed right-4 z-30 h-14 w-14 rounded-full bg-accent text-accent-fg shadow-lg flex items-center justify-center hover:opacity-90 active:scale-95 transition-all"
			style={{
				// 16px breathing room above the iOS home-indicator inset.
				bottom: "calc(env(safe-area-inset-bottom, 0) + 1rem)",
			}}
		>
			<Pencil className="size-6" />
		</button>
	);
};
