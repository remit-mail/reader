import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { cognitoAuthProvider } from "@/auth/cognito-provider";
import { AppStory } from "@/mocks/story-frame/AppStory";
import { mailHandlers } from "@/mocks/story-frame/mail-handlers";
import { mailWorld } from "@/mocks/story-frame/mail-world";
import { withRuntimeConfig } from "@/mocks/story-frame/session";

const userPool = withRuntimeConfig({
	cognito: {
		userPoolId: "eu-west-1_Story0001",
		clientId: "story-client-id",
		region: "eu-west-1",
	},
});

const meta = {
	title: "Playground/Shipped/Sign in/Cognito",
	component: AppStory,
	args: { url: "/mail/brief", authProvider: cognitoAuthProvider },
	parameters: {
		layout: "fullscreen",
		theme: "dark",
		msw: { handlers: mailHandlers(mailWorld()) },
	},
	beforeEach: userPool,
} satisfies Meta<typeof AppStory>;
export default meta;

type Story = StoryObj<typeof meta>;

const phone = { viewport: { value: "mobile", isRotated: false } };

const signInForm = async (canvasElement: HTMLElement) => {
	const canvas = within(canvasElement);
	await expect(
		await canvas.findByRole("tab", { name: "Sign In", selected: true }),
	).toBeVisible();
	await expect(canvas.getByLabelText("Username")).toHaveAttribute(
		"placeholder",
		"Enter your username",
	);
	await expect(canvas.getByLabelText("Password")).toHaveAttribute(
		"placeholder",
		"Enter your password",
	);
	await expect(canvas.getByRole("button", { name: "Sign in" })).toBeVisible();
	await expect(canvas.queryByText("Q3 planning")).toBeNull();
};

export const SignInMobile: Story = {
	name: "Sign In — mobile",
	globals: phone,
	play: async ({ canvasElement }) => signInForm(canvasElement),
};

export const CreateAccountMobile: Story = {
	name: "Create Account — mobile",
	globals: phone,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("tab", { name: "Create Account" }),
		);
		await expect(
			await canvas.findByPlaceholderText("Confirm your password"),
		).toBeVisible();
	},
};

export const SignInDesktop: Story = {
	name: "Sign In — desktop",
	play: async ({ canvasElement }) => signInForm(canvasElement),
};

export const SignInLight: Story = {
	name: "Sign In — light",
	parameters: { theme: "light" },
	play: async ({ canvasElement }) => signInForm(canvasElement),
};

export const LocalDevBanner: Story = {
	name: "Local dev banner",
	beforeEach: withRuntimeConfig({}),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(await canvas.findByText("Local dev")).toBeVisible();
		await expect(await canvas.findByText("Q3 planning")).toBeVisible();
	},
};
