import { Banner } from "./banner.js";
import type { McpPageError } from "./mcp-page.js";

export interface McpErrorNoticeProps {
	error: McpPageError;
}

export function McpErrorNotice({ error }: McpErrorNoticeProps) {
	return (
		<Banner tone="danger" variant="soft">
			<p className="font-medium">{error.message}</p>
			<p className="mt-1">{error.fix}</p>
			<a
				href={error.reportUrl}
				target="_blank"
				rel="noopener noreferrer"
				className="mt-2 inline-block underline underline-offset-2"
			>
				Report an issue
			</a>
		</Banner>
	);
}
