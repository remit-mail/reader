/**
 * What a refusal and a report are *about* (#847). The mailbox pane never
 * remounts on a route change, so both are scoped: account A's standing refusal
 * must not render over account B's Trash, and a count from a folder that was
 * emptied must not outlive the folder it counted. The empty is also issued
 * against the Trash `/config` names at that moment, so the replay after a
 * repair invalidates the folder it actually emptied.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { configOperationsGetConfigQueryKey } from "@remit/api-http-client/@tanstack/react-query.gen.ts";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { RoleAppointmentPromptProvider } from "@/components/mail/RoleAppointmentPromptProvider";
import { ErrorBannerProvider } from "@/components/ui/ErrorBannerProvider";
import { createDomHarness, type DomHarness } from "../test-support/dom";
import { type HttpMock, mockFetch } from "../test-support/http";
import { type EmptyTrashState, useEmptyTrash } from "./useEmptyTrash";

const ACCOUNT_A = "acc-a";
const ACCOUNT_B = "acc-b";
const TRASH_A = "mbx-trash-a";
const TRASH_B = "mbx-trash-b";

let harness: DomHarness | undefined;
let http: HttpMock | undefined;
let state: EmptyTrashState | undefined;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http?.restore();
	http = undefined;
	state = undefined;
});

const CONFIG = {
	accounts: [
		{
			accountId: ACCOUNT_A,
			email: "a@example.com",
			folderAppointments: [
				{ role: "Trash", mailboxId: TRASH_A, source: "Proposed" },
			],
		},
		{
			accountId: ACCOUNT_B,
			email: "b@example.com",
			folderAppointments: [
				{ role: "Trash", mailboxId: TRASH_B, source: "Appointed" },
			],
		},
	],
};

/** Fresh every call — a `Response` body can only be read once. */
const refusal = (): Response =>
	new Response(
		JSON.stringify({
			status: 409,
			message: "Trash is not confirmed",
			code: "folder_role_unresolved",
			details: { reason: "unconfirmed", role: "Trash", accountId: ACCOUNT_A },
		}),
		{ status: 409, headers: { "content-type": "application/json" } },
	);

/** Account A refuses the empty; account B allows it. */
const respond = (path: string): unknown => {
	if (path.endsWith("/config")) return CONFIG;
	if (path.endsWith(`/accounts/${ACCOUNT_A}/trash/empty`)) return refusal();
	if (path.endsWith(`/accounts/${ACCOUNT_B}/trash/empty`))
		return { deletedCount: 7 };
	return {};
};

const Probe = ({
	accountId,
	mailboxId,
}: {
	accountId: string;
	mailboxId: string;
}) => {
	state = useEmptyTrash({ accountId, mailboxId });
	return null;
};

const tree = (accountId: string, mailboxId: string) =>
	createElement(
		QueryClientProvider,
		{ client: harness?.queryClient as never },
		createElement(
			ErrorBannerProvider,
			null,
			createElement(
				RoleAppointmentPromptProvider,
				null,
				createElement(Probe, { accountId, mailboxId }),
			),
		),
	);

const settle = async (done: () => boolean = () => false): Promise<void> => {
	if (!harness) throw new Error("nothing mounted");
	for (let round = 0; round < 40; round += 1) {
		await harness.flush();
		await harness.wait(0);
		if (done()) return;
	}
};

const mount = async (accountId: string, mailboxId: string): Promise<void> => {
	http = mockFetch((call) => respond(call.path));
	harness = createDomHarness();
	await harness.renderAsync(tree(accountId, mailboxId));
	await settle(() => state !== undefined);
};

/** The same mounted pane, now looking at another folder — never a remount. */
const openInstead = async (
	accountId: string,
	mailboxId: string,
): Promise<void> => {
	if (!harness) throw new Error("nothing mounted");
	await harness.renderAsync(tree(accountId, mailboxId));
	await settle();
};

const press = async (done: () => boolean): Promise<void> => {
	await act(async () => {
		state?.emptyTrash();
	});
	await settle(done);
};

describe("useEmptyTrash scope", () => {
	it("drops a refusal raised on one mailbox when another is opened", async () => {
		await mount(ACCOUNT_A, TRASH_A);
		await press(() => state?.refusal !== undefined);
		assert.equal(state?.refusal?.reason, "unconfirmed");
		assert.equal(state?.refusal?.accountId, ACCOUNT_A);

		await openInstead(ACCOUNT_B, TRASH_B);
		assert.equal(state?.refusal, undefined);
	});

	it("drops a report of what was emptied when another mailbox is opened", async () => {
		await mount(ACCOUNT_B, TRASH_B);
		await press(() => state?.deletedCount !== undefined);
		assert.equal(state?.deletedCount, 7);

		await openInstead(ACCOUNT_A, TRASH_A);
		assert.equal(state?.deletedCount, undefined);
	});

	it("issues the empty against the account the pane is on", async () => {
		await mount(ACCOUNT_A, TRASH_A);
		await press(() => state?.refusal !== undefined);
		await openInstead(ACCOUNT_B, TRASH_B);
		await press(() => state?.deletedCount !== undefined);

		const empties = (http?.calls ?? []).filter((call) =>
			call.path.endsWith("/trash/empty"),
		);
		assert.equal(empties.length, 2);
		assert.ok(empties[0].path.endsWith(`/accounts/${ACCOUNT_A}/trash/empty`));
		assert.ok(empties[1].path.endsWith(`/accounts/${ACCOUNT_B}/trash/empty`));
	});

	it("drops the refusal once the account's Trash resolution changes", async () => {
		await mount(ACCOUNT_A, TRASH_A);
		await press(() => state?.refusal !== undefined);
		assert.ok(state?.refusal);

		// A repair made anywhere else — the settings pane, another tab — lands
		// here as a new `/config`, and the refusal it answered is spent.
		await act(async () => {
			harness?.queryClient.setQueryData(configOperationsGetConfigQueryKey(), {
				accounts: [
					{
						...CONFIG.accounts[0],
						folderAppointments: [
							{ role: "Trash", mailboxId: TRASH_A, source: "Appointed" },
						],
					},
					CONFIG.accounts[1],
				],
			});
		});
		await settle(() => state?.refusal === undefined);
		assert.equal(state?.refusal, undefined);
	});
});
