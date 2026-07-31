/**
 * NavToggleButton — the top bar's control over the nav column.
 *
 * One button for both tiers: it collapses and restores the nav pane where the
 * nav is a column, and opens the slide-over where it is not. It sits in the top
 * bar's leading slot, over the column it acts on, which is why no pane header
 * carries a hamburger of its own at desktop widths.
 *
 * Renders nothing outside an `AppShellSlotted` — there is no nav to act on.
 */
import { Menu } from "lucide-react";
import { useAppShellLayout } from "./app-shell-slotted.js";
import { Button } from "./button.js";

export function NavToggleButton() {
	const layout = useAppShellLayout();
	if (!layout) return null;
	const shown = layout.showNavPane ? !layout.navCollapsed : false;
	return (
		<Button
			variant="ghost"
			size="sm"
			icon={<Menu className="size-4" />}
			onClick={layout.toggleNav}
			aria-label={shown ? "Hide folders" : "Show folders"}
			aria-expanded={shown}
			title="Folders"
			className="shrink-0"
		/>
	);
}
