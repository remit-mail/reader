import { useLocation } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { useCallback } from "react";
import { useCompose } from "@/components/compose/ComposeProvider";

/**
 * Floating Action Button for composing a new message. Mobile-only.
 *
 * Layout follows Material 3: 56×56 surface, 16px from the right and
 * bottom edges (plus the iOS safe-area inset). Hidden when any of:
 *   - Viewport is `≥ lg` (1024px), where the top bar owns compose. The
 *     `/mail` shell also stops mounting the FAB above that width; the
 *     `lg:hidden` class covers the pre-hydration frame.
 *   - The compose surface is already open.
 *   - The user is reading a thread (`?selectedMessageId=…`) — the single
 *     pane is the conversation, and its reply bar is under this corner.
 *   - The user is off `/mail`, where compose has no target — the bare `/`
 *     route is sign-in.
 */
export const ComposeFab = () => {
	const { state, openCompose } = useCompose();
	const location = useLocation();
	const compose = useCallback(() => {
		openCompose({ mode: "new" });
	}, [openCompose]);

	const search = location.search as Record<string, unknown> | undefined;
	const isReadingThread = Boolean(search?.selectedMessageId);

	if (!location.pathname.startsWith("/mail") || state.isOpen || isReadingThread)
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
