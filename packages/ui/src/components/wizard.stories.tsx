import type { Meta, StoryObj } from "@storybook/react";
import { AtSign, Inbox, Server } from "lucide-react";
import { useState } from "react";
import type { ServerSecurity } from "./security-select.js";
import { ConnectorTile, ServerFields } from "./wizard.js";

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
	parameters: {
		viewport: {
			options: {
				phone390: {
					name: "Phone 390",
					styles: { width: "390px", height: "844px" },
				},
			},
			defaultViewport: "phone390",
		},
	},
	render: () => <ServerFieldsDemo />,
};
