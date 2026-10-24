import { Button } from "./button.js";
import type { McpPermission } from "./mcp-page.js";
import { McpPage } from "./mcp-page.js";
import { McpPermissionList } from "./mcp-permission-list.js";

export interface McpConsentPageProps {
	clientName: string;
	permissions: readonly McpPermission[];
	oauthQuery: string;
}

export function McpConsentPage({
	clientName,
	permissions,
	oauthQuery,
}: McpConsentPageProps) {
	return (
		<McpPage
			heading={`Allow ${clientName} to use your mail?`}
			intro={`${clientName} asks to:`}
		>
			<McpPermissionList permissions={permissions} />
			<p className="text-xs text-fg-muted">
				You can disconnect it at any time from{" "}
				<a href="/apps" className="underline underline-offset-2">
					connected apps
				</a>
				.
			</p>
			<form method="post" className="flex gap-2">
				<input type="hidden" name="oauth_query" value={oauthQuery} />
				<Button
					type="submit"
					name="accept"
					value="false"
					variant="secondary"
					className="flex-1"
				>
					Deny
				</Button>
				<Button type="submit" name="accept" value="true" className="flex-1">
					Allow
				</Button>
			</form>
		</McpPage>
	);
}
