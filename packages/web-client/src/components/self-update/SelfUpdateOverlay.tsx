/**
 * The full-window blocking screen an update takes over.
 *
 * Once consent is given the server is genuinely going away, so a quiet spinner
 * over a mailbox that cannot load would let a broken system look healthy. This
 * mounts at the app root and owns the window for the whole apply, and for the
 * "server never came back" verdict — from any route, so a reload mid-apply or a
 * second tab resumes straight into it.
 */
import {
	SelfUpdateProgressOverlay,
	SelfUpdateUnreachableScreen,
} from "@remit/ui";
import { useSelfUpdate } from "@/hooks/use-system-update";

export function SelfUpdateOverlay() {
	const { surface, onRetryConnection } = useSelfUpdate();

	if (surface.status !== "ready") return null;
	const { overlay } = surface;

	if (overlay.kind === "applying") {
		return (
			<SelfUpdateProgressOverlay
				target={overlay.target}
				phase={overlay.phase}
				elapsedSeconds={overlay.elapsedSeconds}
			/>
		);
	}

	if (overlay.kind === "neverCameBack") {
		return (
			<SelfUpdateUnreachableScreen
				attemptedVersion={overlay.attemptedVersion}
				previousVersion={overlay.previousVersion}
				elapsedSeconds={overlay.elapsedSeconds}
				logsCommand={overlay.logsCommand}
				onRetryConnection={onRetryConnection}
			/>
		);
	}

	return null;
}
