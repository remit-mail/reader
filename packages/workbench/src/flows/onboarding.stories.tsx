import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
	StepAddress,
	StepConnector,
	StepCredentials,
	StepServers,
	StepSync,
	StepTest,
	StepWelcome,
} from "./onboarding.js";

const meta: Meta = {
	title: "Flows/Onboarding",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/**
 * Click-through walkthrough: drives the real step components by their own
 * footer buttons. Next/Back advance the shared step index; the final "Go to
 * inbox" loops back to the start so it isn't a dead end.
 */
function OnboardingWalkthrough() {
	const [index, setIndex] = useState(0);
	const back = () => setIndex((i) => Math.max(i - 1, 0));
	const restart = () => setIndex(0);

	const screens = [
		<StepWelcome onNext={() => setIndex(1)} />,
		<StepConnector onBack={back} onNext={() => setIndex(2)} />,
		<StepAddress onBack={back} onNext={() => setIndex(3)} />,
		<StepServers onBack={back} onNext={() => setIndex(4)} />,
		<StepCredentials onBack={back} onNext={() => setIndex(5)} />,
		<StepTest onBack={back} onNext={() => setIndex(6)} />,
		<StepSync onNext={restart} />,
	];

	return screens[index];
}

/** Full click-through: start at Welcome, Next/Back through every step. */
export const Walkthrough: Story = {
	render: () => <OnboardingWalkthrough />,
};

/** First-run welcome — no step rail yet. */
export const Welcome: Story = {
	render: () => <StepWelcome />,
};

/** Connector picker: IMAP available now, Gmail/Outlook OAuth tiles "soon". */
export const ConnectorPicker: Story = {
	render: () => <StepConnector />,
};

/** Email address entry with the inline autodiscovery lookup running. */
export const AddressAutodiscovery: Story = {
	render: () => <StepAddress discovering />,
};

/** Autodiscovered servers, prefilled and editable ("detected" badges). */
export const ServerConfirm: Story = {
	render: () => <StepServers detected />,
};

/** Autodiscovery missed — same step as manual fallback, empty fields. */
export const ServerManualFallback: Story = {
	render: () => <StepServers detected={false} />,
};

/**
 * Provider preset selected (iCloud): host/port pre-filled and locked, with a
 * note explaining the lock and an app-password hint under the form. Advanced
 * unlocks the fields for manual editing.
 */
export const ServerProviderPreset: Story = {
	render: () => <StepServers preset />,
};

/** Credentials with app-password guidance. */
export const Credentials: Story = {
	render: () => <StepCredentials />,
};

/** Both connection checks green. */
export const TestConnectionSuccess: Story = {
	render: () => <StepTest />,
};

/** SMTP auth failure: plain-language hint + the raw server error. */
export const TestConnectionFailure: Story = {
	render: () => <StepTest failed />,
};

/** Initial sync with live counts; "Go to inbox" enabled mid-sync. */
export const SyncProgress: Story = {
	render: () => <StepSync />,
};
