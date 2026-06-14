import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
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

	const handleComplete = useCallback(
		(_accountId: string) => {
			telemetry.recordEvent("onboarding.completed");
			void navigate({ to: "/mail" });
		},
		[navigate, telemetry],
	);

	return <OnboardingWizard skipWelcome={false} onComplete={handleComplete} />;
}
