import { useLocation } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { locationOpensDetail } from "@/lib/mail-route";
import { useOpenCompose } from "@/routing";

/**
 * Floating Action Button for composing a new message. Mobile-only.
 *
 * Layout follows Material 3: 56×56 surface, 16px from the right and
 * bottom edges (plus the iOS safe-area inset). Hidden when either:
 *   - Viewport is `≥ lg` (1024px), where the top bar owns compose. The
 *     `/mail` shell also stops mounting the FAB above that width; the
 *     `lg:hidden` class covers the pre-hydration frame.
 *   - The single pane has something open — a conversation, or compose itself.
 *     Every list says so in its path.
 */
export const ComposeFab = () => {
	const compose = useOpenCompose();
	const location = useLocation();

	if (locationOpensDetail(location.pathname)) return null;

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
