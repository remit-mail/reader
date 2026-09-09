/**
 * "Similar messages" on an instance with semantic search off (#1068).
 *
 * Off is a deployment setting, and the client learns it from the config read
 * every surface already makes. Before this the section rendered nothing at all,
 * which reads as a sender nothing resembles — the one thing an operator who
 * has not turned semantic search on cannot tell from the truth.
 *
 * Drives the real chain: `useIntelligenceData` reads `GET /config`, the state
 * resolver turns `semanticSearchEnabled: false` into the off state, and the
 * real `IntelligencePanel` renders it. Both halves are asserted — the copy the
 * operator acts on, and that no semantic query is sent at all.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { IntelligencePanel } from "@remit/ui";
import { createElement } from "react";
import { useIntelligenceData } from "@/hooks/useIntelligenceData";
import { createDomHarness, type DomHarness } from "@/test-support/dom";
import {
	makeAccount,
	makeConfig,
	makeThreadMessage,
} from "@/test-support/fixtures";
import { type HttpMock, mockFetch } from "@/test-support/http";
import { resolveSimilarState } from "./IntelligencePane";

const thread = makeThreadMessage({ messageId: "msg-1" });

const SimilarHarness = () => {
	const {
		data,
		isSimilarLoading,
		similarError,
		similarErrorIsFatal,
		semanticEnabled,
	} = useIntelligenceData(thread, "mbx-inbox");
	if (!data) return null;
	return createElement(IntelligencePanel, {
		data,
		similarState: resolveSimilarState({
			similarError,
			similarErrorIsFatal,
			isSimilarLoading,
			semanticEnabled,
		}),
	});
};

const respond =
	(semanticSearchEnabled: boolean) => (call: { path: string }) => {
		if (call.path.endsWith("/config")) {
			return makeConfig([makeAccount({ accountId: "acc-1" })], {
				semanticSearchEnabled,
			});
		}
		if (call.path.endsWith("/addresses/search")) return { items: [] };
		return { items: [] };
	};

let harness: DomHarness | undefined;
let http: HttpMock;

afterEach(() => {
	harness?.close();
	harness = undefined;
	http.restore();
});

describe("the Similar messages section on an instance with semantic search off", () => {
	it("states the setting, what turning it on buys, and the command", async () => {
		http = mockFetch(respond(false));
		harness = createDomHarness();
		harness.renderApp(createElement(SimilarHarness));

		await harness.waitFor(
			() => harness?.text().includes("Semantic search is off") === true,
		);

		const text = harness.text();
		assert.match(text, /Semantic search is off on this instance/);
		assert.match(text, /Organize/);
		assert.match(text, /filters/);
		assert.match(text, /remit semantic on/);
	});

	it("sends no semantic query, because an empty answer is the same as no match", async () => {
		http = mockFetch(respond(false));
		harness = createDomHarness();
		harness.renderApp(createElement(SimilarHarness));

		await harness.waitFor(
			() => harness?.text().includes("Semantic search is off") === true,
		);
		await harness.wait(30);
		await harness.flush();

		assert.deepEqual(http.to("/search/semantic"), []);
	});

	it("says none of it while the instance has semantic search on", async () => {
		http = mockFetch(respond(true));
		harness = createDomHarness();
		harness.renderApp(createElement(SimilarHarness));

		await harness.waitFor(() => http.to("/search/semantic").length > 0);

		assert.doesNotMatch(harness.text(), /Semantic search is off/);
	});
});
