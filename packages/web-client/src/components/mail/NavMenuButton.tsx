/**
 * NavMenuButton — the hamburger that opens the nav slide-over.
 *
 * The brief and inboxes get this from the shared `MailHeader`; the outbox and
 * drafts render their own pane headers, so they mount this to keep the mobile
 * nav reachable. It only appears when the nav is a slide-over (narrow widths);
 * where the nav is a persistent pane, there is nothing to open.
 */
import { Button, useAppShellLayout } from "@remit/ui";
import { Menu } from "lucide-react";

export function NavMenuButton() {
	const layout = useAppShellLayout();
	if (!layout || layout.showNavPane) return null;
	return (
		<Button
			variant="ghost"
			size="sm"
			icon={<Menu className="size-4" />}
			onClick={layout.openNav}
			aria-label="Open folders"
			className="-ml-1 shrink-0"
		/>
	);
}
