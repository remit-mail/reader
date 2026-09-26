import { ComposeFab as ComposeFabButton } from "@remit/ui";
import { useOpenCompose, useOpensDetail } from "@/routing";

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
	const opensDetail = useOpensDetail();

	if (opensDetail) return null;

	return <ComposeFabButton onCompose={compose} />;
};
