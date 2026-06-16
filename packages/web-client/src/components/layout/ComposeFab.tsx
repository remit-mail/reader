import { useLocation, useNavigate } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { startTransition } from "react";
import { useCompose } from "@/components/compose/ComposeProvider";

/**
 * Returns true when `pathname` is `/mail/<id>` for any id other than
 * the reserved `outbox` segment. That route owns a `FullCompose` mount
 * point, so the FAB can open compose in-place. From every other route
 * the FAB has to send the user there first.
 */
const isOnMailboxRoute = (pathname: string): boolean =>
	/^\/mail\/(?!outbox)[^/?]+/.test(pathname);

/**
 * Primary mobile surfaces where the FAB belongs: anywhere under
 * `/mail` or under `/settings`. The bare `/` route (sign-in / OAuth
 * landing) is intentionally excluded — compose has no useful target
 * before the user has an account.
 */
const isOnPrimaryMobileRoute = (pathname: string): boolean =>
	pathname.startsWith("/mail") || pathname.startsWith("/settings");

/**
 * Floating Action Button for composing a new message. Mobile-only.
 *
 * Layout follows Material 3: 56×56 surface, 16px from the right and
 * bottom edges (plus the iOS safe-area inset). Hidden when any of:
 *   - Viewport is `≥ md` (desktop has compose in the sidebar / etc.).
 *   - The compose surface is already open.
 *   - The user is reading a thread (`?selectedMessageId=…`) — the
 *     conversation's Reply/Forward action bar covers that workflow.
 *   - The user is not on a primary mobile route (`/mail` or
 *     `/settings`).
 *
 * From routes that don't host a `FullCompose` (everything except
 * `/mail/<mailboxId>` — i.e. `/mail`, `/mail/outbox`, `/settings/*`)
 * tapping the FAB opens compose state and navigates to `/mail`, which
 * the index loader redirects to the preferred mailbox (PR #138). The
 * compose state survives the route transition because `ComposeProvider`
 * lives in `__root.tsx`, so the destination route mounts straight into
 * compose.
 */
export const ComposeFab = () => {
	const { state, openCompose } = useCompose();
	const location = useLocation();
	const navigate = useNavigate();

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

	const handleClick = () => {
		// Wrap in startTransition so the suspension that ComposeForm
		// triggers on first mount (lazy chunks, queries) doesn't
		// snap the surrounding chrome into a route-level fallback.
		startTransition(() => {
			openCompose({ mode: "new" });
		});
		if (isOnMailboxRoute(location.pathname)) return;
		navigate({ to: "/mail" });
	};

	return (
		<button
			type="button"
			onClick={handleClick}
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
