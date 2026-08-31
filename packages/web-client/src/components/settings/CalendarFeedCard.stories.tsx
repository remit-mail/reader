import type { Meta, StoryObj } from "@storybook/react-vite";
import { CalendarFeedCard } from "./CalendarFeedCard";

/**
 * Settings › Calendars: the per-calendar subscription address (#1067). Every
 * state the server can put the control in, including the one moment the address
 * is legible and the two confirmations that take it away.
 */
const meta: Meta<typeof CalendarFeedCard> = {
	title: "Flows/Settings Calendars/Subscription address",
	component: CalendarFeedCard,
	parameters: { layout: "padded" },
	args: {
		calendarName: "Work",
		mintedUrl: "",
		isBusy: false,
		actionError: undefined,
		onMint: () => undefined,
		onRevoke: () => undefined,
		onDismissMinted: () => undefined,
		onRetry: () => undefined,
	},
};
export default meta;

type Story = StoryObj<typeof CalendarFeedCard>;

const CREATED = Date.parse("2026-05-04T09:12:00Z");
const ROTATED = Date.parse("2026-08-19T16:40:00Z");

const ADDRESS =
	"webcal://mail.example.com/feeds/calendar/9Xq2mB7tK1vHs4dLpZ0rY6wJfN3aC8eQuIoT5gRbVkE.ics";

/** The read is still out — no control has an answer to draw yet. */
export const Loading: Story = {
	args: { state: { status: "loading" } },
};

/** Not shared. The one control creates the address, and says what it is. */
export const NotShared: Story = {
	args: { state: { status: "absent" } },
};

/** The create is in flight. */
export const Creating: Story = {
	args: { state: { status: "absent" }, isBusy: true },
};

/** Shared, on an address that has never been replaced. */
export const Shared: Story = {
	args: {
		state: { status: "active", createdAt: CREATED, rotatedAt: 0 },
	},
};

/** Shared, on the dark theme. */
export const SharedDark: Story = {
	name: "Shared (dark)",
	parameters: { theme: "dark" },
	args: {
		state: { status: "active", createdAt: CREATED, rotatedAt: 0 },
	},
};

/** Shared on an address that has been replaced since it was first created. */
export const SharedAfterRotation: Story = {
	args: {
		state: { status: "active", createdAt: CREATED, rotatedAt: ROTATED },
	},
};

/**
 * The one moment the address is readable: straight after the write that minted
 * it. It is not stored in the clear, so nothing can show it again.
 */
export const AddressShownOnce: Story = {
	args: {
		state: { status: "active", createdAt: CREATED, rotatedAt: 0 },
		mintedUrl: ADDRESS,
	},
};

/** The same, on the dark theme. */
export const AddressShownOnceDark: Story = {
	name: "Address shown once (dark)",
	parameters: { theme: "dark" },
	args: {
		state: { status: "active", createdAt: CREATED, rotatedAt: 0 },
		mintedUrl: ADDRESS,
	},
};

/** Replacing the address warns that the current one stops working. */
export const RotateConfirm: Story = {
	args: {
		state: { status: "active", createdAt: CREATED, rotatedAt: 0 },
	},
	play: async ({ canvasElement }) => {
		const buttons = [...canvasElement.querySelectorAll("button")];
		buttons.find((button) => button.textContent === "Replace address")?.click();
	},
};

/** Revoking says the address stops working immediately. */
export const RevokeConfirm: Story = {
	args: {
		state: { status: "active", createdAt: CREATED, rotatedAt: 0 },
	},
	play: async ({ canvasElement }) => {
		const buttons = [...canvasElement.querySelectorAll("button")];
		buttons.find((button) => button.textContent === "Stop sharing")?.click();
	},
};

/** The write was refused. The card says so where the button is. */
export const WriteRefused: Story = {
	args: {
		state: { status: "absent" },
		actionError: new Error("Calendar not found"),
	},
};

/**
 * The read itself failed. Not drawn as "not shared": a calendar the server
 * would not answer for may well be shared with somebody right now.
 */
export const Unreadable: Story = {
	args: {
		state: {
			status: "unreadable",
			error: new Error("Service unavailable"),
		},
	},
};
