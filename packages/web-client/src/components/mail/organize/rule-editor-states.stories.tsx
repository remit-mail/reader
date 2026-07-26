import { BottomSheet } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import {
	BackApplyError,
	CommitError,
	FilterSaved,
	JobProgress,
	SavingState,
} from "./rule-editor-states";

/**
 * `Flows/Smart Organize/Rule editor states` — the non-editing states the rule
 * editor lands in after a commit, rendered from the real components the Organize
 * surface mounts. Creating a standing filter now runs the retroactive back-apply,
 * so a standing save flows Saving → back-apply in flight → done, the same job
 * states the one-time apply reaches. Every state here is what ships, so the flow
 * cannot drift from the story.
 */

function SheetStage({ children }: { children: ReactNode }) {
	return (
		<div className="relative mx-auto h-dvh w-full shrink-0 overflow-hidden bg-surface sm:my-6 sm:h-[520px] sm:w-[390px] sm:rounded-[2rem] sm:border sm:border-line sm:shadow-sm">
			<BottomSheet open onClose={() => undefined}>
				{children}
			</BottomSheet>
		</div>
	);
}

const meta: Meta = {
	title: "Flows/Smart Organize/Rule editor states",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/** Saving the filter — held while the create request is in flight. */
export const Saving: Story = {
	render: () => (
		<SheetStage>
			<SavingState />
		</SheetStage>
	),
};

/**
 * The back-apply running after a standing filter is created — the pass that
 * reaches the mail already in the mailbox, not only the mail that arrives next.
 */
export const BackApplyInFlight: Story = {
	name: "Back-apply in flight",
	render: () => (
		<SheetStage>
			<JobProgress
				progress={{
					state: "Running",
					matchedCount: 24,
					appliedCount: 0,
					failedCount: 0,
					errorMessage: "",
				}}
				isDone={false}
				runningLabel="Organizing mail from these senders…"
				onClose={() => undefined}
			/>
		</SheetStage>
	),
};

/** The back-apply finished — the count moved is stated plainly. */
export const BackApplyDone: Story = {
	name: "Back-apply done",
	render: () => (
		<SheetStage>
			<JobProgress
				progress={{
					state: "Complete",
					matchedCount: 24,
					appliedCount: 24,
					failedCount: 0,
					errorMessage: "",
				}}
				isDone
				runningLabel="Organizing mail from these senders…"
				onClose={() => undefined}
			/>
		</SheetStage>
	),
};

/** The back-apply failed — the rule is still saved, the move is what did not run. */
export const BackApplyFailed: Story = {
	name: "Back-apply failed",
	render: () => (
		<SheetStage>
			<JobProgress
				progress={{
					state: "Failed",
					matchedCount: 24,
					appliedCount: 6,
					failedCount: 18,
					errorMessage: "Could not reach the mail server. Please try again.",
				}}
				isDone
				runningLabel="Organizing mail from these senders…"
				onClose={() => undefined}
			/>
		</SheetStage>
	),
};

/**
 * The filter saved, but the back-apply's own request never got off the ground
 * (a 5xx or dropped connection on start). The rule is live for new mail; moving
 * the existing mail is what failed, and it is offered again — never swallowed
 * behind a plain "saved".
 */
export const BackApplyStartFailed: Story = {
	name: "Back-apply start failed",
	render: () => (
		<SheetStage>
			<BackApplyError onRetry={() => undefined} onClose={() => undefined} />
		</SheetStage>
	),
};

/** The filter saved with nothing to back-apply — the plain confirmation. */
export const FilterSavedState: Story = {
	name: "Filter saved",
	render: () => (
		<SheetStage>
			<FilterSaved onClose={() => undefined} />
		</SheetStage>
	),
};

/** The create failed — retry or dismiss. */
export const CommitFailed: Story = {
	name: "Commit failed",
	render: () => (
		<SheetStage>
			<CommitError onRetry={() => undefined} onClose={() => undefined} />
		</SheetStage>
	),
};
