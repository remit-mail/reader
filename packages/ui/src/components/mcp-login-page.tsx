import { Button } from "./button.js";
import { Input } from "./input.js";
import { McpErrorNotice } from "./mcp-error-notice.js";
import { McpPage, type McpPageError } from "./mcp-page.js";

export interface McpLoginPageProps {
	hiddenFields: Readonly<Record<string, string>>;
	email?: string;
	error?: McpPageError;
}

export function McpLoginPage({
	hiddenFields,
	email,
	error,
}: McpLoginPageProps) {
	return (
		<McpPage
			heading="Sign in to remit"
			intro="Use the email and password you sign in to remit with."
		>
			{error && <McpErrorNotice error={error} />}
			<form method="post" className="flex flex-col gap-4">
				{Object.entries(hiddenFields).map(([name, value]) => (
					<input key={name} type="hidden" name={name} value={value} />
				))}
				<div className="flex flex-col gap-1 text-sm">
					<label htmlFor="mcp-email" className="text-fg-muted">
						Email
					</label>
					<Input
						id="mcp-email"
						name="email"
						type="email"
						autoComplete="username"
						defaultValue={email}
						placeholder="you@example.com"
						required
					/>
				</div>
				<div className="flex flex-col gap-1 text-sm">
					<label htmlFor="mcp-password" className="text-fg-muted">
						Password
					</label>
					<Input
						id="mcp-password"
						name="password"
						type="password"
						autoComplete="current-password"
						placeholder="Your password"
						required
					/>
				</div>
				<Button type="submit">Sign in</Button>
			</form>
		</McpPage>
	);
}
