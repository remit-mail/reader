/**
 * The Advanced nav icon, with the update dot.
 *
 * A dot on the way to settings is the entire notification budget an available
 * update gets outside the pane — no count, no copy, no action. Everywhere else
 * stays silent.
 */
import { AttentionDot } from "@remit/ui";
import { Wrench } from "lucide-react";
import { useOptionalSelfUpdate } from "@/hooks/use-system-update";

export function AdvancedNavIcon() {
	const selfUpdate = useOptionalSelfUpdate();
	const updateAvailable =
		selfUpdate?.surface.status === "ready" &&
		selfUpdate.surface.section.status === "available";

	return (
		<AttentionDot label={updateAvailable ? "Update available" : undefined}>
			<Wrench className="size-4" />
		</AttentionDot>
	);
}
