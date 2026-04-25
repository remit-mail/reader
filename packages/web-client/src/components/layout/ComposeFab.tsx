import { useLocation } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { startTransition } from "react";
import { useCompose } from "@/components/compose/ComposeProvider";

/**
 * Floating Action Button for composing a new message. Mobile-only.
 *
 * Layout follows Material 3: 56×56 surface, 16px from the right edge,
 * sits above the bottom nav (which is 56px tall + safe-area). Hidden
 * when any of:
 *   - Viewport is `≥ md` (desktop has compose in the sidebar / etc.).
 *   - The compose surface is already open.
 *   - The user is reading a thread (`?selectedMessageId=…`) — the
 *     conversation's Reply/Forward action bar covers that workflow.
 *   - The user is not on a `/mail/<id>` route. The compose surface is
 *     rendered by `routes/mail/$mailboxId.tsx`'s detail pane, so it
 *     only has somewhere to mount once a mailbox is selected.
 */
export const ComposeFab = () => {
	const { state, openCompose } = useCompose();
	const location = useLocation();

	// Match `/mail/<mailboxId>` (with optional trailing path / search) but NOT
	// `/mail` exactly or `/mail/outbox`.
	const onMailboxRoute = /^\/mail\/(?!outbox)[^/?]+/.test(location.pathname);
	const search = location.search as Record<string, unknown> | undefined;
	const isReadingThread =
		typeof search?.selectedMessageId === "string" &&
		search.selectedMessageId.length > 0;

	if (!onMailboxRoute || state.isOpen || isReadingThread) return null;

	return (
		<button
			type="button"
			onClick={() => {
				// Wrap in startTransition so the suspension that ComposeForm
				// triggers on first mount (lazy chunks, queries) doesn't
				// snap the surrounding chrome into a route-level fallback.
				startTransition(() => {
					openCompose({ mode: "new" });
				});
			}}
			aria-label="Compose new message"
			className="md:hidden fixed right-4 z-30 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:opacity-90 active:scale-95 transition-all"
			style={{
				// Sit just above the BottomNav (h-14 = 56px) plus its safe-area
				// padding, with a 16px breathing room.
				bottom: "calc(3.5rem + env(safe-area-inset-bottom, 0) + 1rem)",
			}}
		>
			<Pencil className="size-6" />
		</button>
	);
};
