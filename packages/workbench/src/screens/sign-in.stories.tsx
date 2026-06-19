/**
 * Sign-in screen — static mock of the Amplify Authenticator DOM.
 *
 * Uses the exact class names and data-* attributes that @aws-amplify/ui-react
 * renders, so our auth.css overrides can be verified without a live Cognito
 * user pool. The story is scoped under [data-auth-page] which is the same
 * anchor used in AuthShell.tsx. The branded hero, footer, and dev banner are
 * the real @remit/ui components the live shell composes.
 */
import { AuthCard, AuthFooter, AuthHero, Banner } from "@remit/ui";
import type { Meta, StoryObj } from "@storybook/react-vite";

const meta: Meta = {
	title: "Screens/SignIn",
	parameters: { layout: "fullscreen", theme: "dark" },
};
export default meta;

type Story = StoryObj;

/** Static mock of the Amplify Authenticator DOM structure. */
function MockAuthenticator({
	activeTab = "signin",
}: {
	activeTab?: "signin" | "signup";
}) {
	return (
		<div data-amplify-authenticator>
			<div data-amplify-container>
				<div data-amplify-router>
					{/* Tabs */}
					<div
						role="tablist"
						className="amplify-tabs__list amplify-tabs__list--equal"
					>
						<button
							role="tab"
							type="button"
							className={`amplify-tabs__item${activeTab === "signin" ? " amplify-tabs__item--active" : ""}`}
							aria-selected={activeTab === "signin"}
						>
							Sign In
						</button>
						<button
							role="tab"
							type="button"
							className={`amplify-tabs__item${activeTab === "signup" ? " amplify-tabs__item--active" : ""}`}
							aria-selected={activeTab === "signup"}
						>
							Create Account
						</button>
					</div>

					{/* Form */}
					<div data-amplify-form>
						<div
							className="amplify-flex"
							data-orientation="vertical"
							style={{ flexDirection: "column" }}
						>
							<div className="amplify-field">
								<label className="amplify-label" htmlFor="username">
									Username
								</label>
								<input
									id="username"
									className="amplify-input"
									type="text"
									placeholder="Enter your username"
									autoComplete="username"
								/>
							</div>

							<div className="amplify-field">
								<label className="amplify-label" htmlFor="password">
									Password
								</label>
								<div className="amplify-field-group">
									<input
										id="password"
										className="amplify-input"
										type="password"
										placeholder="Enter your password"
										autoComplete="current-password"
									/>
									<div className="amplify-field-group__outer-end">
										<button
											type="button"
											className="amplify-button amplify-button--default amplify-field__show-password"
											aria-label="Show password"
										>
											<svg
												width="16"
												height="16"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												strokeWidth="2"
												strokeLinecap="round"
												strokeLinejoin="round"
												aria-hidden="true"
											>
												<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
												<circle cx="12" cy="12" r="3" />
											</svg>
										</button>
									</div>
								</div>
							</div>

							<button
								type="submit"
								className="amplify-button amplify-button--primary"
							>
								Sign In
							</button>

							<button
								type="button"
								className="amplify-button amplify-button--link"
							>
								Forgot your password?
							</button>
						</div>
					</div>

					{/* Footer */}
					<div data-amplify-footer>
						<AuthFooter />
					</div>
				</div>
			</div>
		</div>
	);
}

function SignInPage({
	activeTab = "signin",
}: {
	activeTab?: "signin" | "signup";
}) {
	return (
		<AuthCard>
			<AuthHero />
			<MockAuthenticator activeTab={activeTab} />
		</AuthCard>
	);
}

/**
 * Mobile sign-in screen — 390px viewport, dark theme, Sign In tab active.
 * Tabs must be clearly spaced with a visible active underline; form fields
 * and button must have correct padding and vertical rhythm.
 */
export const SignInMobile: Story = {
	name: "Sign In — mobile",
	parameters: {
		theme: "dark",
		viewport: { defaultViewport: "mobile1" },
	},
	render: () => <SignInPage />,
};

/**
 * Create Account tab active.
 */
export const CreateAccountMobile: Story = {
	name: "Create Account — mobile",
	parameters: {
		theme: "dark",
		viewport: { defaultViewport: "mobile1" },
	},
	render: () => <SignInPage activeTab="signup" />,
};

/**
 * Desktop — centered card, max-width 26rem.
 */
export const SignInDesktop: Story = {
	name: "Sign In — desktop",
	parameters: { theme: "dark" },
	render: () => <SignInPage />,
};

/**
 * Light theme.
 */
export const SignInLight: Story = {
	name: "Sign In — light",
	parameters: { theme: "light" },
	render: () => <SignInPage />,
};

/**
 * Local-dev banner — shown when Cognito is not configured. Pinned to the top
 * of the viewport above the app, warning tone.
 */
export const LocalDevBanner: Story = {
	name: "Local dev banner",
	parameters: { theme: "dark" },
	render: () => (
		<Banner
			tone="warning"
			className="h-7 sm:h-10 overflow-hidden border-x-0 border-t-0"
		>
			<span className="flex items-center gap-2">
				<strong className="font-semibold shrink-0">Local dev</strong>
				<span className="truncate hidden sm:inline">
					— Cognito not configured. Set VITE_COGNITO_USER_POOL_ID and
					VITE_COGNITO_CLIENT_ID in .env.local to enable sign-in.
				</span>
				<span className="truncate sm:hidden">— no Cognito; signed out</span>
			</span>
		</Banner>
	),
};
