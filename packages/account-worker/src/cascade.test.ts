import assert from "node:assert";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { COVERED_ENTITY_TYPES } from "./cascade.js";

describe("cascade entity coverage snapshot", () => {
	it("covers every entity model in remit-electrodb-service", () => {
		const modelsDir = resolve(
			import.meta.dirname,
			"../../remit-electrodb-service/src/models",
		);
		const modelFiles = readdirSync(modelsDir)
			.filter(
				(f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "index.ts",
			)
			.map((f) => f.replace(".ts", ""));

		// Map model file names to the entity types they contain
		const entityTypesByFile: Record<string, string[]> = {
			"account-config": ["AccountConfig"],
			"account-export-request": [],
			"account-setting": ["AccountSetting"],
			"account-setting-registry": [],
			account: ["Account"],
			address: ["Address", "EnvelopeAddress"],
			envelope: [
				"Envelope",
				"MessageReference",
				"BodyPart",
				"BodyPartParameter",
				"RawMessageStorage",
				"BodyPartStorage",
				"BodyPartContent",
			],
			filter: ["Filter"],
			"filter-anchor": ["FilterAnchor"],
			label: ["Label"],
			mailbox: ["Mailbox"],
			"mailbox-lock": ["MailboxLock"],
			"mailbox-special-use": [],
			message: ["Message"],
			"message-flag": ["MessageFlag"],
			"message-label": ["MessageLabel"],
			"message-placement-move": ["MessagePlacementMove"],
			"outbox-message": ["OutboxMessage"],
			"thread-message": ["ThreadMessage"],
			"wellknown-rule": [],
		};

		const allEntityTypes = Object.values(entityTypesByFile).flat().sort();
		const coveredSorted = [...COVERED_ENTITY_TYPES].sort();

		assert.deepStrictEqual(
			coveredSorted,
			allEntityTypes,
			`Cascade does not cover all entity types.\n` +
				`Missing: ${allEntityTypes.filter((t) => !(coveredSorted as readonly string[]).includes(t)).join(", ")}\n` +
				`Extra: ${(coveredSorted as readonly string[]).filter((t) => !allEntityTypes.includes(t)).join(", ")}`,
		);

		// Verify all model files are accounted for
		const unmappedFiles = modelFiles.filter((f) => !(f in entityTypesByFile));
		assert.deepStrictEqual(
			unmappedFiles,
			[],
			`Model files not mapped to entity types: ${unmappedFiles.join(", ")}`,
		);
	});
});
