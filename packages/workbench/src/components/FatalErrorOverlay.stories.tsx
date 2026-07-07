import type { Meta, StoryObj } from "@storybook/react-vite";
import { AlertOctagon } from "lucide-react";

/**
 * Fatal error overlay — mirrors the web-client `FatalErrorScreen` (issue #1231).
 * The full-screen red page is the app's loud, unmistakable failure state. Its
 * actions depend on whether the error is recoverable:
 *
 *  - **Recoverable** (transient 5xx / network / abort) → offers **Retry**.
 *  - **Deterministic fatal** (a caught render exception, e.g. the "date value
 *    is not finite" crash) → NO Retry, because retry re-crashes the same page.
 *    It offers **Go to inbox** (a safe route out) instead.
 *
 * Both states always offer **Report a bug** (a prefilled GitHub issue seeded
 * with the stacktrace) and **Copy full details** (clipboard fallback for when
 * the stack is too long to fit in the issue URL).
 *
 * Storybook can't import from the web-client package, so this reproduces the
 * markup verbatim for visual review — same convention as BugReportButton.
 */

const primaryButton =
	"inline-flex min-h-11 items-center rounded-md bg-white px-5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50";
const secondaryButton =
	"inline-flex min-h-11 items-center rounded-md border border-white/70 px-5 text-sm font-semibold text-white transition-colors hover:bg-white/10";

interface DemoProps {
	recoverable: boolean;
	message: string;
	correlationId: string;
}

function FatalErrorScreenDemo({
	recoverable,
	message,
	correlationId,
}: DemoProps) {
	const description = recoverable
		? "The server returned an unexpected error. This is not your fault — nothing was saved or sent. Retry, or report a bug so we can fix it."
		: "Something went wrong and this page can't recover. This is not your fault — nothing was saved or sent. Go to your inbox, or report a bug so we can fix it.";

	return (
		<div
			role="alert"
			className="absolute inset-0 z-[1000] flex flex-col items-center justify-center gap-6 bg-red-700 p-6 text-center text-white"
		>
			<AlertOctagon className="size-16 shrink-0" aria-hidden="true" />
			<div className="max-w-lg space-y-3">
				<h1 className="text-2xl font-bold tracking-tight">Something broke</h1>
				<p className="text-base text-red-50">{description}</p>
				<p className="break-words font-mono text-sm text-red-100">{message}</p>
				<p className="font-mono text-xs text-red-200">
					Reference: {correlationId}
				</p>
			</div>
			<div className="flex flex-wrap items-center justify-center gap-3">
				{recoverable ? (
					<button type="button" className={primaryButton}>
						Retry
					</button>
				) : (
					<span className={primaryButton}>Go to inbox</span>
				)}
				<button type="button" className={secondaryButton}>
					Report a bug
				</button>
				<button type="button" className={secondaryButton}>
					Copy full details
				</button>
			</div>
		</div>
	);
}

const meta: Meta<typeof FatalErrorScreenDemo> = {
	title: "Components/FatalErrorOverlay",
	component: FatalErrorScreenDemo,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="relative h-dvh w-full bg-canvas">
				<Story />
			</div>
		),
	],
};
export default meta;

type Story = StoryObj<typeof FatalErrorScreenDemo>;

/**
 * Recoverable — a transient 5xx. Retry may succeed, so it is the primary
 * action.
 */
export const RecoverableTransient: Story = {
	args: {
		recoverable: true,
		message: "Request failed with status 500",
		correlationId: "a1b2c3d4-5678-90ab-cdef-1234567890ab",
	},
};

/**
 * Deterministic fatal — a caught render exception. Retry would re-crash, so it
 * is replaced by a safe route out (Go to inbox).
 */
export const DeterministicFatal: Story = {
	args: {
		recoverable: false,
		message: "date value is not finite in DateTimeFormat format()",
		correlationId: "def45678-90ab-cdef-1234-567890abcdef",
	},
};
