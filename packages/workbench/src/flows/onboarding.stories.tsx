import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
	StepAddress,
	StepConnector,
	StepCredentials,
	StepMicrosoftEmail,
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

// Phone width called out in the parity audit (#780): the Servers grid must not
// clip the Security select here.
const phone390 = {
	viewport: {
		options: {
			phone390: {
				name: "Phone 390",
				styles: { width: "390px", height: "844px" },
			},
		},
		defaultViewport: "phone390",
	},
};

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
		<StepWelcome key="welcome" onNext={() => setIndex(1)} />,
		<StepConnector key="connector" onBack={back} onNext={() => setIndex(2)} />,
		<StepAddress key="address" onBack={back} onNext={() => setIndex(3)} />,
		<StepServers key="servers" onBack={back} onNext={() => setIndex(4)} />,
		<StepCredentials
			key="credentials"
			onBack={back}
			onNext={() => setIndex(5)}
		/>,
		<StepTest key="test" onBack={back} onNext={() => setIndex(6)} />,
		<StepSync key="sync" onNext={restart} />,
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

/** Connector picker: IMAP selected, Microsoft selectable, Gmail "soon". */
export const ConnectorPicker: Story = {
	render: () => <StepConnector />,
};

/** Microsoft tile selected: CTA flips to "Continue with Microsoft". */
export const ConnectorPickerMicrosoft: Story = {
	render: () => <StepConnector selected="microsoft" />,
};

/**
 * Connector picker at phone width — CTA bar (Back / Continue) must be fully
 * visible without scrolling (#849).
 */
export const ConnectorPickerPhone: Story = {
	parameters: phone390,
	render: () => <StepConnector />,
};

/**
 * Microsoft tile selected at phone width — CTA bar must stay reachable (#849).
 */
export const ConnectorPickerMicrosoftPhone: Story = {
	parameters: phone390,
	render: () => <StepConnector selected="microsoft" />,
};

/** Microsoft sign-in sub-step: optional email prefill, then redirect. */
export const MicrosoftEmail: Story = {
	render: () => <StepMicrosoftEmail />,
};

/** Email address entry with the inline autodiscovery lookup running. */
export const AddressAutodiscovery: Story = {
	render: () => <StepAddress discovering />,
};

/** Address validation error on Continue with a malformed address. */
export const AddressInvalid: Story = {
	render: () => <StepAddress error="Enter a valid email address." />,
};

/**
 * Autodiscovered servers, prefilled and editable ("detected" badges). The
 * Provider dropdown sits on top, defaulting to "Custom / other".
 */
export const ServerConfirm: Story = {
	render: () => <StepServers detected />,
};

/** Same Servers step at phone width — Security select must stay reachable. */
export const ServerConfirmPhone: Story = {
	parameters: phone390,
	render: () => <StepServers detected />,
};

/**
 * Autodiscovery missed — heuristic fallback pre-fills both hosts (no "detected"
 * badge), with the Provider dropdown on "Custom / other".
 */
export const ServerManualFallback: Story = {
	render: () => <StepServers detected={false} />,
};

/** Servers validation error: Continue with a blank host. */
export const ServerMissingHost: Story = {
	render: () => (
		<StepServers detected={false} error="Enter both the IMAP and SMTP host." />
	),
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
	render: () => <StepTest mode="auth-failure" />,
};

/** Network failure: footer routes "Back to servers", no app-password hint. */
export const TestConnectionNetworkFailure: Story = {
	render: () => <StepTest mode="network-failure" />,
};

/** Initial sync with live counts; "Go to inbox" enabled mid-sync. */
export const SyncProgress: Story = {
	render: () => <StepSync />,
};

/** Account creation failed: "Couldn't create account" + raw error + Retry. */
export const SyncCreateError: Story = {
	render: () => <StepSync mode="create-error" />,
};

/** Sync stalled after creation: retry link + the account's last error. */
export const SyncStalled: Story = {
	render: () => <StepSync mode="stalled" />,
};
