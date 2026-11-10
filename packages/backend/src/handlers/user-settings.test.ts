import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { deriveAccountConfigId } from "@remit/data-ports/id";
import type { RemitClient } from "../service/data-client.js";
import { createCalendarSqliteClient } from "./calendar-sqlite-fixture.js";
import { updateUserSettingsFor } from "./user-settings.js";

let client: RemitClient;
let cleanup: () => void;

before(async () => {
	({ client, cleanup } = await createCalendarSqliteClient());
});

after(() => cleanup());

describe("the default invitation sender", () => {
	it("refuses an account that is not the caller's", async () => {
		const accountConfigId = deriveAccountConfigId("settings-sub-2");
		await client.accountConfig.create({
			accountConfigId,
			userId: "settings-sub-2",
		});
		const refused = await updateUserSettingsFor(
			{
				accountSetting: client.accountSetting,
				accountConfig: client.accountConfig,
				classificationDefault: client.classificationDefault,
				accounts: client.account,
				secrets: client.secrets,
				label: client.label,
			},
			accountConfigId,
			{ defaultInvitationSenderAccountId: "1".repeat(25) },
		);
		assert.equal(refused.ok, false);
	});
});
