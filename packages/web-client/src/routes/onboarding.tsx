import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

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

	const handleComplete = useCallback(
		(_accountId: string) => {
			void navigate({ to: "/mail" });
		},
		[navigate],
	);

	return <OnboardingWizard skipWelcome={false} onComplete={handleComplete} />;
}
