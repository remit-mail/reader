import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
	const navigate = useNavigate();
	const telemetry = useTelemetry();
	const queryClient = useQueryClient();

	const handleComplete = useCallback(
		(_accountId: string) => {
			void completeOnboarding({
				queryClient,
				recordCompleted: () => telemetry.recordEvent("onboarding.completed"),
				navigateToInbox: () => void navigate({ to: "/mail" }),
			});
		},
		[navigate, telemetry, queryClient],
	);

	return <OnboardingWizard skipWelcome={false} onComplete={handleComplete} />;
}
