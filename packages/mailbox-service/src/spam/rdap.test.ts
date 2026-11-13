import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NotFoundError } from "@remit/data-ports/errors";
import { openStore, silentLog } from "../test-helpers/test-store.js";
import { domainRegisteredAt, parseRdapRegistration } from "./rdap.js";

describe("parseRdapRegistration", () => {
	it("reads the registration event's date", () => {
		assert.deepEqual(
			parseRdapRegistration({
				objectClassName: "domain",
				events: [
					{ eventAction: "last changed", eventDate: "2025-01-02T00:00:00Z" },
					{ eventAction: "registration", eventDate: "1997-09-15T04:00:00Z" },
				],
			}),
			{ state: "Published", registeredAt: "1997-09-15T04:00:00Z" },
		);
	});

	it("reads an answer with no registration event as a date the registry does not publish", () => {
		assert.deepEqual(
			parseRdapRegistration({
				objectClassName: "domain",
				ldhName: "example.de",
				events: [
					{ eventAction: "last changed", eventDate: "2024-03-01T10:00:00Z" },
				],
			}),
			{ state: "Unpublished" },
		);
	});

	it("reads anything but an RDAP domain object as no answer", () => {
		assert.equal(
			parseRdapRegistration({ errorCode: 404, title: "Not Found" }),
			undefined,
		);
	});
});

describe("domainRegisteredAt", () => {
	it("leaves the date absent and caches nothing when the lookup throws", async () => {
		const store = await openStore();
		const registeredAt = await domainRegisteredAt(
			{
				domainRegistration: store.domainRegistration,
				rdap: {
					lookup: async () => {
						throw new Error("registry unreachable");
					},
				},
				logger: silentLog,
			},
			"parcel-notice.example",
		);

		assert.equal(registeredAt, undefined);
		await assert.rejects(
			store.domainRegistration.get("parcel-notice.example"),
			NotFoundError,
		);
		await store.close();
	});
});
