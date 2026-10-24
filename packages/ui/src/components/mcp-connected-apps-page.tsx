import { Unplug } from "lucide-react";
import { Banner } from "./banner.js";
import { Button } from "./button.js";
import { McpErrorNotice } from "./mcp-error-notice.js";
import { McpPage, type McpPageError, type McpPermission } from "./mcp-page.js";
import { McpPermissionList } from "./mcp-permission-list.js";

export interface McpConnectedApp {
	clientId: string;
	name: string;
	permissions: readonly McpPermission[];
	connectedOn: string;
}

export interface McpConnectedAppsPageProps {
	apps: readonly McpConnectedApp[];
	disconnected?: string;
	error?: McpPageError;
}

function AppRow({ app }: { app: McpConnectedApp }) {
	return (
		<li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="truncate font-medium text-fg">{app.name}</p>
					<p className="text-xs text-fg-muted">
						Connected on {app.connectedOn}
					</p>
				</div>
				<form method="post">
					<input type="hidden" name="client_id" value={app.clientId} />
					<Button
						type="submit"
						variant="danger"
						size="sm"
						icon={<Unplug className="size-3.5" aria-hidden="true" />}
						aria-label={`Disconnect ${app.name}`}
					>
						Disconnect
					</Button>
				</form>
			</div>
			<McpPermissionList permissions={app.permissions} />
		</li>
	);
}

export function McpConnectedAppsPage({
	apps,
	disconnected,
	error,
}: McpConnectedAppsPageProps) {
	return (
		<McpPage
			heading="Connected apps"
			intro="These apps can use your mail. Disconnecting one signs it out at once."
		>
			{error && <McpErrorNotice error={error} />}
			{disconnected && (
				<Banner tone="success" variant="soft">
					Disconnected {disconnected}. It can no longer use your mail.
				</Banner>
			)}
			{apps.length === 0 ? (
				<p className="text-sm text-fg-muted">
					No apps are connected. Add remit as a connector in Claude to connect
					one.
				</p>
			) : (
				<ul className="flex flex-col divide-y divide-line">
					{apps.map((app) => (
						<AppRow key={app.clientId} app={app} />
					))}
				</ul>
			)}
		</McpPage>
	);
}
