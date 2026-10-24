import { McpErrorNotice } from "./mcp-error-notice.js";
import { McpPage, type McpPageError } from "./mcp-page.js";

export interface McpErrorPageProps {
	heading: string;
	error: McpPageError;
}

export function McpErrorPage({ heading, error }: McpErrorPageProps) {
	return (
		<McpPage heading={heading}>
			<McpErrorNotice error={error} />
		</McpPage>
	);
}
