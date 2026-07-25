/**
 * The self-update surface in Settings › Advanced — the only place that talks
 * about updates. Renders nothing when the surface is absent (no manifest URL, or
 * not signed in), so there is no entry point at all in that case.
 */
import { SelfUpdateConfirmDialog, SelfUpdateSection } from "@remit/ui";
import { useState } from "react";
import { useSelfUpdate } from "@/hooks/use-system-update";

export function SelfUpdatePanel() {
	const {
		surface,
		release,
		currentVersion,
		appliesSchemaMigration,
		onCheck,
		install,
		onDismissResult,
	} = useSelfUpdate();
	const [confirming, setConfirming] = useState(false);

	if (surface.status !== "ready") return null;

	return (
		<>
			<SelfUpdateSection
				state={surface.section}
				onCheck={onCheck}
				onInstall={() => setConfirming(true)}
				onDismissResult={onDismissResult}
			/>
			{release && currentVersion && (
				<SelfUpdateConfirmDialog
					open={confirming}
					currentVersion={currentVersion}
					release={release}
					appliesSchemaMigration={appliesSchemaMigration}
					onClose={() => setConfirming(false)}
					onConfirm={() => {
						setConfirming(false);
						install(release.version);
					}}
				/>
			)}
		</>
	);
}
