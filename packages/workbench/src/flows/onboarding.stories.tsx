import type { AccountService } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
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
 * The connector picker inside Settings → Accounts → "Add account". This is the
 * step that carries the escape hatch: the wizard starts here, so Back is Cancel
 * and every later step goes back to it.
 */
export const ConnectorPickerInSettings: Story = {
	render: () => (
		<div className="fixed inset-0 z-40 overflow-auto bg-canvas">
			<StepConnector host="settings" />
		</div>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("button", { name: "Cancel" })).toBeVisible();
	},
};

/**
 * Connector picker at phone width — CTA bar (Back / Continue) must be fully
 * visible without scrolling (#849).
 */
export const ConnectorPickerPhone: Story = {
	globals: { viewport: { value: "mobile" } },
	render: () => <StepConnector />,
};

/**
 * Microsoft tile selected at phone width — CTA bar must stay reachable (#849).
 */
export const ConnectorPickerMicrosoftPhone: Story = {
	globals: { viewport: { value: "mobile" } },
	render: () => <StepConnector selected="microsoft" />,
};

/**
 * Microsoft sign-in sub-step (#1178). The connector tile sits on top, the
 * service choice under it and the optional email prefill under that — the pick
 * is made before the redirect, so the consent screen asks for the scopes it
 * matches. Both services on is the default, and the copy under the rows says
 * adding a service later is another sign-in with Microsoft.
 */
export const MicrosoftEmail: Story = {
	render: () => <StepMicrosoftEmail />,
};

/**
 * Handing off to Microsoft is a redirect, so the story stands in for it: once
 * the step calls onNext the window is gone.
 */
function MicrosoftHandoff({
	initialServices,
	offered,
}: {
	initialServices?: AccountService[];
	offered?: AccountService[];
}) {
	const [handedOff, setHandedOff] = useState(false);
	if (handedOff) {
		return (
			<div data-testid="microsoft-redirect" className="p-6 text-sm text-fg">
				Redirecting to Microsoft…
			</div>
		);
	}
	return (
		<StepMicrosoftEmail
			initialServices={initialServices}
			offered={offered}
			onNext={() => setHandedOff(true)}
		/>
	);
}

/**
 * Neither service ticked. Continue stays live and says what is missing rather
 * than going dead, and it does not hand an empty set to the provider — the
 * account endpoints refuse one.
 */
export const MicrosoftNeitherServiceSelected: Story = {
	render: () => <MicrosoftHandoff initialServices={[]} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "Sign in with Microsoft" }),
		);
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			"Pick at least one",
		);
		await expect(canvas.queryByTestId("microsoft-redirect")).toBeNull();

		await userEvent.click(canvas.getByRole("checkbox", { name: /Calendar/ }));
		await userEvent.click(
			canvas.getByRole("button", { name: "Sign in with Microsoft" }),
		);
		await expect(canvas.getByTestId("microsoft-redirect")).toBeVisible();
	},
};

/**
 * A connector that carries mail alone — IMAP today. There is nothing to
 * choose, so no choice appears between the tile and the email field: absent,
 * not a disabled row.
 */
export const MicrosoftMailOnlyProvider: Story = {
	render: () => <StepMicrosoftEmail offered={["Mail"]} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.queryByText("What should Remit sync?")).toBeNull();
		await expect(canvas.queryAllByRole("checkbox")).toHaveLength(0);
	},
};

/**
 * A mail-only connector arriving with nothing picked. There are no rows to
 * show, so the refusal stands on its own — the button says what is wrong
 * instead of doing nothing.
 */
export const MicrosoftMailOnlyProviderRefused: Story = {
	render: () => <MicrosoftHandoff offered={["Mail"]} initialServices={[]} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: "Sign in with Microsoft" }),
		);
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			"Pick at least one",
		);
		await expect(canvas.queryByTestId("microsoft-redirect")).toBeNull();
	},
};

/**
 * The same step inside Settings → Accounts → "Add account", which mounts the
 * wizard in a full-screen overlay from the connector picker. Back still goes to
 * the connector, in both hosts — leaving is done on the picker.
 */
export const MicrosoftServiceChoiceInSettings: Story = {
	render: () => (
		<div className="fixed inset-0 z-40 overflow-auto bg-canvas">
			<StepMicrosoftEmail />
		</div>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("button", { name: "Back" })).toBeVisible();
	},
};

/** Phone width — the tile, the choice and the CTA bar share one 411 px column. */
export const MicrosoftServiceChoicePhone: Story = {
	globals: { viewport: { value: "mobile" } },
	render: () => <StepMicrosoftEmail />,
};

/**
 * The redirect never took the window: the button is live again and says what
 * failed, rather than reading "Redirecting…" until a reload (#964).
 */
export const MicrosoftRedirectStalled: Story = {
	render: () => (
		<StepMicrosoftEmail error="Couldn't open Microsoft's sign-in page. Check your connection, and anything blocking redirects, then try again." />
	),
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
	globals: { viewport: { value: "mobile" } },
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

/** Initial sync with live counts; "Go to inbox" enabled once mail has landed. */
export const SyncProgress: Story = {
	render: () => <StepSync />,
};

/**
 * The seconds before the first messages land. There is no inbox to go to yet,
 * so the CTA waits instead of handing the user an empty list (#452). It opens
 * on its own once mail arrives, or after a short wait if nothing does.
 */
export const SyncWaitingForFirstMail: Story = {
	render: () => <StepSync mode="waiting" />,
};

/** Phone width — the gated CTA and its hint share a 411 px footer row. */
export const SyncWaitingForFirstMailPhone: Story = {
	globals: { viewport: { value: "mobile" } },
	render: () => <StepSync mode="waiting" />,
};

/** Account creation failed: "Couldn't create account" + raw error + Retry. */
export const SyncCreateError: Story = {
	render: () => <StepSync mode="create-error" />,
};

/** Sync stalled after creation: retry link + the account's last error. */
export const SyncStalled: Story = {
	render: () => <StepSync mode="stalled" />,
};
