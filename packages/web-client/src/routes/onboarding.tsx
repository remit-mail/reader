import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback } from "react";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { completeOnboarding } from "@/lib/onboarding-completion";
import { useTelemetry } from "@/lib/telemetry-context";

/**
 * /onboarding — full-screen wizard for first-run users (zero accounts).
 *
 * Redirected to automatically by the /mail route when config.accounts is empty.
 * After completing the wizard the user is sent to /mail (inbox).
 */
export const Route = createFileRoute("/onboarding")({
	component: OnboardingPage,
});

function OnboardingPage() {
	const telemetry = useTelemetry();
	const queryClient = useQueryClient();

	// A client-side navigation carries the query cache with it, and the /mail
	// first-run guard reads config from that cache — a stale zero-account entry
	// bounces the user straight back into the wizard. A document load starts
	// from an empty cache, so the guard sees the account that was just created.
	const handleComplete = useCallback(
		(_accountId: string) => {
			void completeOnboarding({
				queryClient,
				recordCompleted: () => telemetry.recordEvent("onboarding.completed"),
				navigateToInbox: () => {
					window.location.assign("/mail");
				},
			});
		},
		[telemetry, queryClient],
	);

	return <OnboardingWizard skipWelcome={false} onComplete={handleComplete} />;
}
