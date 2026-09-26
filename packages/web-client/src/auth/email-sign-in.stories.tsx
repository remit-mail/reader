import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, userEvent, within } from "storybook/test";
import { betterAuthProvider } from "@/auth/better-auth-provider";
import { AppStory } from "@/mocks/story-frame/AppStory";
import { mailHandlers } from "@/mocks/story-frame/mail-handlers";
import { mailWorld } from "@/mocks/story-frame/mail-world";
import { withRuntimeConfig } from "@/mocks/story-frame/session";

const signedOut = http.get("/api/auth/get-session", () =>
	HttpResponse.json(null),
);

const meta = {
	title: "Playground/Shipped/Sign in/Email and password",
	component: AppStory,
	args: { url: "/mail/brief", authProvider: betterAuthProvider },
	parameters: {
		layout: "fullscreen",
		msw: { handlers: [signedOut, ...mailHandlers(mailWorld())] },
	},
	beforeEach: withRuntimeConfig({ betterAuthEnabled: true }),
} satisfies Meta<typeof AppStory>;
export default meta;

type Story = StoryObj<typeof meta>;

const submit = (canvasElement: HTMLElement): HTMLElement => {
	const button = canvasElement.querySelector<HTMLElement>(
		'button[type="submit"]',
	);
	if (!button) throw new Error("the sign-in form has no submit button");
	return button;
};

const fill = async (canvasElement: HTMLElement) => {
	const canvas = within(canvasElement);
	await userEvent.type(
		await canvas.findByLabelText("Email"),
		"alice@example.com",
	);
	await userEvent.type(canvas.getByLabelText("Password"), "not-my-password");
};

export const SignIn: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(
			await canvas.findByRole("button", { name: "Sign in", pressed: true }),
		).toBeVisible();
		await expect(canvas.getByLabelText("Email")).toBeVisible();
		await expect(canvas.queryByLabelText("Name")).toBeNull();
		await expect(canvas.queryByText("Q3 planning")).toBeNull();
	},
};

export const CreateAccount: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: "Create account" }),
		);
		await expect(await canvas.findByLabelText("Name")).toBeVisible();
		await expect(
			canvas.getByRole("button", { name: "Create account", pressed: true }),
		).toBeVisible();
	},
};

export const WrongPassword: Story = {
	parameters: {
		msw: {
			handlers: [
				signedOut,
				http.post("/api/auth/sign-in/email", () =>
					HttpResponse.json(
						{
							code: "INVALID_EMAIL_OR_PASSWORD",
							message: "Invalid email or password",
						},
						{ status: 401 },
					),
				),
				...mailHandlers(mailWorld()),
			],
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await fill(canvasElement);
		await userEvent.click(submit(canvasElement));
		await expect(
			await canvas.findByText("Invalid email or password"),
		).toBeVisible();
	},
};

export const SignupsClosed: Story = {
	parameters: {
		msw: {
			handlers: [
				signedOut,
				http.post("/api/auth/sign-up/email", () =>
					HttpResponse.json(
						{
							code: "EMAIL_PASSWORD_SIGN_UP_DISABLED",
							message: "Email and password sign up is not enabled",
						},
						{ status: 400 },
					),
				),
				...mailHandlers(mailWorld()),
			],
		},
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			await canvas.findByRole("button", { name: "Create account" }),
		);
		await userEvent.type(await canvas.findByLabelText("Name"), "Alice");
		await fill(canvasElement);
		await userEvent.click(submit(canvasElement));
		await expect(
			await canvas.findByText(/New signups are currently closed/),
		).toBeVisible();
	},
};
