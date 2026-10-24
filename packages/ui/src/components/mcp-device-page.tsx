import { Button, ButtonLink } from "./button.js";
import { Input } from "./input.js";
import { McpErrorNotice } from "./mcp-error-notice.js";
import { McpPage, type McpPageError } from "./mcp-page.js";

export type McpDeviceState =
	| { kind: "enter"; userCode: string; error?: McpPageError }
	| { kind: "confirm"; userCode: string }
	| { kind: "approved" }
	| { kind: "denied" };

export interface McpDevicePageProps {
	state: McpDeviceState;
}

function EnterCode({
	userCode,
	error,
}: {
	userCode: string;
	error?: McpPageError;
}) {
	return (
		<McpPage
			heading="Connect a device"
			intro="Enter the code your terminal shows."
		>
			{error && <McpErrorNotice error={error} />}
			<form method="get" className="flex flex-col gap-4">
				<div className="flex flex-col gap-1 text-sm">
					<label htmlFor="mcp-user-code" className="text-fg-muted">
						Code
					</label>
					<Input
						id="mcp-user-code"
						name="user_code"
						defaultValue={userCode}
						autoComplete="one-time-code"
						autoCapitalize="characters"
						spellCheck={false}
						placeholder="ABCD-EFGH"
						className="font-mono uppercase tracking-widest"
						required
					/>
				</div>
				<Button type="submit">Continue</Button>
			</form>
		</McpPage>
	);
}

function ConfirmCode({ userCode }: { userCode: string }) {
	return (
		<McpPage
			heading="Approve this device?"
			intro="Only approve if your terminal shows the same code."
		>
			<p className="rounded-md border border-line bg-surface-sunken py-3 text-center font-mono text-2xl tracking-widest text-fg">
				{userCode}
			</p>
			<p className="text-sm text-fg-muted">
				Approving lets the device use your mail until you disconnect it.
			</p>
			<form method="post" className="flex gap-2">
				<input type="hidden" name="user_code" value={userCode} />
				<Button
					type="submit"
					name="action"
					value="deny"
					variant="secondary"
					className="flex-1"
				>
					Deny
				</Button>
				<Button type="submit" name="action" value="approve" className="flex-1">
					Approve
				</Button>
			</form>
		</McpPage>
	);
}

function Outcome({ approved }: { approved: boolean }) {
	return (
		<McpPage
			heading={approved ? "Device connected" : "Device denied"}
			intro={
				approved
					? "Go back to your terminal; it signs in by itself."
					: "The device gets no access. You can close this page."
			}
		>
			<ButtonLink href="/apps" variant="secondary">
				Manage connected apps
			</ButtonLink>
		</McpPage>
	);
}

export function McpDevicePage({ state }: McpDevicePageProps) {
	if (state.kind === "enter") {
		return <EnterCode userCode={state.userCode} error={state.error} />;
	}
	if (state.kind === "confirm")
		return <ConfirmCode userCode={state.userCode} />;
	return <Outcome approved={state.kind === "approved"} />;
}
