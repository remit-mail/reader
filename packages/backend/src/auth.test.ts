import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { deriveAccountConfigId } from "./auth.js";

describe("derived ids are stored primary keys: a changed value orphans every row already written and needs a migration, never a new expectation here", () => {
	test("deriveAccountConfigId pins the account a Cognito subject resolves to", () => {
		assert.equal(
			deriveAccountConfigId("golden-cognito-sub"),
			"97h2fhd0c32ocenk6ju12oxto",
		);
	});
});
