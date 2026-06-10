import type { Meta, StoryObj } from "@storybook/react-vite";
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
