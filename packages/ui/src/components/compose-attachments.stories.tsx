import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import {
	type ComposeAttachmentItem,
	ComposeAttachments,
} from "./compose-attachments.js";

/**
 * The files on a draft while it is being written (#679). The app owns the
 * upload and hands back per-file state; a refusal carries the server's own
 * sentence, which names the file, its size and the cap.
 */
const meta: Meta<typeof ComposeAttachments> = {
	title: "Design System/Compose/ComposeAttachments",
	component: ComposeAttachments,
	parameters: { layout: "padded" },
	args: {
		onRemove: fn(),
		onRetry: fn(),
	},
};
export default meta;

type Story = StoryObj<typeof ComposeAttachments>;

const boardPack: ComposeAttachmentItem = {
	key: "att-1",
	filename: "Q3 board pack.pdf",
	sizeBytes: 2_411_724,
	state: { status: "attached" },
};

const sitePlan: ComposeAttachmentItem = {
	key: "att-2",
	filename: "site-plan.png",
	sizeBytes: 486_120,
	state: { status: "attached" },
};

const OVER_LIMIT_REASON =
	'"site-survey.mov" is 31.4 MB, over the 25.0 MB a message can carry.';

export const Attached: Story = {
	name: "Attached — two files ready to send",
	args: { items: [boardPack, sitePlan] },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const rows = canvas.getAllByTestId("compose-attachment");
		await expect(rows).toHaveLength(2);
		await expect(rows[0]).toHaveTextContent("Q3 board pack.pdf");
		await expect(rows[0]).toHaveTextContent("2.3 MB");
	},
};

export const Uploading: Story = {
	name: "Uploading — one file still on its way",
	args: {
		items: [
			boardPack,
			{
				key: "att-3",
				filename: "minutes.docx",
				sizeBytes: 88_064,
				state: { status: "uploading" },
			},
		],
	},
};

/**
 * A file over the cap is refused by the server before a byte moves, and the
 * row stays until it is removed, carrying the refusal. There is no retry: the
 * same file would be refused the same way.
 */
export const OverLimit: Story = {
	name: "Refused — the file is over the message limit",
	args: {
		items: [
			boardPack,
			{
				key: "refused-1",
				filename: "site-survey.mov",
				sizeBytes: 32_925_696,
				state: {
					status: "failed",
					reason: OVER_LIMIT_REASON,
					retryable: false,
				},
			},
		],
	},
	render: (args) => {
		const [items, setItems] = useState(args.items);
		return (
			<ComposeAttachments
				{...args}
				items={items}
				onRemove={(key) => {
					args.onRemove(key);
					setItems((current) => current.filter((item) => item.key !== key));
				}}
			/>
		);
	},
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("alert")).toHaveTextContent(
			OVER_LIMIT_REASON,
		);
		await expect(
			canvas.queryByRole("button", { name: "Try again" }),
		).not.toBeInTheDocument();
		await userEvent.click(
			canvas.getByRole("button", { name: "Remove site-survey.mov" }),
		);
		await expect(args.onRemove).toHaveBeenCalledWith("refused-1");
		await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
		await expect(canvas.getAllByTestId("compose-attachment")).toHaveLength(1);
	},
};

export const UploadFailed: Story = {
	name: "Failed — the upload dropped, and can be tried again",
	args: {
		items: [
			{
				key: "att-4",
				filename: "contract.pdf",
				sizeBytes: 1_204_224,
				state: {
					status: "failed",
					reason:
						'"contract.pdf" did not finish uploading: the connection dropped. Try again.',
					retryable: true,
				},
			},
		],
	},
	play: async ({ args, canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "Try again" }));
		await expect(args.onRetry).toHaveBeenCalledWith("att-4");
	},
};
