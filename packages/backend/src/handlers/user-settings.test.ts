import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import type { RemitClient } from "../service/data-client.js";
import { createCalendarSqliteClient } from "./calendar-sqlite-fixture.js";
import { readUserSettings, updateUserSettingsFor } from "./user-settings.js";

let client: RemitClient;
let cleanup: () => void;

before(async () => {
	({ client, cleanup } = await createCalendarSqliteClient());
});

after(() => cleanup());

describe("the default invitation sender", () => {
	it("is unset, then names a sending account, then clears", async () => {
		const accountConfigId = deriveAccountConfigId("settings-sub-1");
		const deps = {
			accountSetting: client.accountSetting,
			account: client.account,
		};
		const sender = "0".repeat(25);
		const withSender = {
			...deps,
			account: {
				listAllByAccountConfig: async () => [
					{ accountId: sender, syncedServices: ["Mail"] } as never,
				],
			},
		};

		assert.deepEqual(await readUserSettings(deps, accountConfigId), {
			defaultInvitationSenderAccountId: "",
		});

		const set = await updateUserSettingsFor(withSender, accountConfigId, {
			defaultInvitationSenderAccountId: sender,
		});
		assert.ok(set.ok);
		assert.equal(set.value.defaultInvitationSenderAccountId, sender);

		const cleared = await updateUserSettingsFor(withSender, accountConfigId, {
			defaultInvitationSenderAccountId: "",
		});
		assert.ok(cleared.ok);
		assert.equal(cleared.value.defaultInvitationSenderAccountId, "");
	});

	it("refuses an account that is not the caller's", async () => {
		const accountConfigId = deriveAccountConfigId("settings-sub-2");
		const refused = await updateUserSettingsFor(
			{ accountSetting: client.accountSetting, account: client.account },
			accountConfigId,
			{ defaultInvitationSenderAccountId: "1".repeat(25) },
		);
		assert.equal(refused.ok, false);
	});
});
