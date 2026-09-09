import type { Meta, StoryObj } from "@storybook/react-vite";
import { BlockedImagesNotice } from "@/components/mail/BlockedImagesNotice";

/**
 * The bar above a message body whose remote images were not loaded.
 *
 * Two different facts wear the same strip. Images held back for privacy are a
 * default the reader can lift, so the bar offers both ways out and neither
 * control ever greys out. A blocked sender is an instruction the reader already
 * gave — `BlockedFlag`: never load images, even on explicit click — so the bar
 * carries no controls at all and says why instead, because an image-free
 * message that explains nothing is indistinguishable from a broken one.
 */
const meta: Meta<typeof BlockedImagesNotice> = {
	title: "Flows/Mail/Blocked Images Notice",
	component: BlockedImagesNotice,
	parameters: { layout: "padded" },
};
export default meta;

type Story = StoryObj<typeof BlockedImagesNotice>;

const noop = () => {};

const base = {
	blockedImageCount: 3,
	canAlwaysTrust: true,
	isTrustPending: false,
	isSenderBlocked: false,
	onLoadOnce: noop,
	onAlwaysTrust: noop,
};

const Column = ({ children }: { children: React.ReactNode }) => (
	<div className="w-full max-w-2xl">{children}</div>
);

/** The default: images held back, and two ways to let them in. */
export const Privacy: Story = {
	render: () => (
		<Column>
			<BlockedImagesNotice {...base} />
		</Column>
	),
};

/** The trust toggle is in flight. The button stays pressable and says so. */
export const Trusting: Story = {
	render: () => (
		<Column>
			<BlockedImagesNotice {...base} isTrustPending />
		</Column>
	),
};

/** No parseable From-address, so there is nobody to trust — only Load once. */
export const NoSenderToTrust: Story = {
	render: () => (
		<Column>
			<BlockedImagesNotice {...base} canAlwaysTrust={false} />
		</Column>
	),
};

/** A blocked sender: no way in, and the reason stated rather than left blank. */
export const SenderBlocked: Story = {
	render: () => (
		<Column>
			<BlockedImagesNotice {...base} isSenderBlocked />
		</Column>
	),
};

/** Blocked outranks trusted — a sender carrying both is still blocked. */
export const SenderBlockedAndTrusted: Story = {
	render: () => (
		<Column>
			<BlockedImagesNotice {...base} isSenderBlocked canAlwaysTrust />
		</Column>
	),
};

/** One image, and the copy counts it as one. */
export const SingleImage: Story = {
	render: () => (
		<Column>
			<BlockedImagesNotice {...base} blockedImageCount={1} />
		</Column>
	),
};
