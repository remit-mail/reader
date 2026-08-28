/**
 * /import — the configuration import wizard, full screen.
 *
 * One address for two entrances: the first-run welcome screen offers it beside
 * adding an account, and Settings › Advanced links to it. A path segment rather
 * than a query param because it mounts a different surface entirely
 * (url-state.md R1); the wizard's own step stays in component state, since the
 * file behind it cannot survive a reload.
 */
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";
import { ConfigImportWizard } from "@/components/config-import/ConfigImportWizard";
import { completeOnboarding } from "@/lib/onboarding-completion";
import { useTelemetry } from "@/lib/telemetry-context";

export const Route = createFileRoute("/import")({
	component: ConfigImportPage,
});

function ConfigImportPage() {
	const telemetry = useTelemetry();
	const queryClient = useQueryClient();

	// A client-side navigation carries the query cache with it, and the /mail
	// first-run guard reads the account list out of that cache — a stale
	// zero-account entry would bounce a freshly imported instance straight back
	// into onboarding. A document load starts from an empty cache.
	const handleDone = useCallback(() => {
		void completeOnboarding({
			queryClient,
			recordCompleted: () => telemetry.recordEvent("config.imported"),
			navigateToInbox: () => {
				window.location.assign("/mail");
			},
		});
	}, [telemetry, queryClient]);

	return <ConfigImportWizard onDone={handleDone} />;
}
