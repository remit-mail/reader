import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * "Make this a filter" is the wizard's second entry (#477 clause 1.8), and the
 * step it pushes has to be answered on the view that offered it.
 *
 * The affordance is built once by `MailListHeader` and handed down as
 * `makeFilterSlot`, so any surface can put it on screen — but the wizard is
 * mounted per surface, and a surface that renders the row without one leaves
 * the press on a URL nothing answers. That is the dead button clause 1.7 exists
 * to prevent, and it is invisible in review: the row and the host are two files
 * apart, and the affordance keeps working everywhere else.
 *
 * So the pairing is the assertion. A surface that renders the row names where
 * its step is answered, and that file is checked to mount a host. A fourth
 * surface fails here until it does the same.
 */

const here = dirname(fileURLToPath(import.meta.url));

/** How the chrome's slot is read — `MailListHeader` writes it, everyone else reads it. */
const RENDERS_SLOT = /\.makeFilterSlot/;
const MOUNTS_HOST = /<SelectionWizardHost/;

/** Surface that renders the affordance → the file whose composition answers the step. */
const ANSWERED_BY: Record<string, string> = {
	"DailyBrief.tsx": "DailyBrief.tsx",
	"MessageList.tsx": "MessageList.tsx",
	// The starred list's bar is shared with the brief's, so its host is mounted
	// by the view rather than beside the bar.
	"ThreadListInteraction.tsx": "FlaggedList.tsx",
};

const read = (file: string): string =>
	readFileSync(resolve(here, file), "utf8");

const surfacesRenderingTheAffordance = (): string[] =>
	readdirSync(here)
		.filter((file) => file.endsWith(".tsx"))
		.filter((file) => RENDERS_SLOT.test(read(file)));

describe("the make-filter entry", () => {
	it("is rendered only by surfaces that say where its step is answered", () => {
		assert.deepEqual(
			surfacesRenderingTheAffordance().sort(),
			Object.keys(ANSWERED_BY).sort(),
		);
	});

	it("is answered by a mounted wizard on every one of them", () => {
		for (const [surface, host] of Object.entries(ANSWERED_BY)) {
			assert.match(
				read(host),
				MOUNTS_HOST,
				`${surface} is answered by ${host}`,
			);
		}
	});
});
