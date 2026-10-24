import { Check } from "lucide-react";
import type { McpPermission } from "./mcp-page.js";

export interface McpPermissionListProps {
	permissions: readonly McpPermission[];
}

export function McpPermissionList({ permissions }: McpPermissionListProps) {
	return (
		<ul className="flex flex-col gap-2 text-sm">
			{permissions.map((permission) => (
				<li key={permission.scope} className="flex items-start gap-2 text-fg">
					<Check
						className="mt-0.5 size-4 shrink-0 text-positive"
						aria-hidden="true"
					/>
					<span>{permission.description}</span>
				</li>
			))}
		</ul>
	);
}
