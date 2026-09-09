import { configOperationsGetConfigQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { makeAccount, makeConfig } from "../../test-support/fixtures";
import { FromSelector } from "./FromSelector";

/**
 * The compose From line (#1014). With more than one configured account it is
 * a real picker; the unresolved state — no account chosen because the source
 * mailbox could not be matched to one — gets a disabled placeholder option
 * rather than silently falling back to the first account's address.
 */

const ACCOUNTS = [
	makeAccount({ accountId: "acc-1", email: "alice@example.com" }),
	makeAccount({ accountId: "acc-2", email: "bob@example.com" }),
];

function seededClient(): QueryClient {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	client.setQueryData(
		configOperationsGetConfigQueryKey(),
		makeConfig(ACCOUNTS),
	);
	return client;
}

const meta: Meta<typeof FromSelector> = {
	title: "Components/FromSelector",
	component: FromSelector,
	parameters: { layout: "padded" },
	decorators: [
		(Story) => (
			<QueryClientProvider client={seededClient()}>
				<Story />
			</QueryClientProvider>
		),
	],
	args: {
		onSelect: () => undefined,
	},
};
export default meta;

type Story = StoryObj<typeof FromSelector>;

/** A resolved account, picked from the configured accounts. */
export const Resolved: Story = {
	args: { selectedAccountId: "acc-2" },
};

/**
 * No account resolved — the source mailbox could not be matched to a
 * configured account. The select shows a disabled placeholder instead of
 * falling back to the first account's address.
 */
export const Unresolved: Story = {
	args: { selectedAccountId: undefined },
};
