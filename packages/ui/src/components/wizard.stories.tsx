import type { Meta, StoryObj } from "@storybook/react";
import { AtSign, Inbox, Server } from "lucide-react";
import { useState } from "react";
import { Button } from "./button.js";
import type { ServerSecurity } from "./security-select.js";
import { ConnectorTile, ServerFields, WizardShell } from "./wizard.js";

const meta: Meta = {
	title: "Components/Wizard",
};
export default meta;

type Story = StoryObj;

function TileRow({ children }: { children: React.ReactNode }) {
	return (
		<div className="grid max-w-xl grid-cols-1 gap-3 p-6 sm:grid-cols-3">
			{children}
		</div>
	);
}

/** Selectable connectors: one active, one selected, one "soon". */
export const Connectors: Story = {
	render: () => {
		const [selected, setSelected] = useState("imap");
		return (
			<TileRow>
				<ConnectorTile
					name="IMAP / SMTP"
					description="Any mail provider — Fastmail, iCloud, your own server."
					icon={<Server className="size-5" />}
					selected={selected === "imap"}
					onSelect={() => setSelected("imap")}
				/>
				<ConnectorTile
					name="Outlook / Microsoft 365"
					description="Sign in with Microsoft. Works with Outlook.com and work accounts."
					icon={<Inbox className="size-5" />}
					selected={selected === "microsoft"}
					onSelect={() => setSelected("microsoft")}
				/>
				<ConnectorTile
					name="Gmail"
					description="Sign in with Google. No app passwords."
					icon={<AtSign className="size-5" />}
					comingSoon
				/>
			</TileRow>
		);
	},
};

/**
 * A "soon" tile is muted but never disabled: pressing it surfaces a one-line
 * explainer instead of going dead (never-disable tenet, #798).
 */
export const ComingSoonTilePressable: Story = {
	render: () => (
		<TileRow>
			<ConnectorTile
				name="Gmail"
				description="Sign in with Google. No app passwords."
				icon={<AtSign className="size-5" />}
				comingSoon
			/>
		</TileRow>
	),
};

function ServerFieldsDemo() {
	const [host, setHost] = useState("imap.fastmail.example");
	const [port, setPort] = useState("993");
	const [security, setSecurity] = useState<ServerSecurity>("tls");
	return (
		<div className="max-w-xl p-6">
			<ServerFields
				legend="IMAP — incoming"
				badge={{ label: "detected", tone: "positive" }}
				host={host}
				port={port}
				security={security}
				onHostChange={setHost}
				onPortChange={setPort}
				onSecurityChange={setSecurity}
				hostPlaceholder="imap.example.com"
				portPlaceholder="993"
			/>
		</div>
	);
}

/** Host / port / security for one protocol. */
export const ServerFieldsStory: Story = {
	name: "ServerFields",
	render: () => <ServerFieldsDemo />,
};

/** Phone width: the grid stacks so the Security select stays reachable (#780). */
export const ServerFieldsPhone: Story = {
	name: "ServerFields — phone",
	globals: { viewport: { value: "mobile" } },
	render: () => <ServerFieldsDemo />,
};

const longStepRows = Array.from(
	{ length: 60 },
	(_, index) => `Row ${index + 1} of a report nobody sized the box for`,
);

function LongStep() {
	return (
		<WizardShell
			steps={["File", "Review", "Credentials", "Folders"]}
			activeStep={1}
			title="What this file will change"
			subtitle="A step whose content runs well past the bottom of the screen."
			footer={
				<>
					<Button variant="ghost">Back</Button>
					<Button variant="primary">Continue</Button>
				</>
			}
		>
			<ul className="divide-y divide-line">
				{longStepRows.map((row) => (
					<li key={row} className="py-2 text-sm text-fg">
						{row}
					</li>
				))}
			</ul>
		</WizardShell>
	);
}

/**
 * A step taller than the viewport, on the 1512×827 laptop the config import
 * wizard was found unusable on (#1021). The rows scroll inside the card; the
 * title and the Continue button stay on screen.
 */
export const ShellLongStepShortViewport: Story = {
	name: "WizardShell — long step, short viewport",
	parameters: { layout: "fullscreen" },
	globals: { viewport: { value: "laptopShort" } },
	render: () => <LongStep />,
};

/** The same step on a phone with the address bar and system nav showing. */
export const ShellLongStepPhoneShort: Story = {
	name: "WizardShell — long step, short phone",
	parameters: { layout: "fullscreen" },
	globals: { viewport: { value: "mobileShort" } },
	render: () => <LongStep />,
};
