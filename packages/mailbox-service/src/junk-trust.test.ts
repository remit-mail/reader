import assert from "node:assert";
import { describe, it, mock } from "node:test";
import type {
	AddressService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import { NotFoundError } from "@remit/remit-electrodb-service";
import { adjustSenderTrustForJunkMove } from "./junk-trust.js";

const silentLog = { info: () => {}, warn: () => {} };

const threadRow = (fromEmail: string | undefined) =>
	({
		getByMessageId: mock.fn(async () => ({
			accountConfigId: "ac-aaaaaaaaaaaaaaaaaaaa",
			fromEmail,
		})),
	}) as unknown as Pick<ThreadMessageService, "getByMessageId">;

const addressMock = () => {
	const promote = mock.fn(async () => ({}) as never);
	const demote = mock.fn(async () => ({}) as never);
	return {
		service: {
			promoteWellknownByUser: promote,
			demoteSenderTrust: demote,
		} as unknown as AddressService,
		promote,
		demote,
	};
};

describe("adjustSenderTrustForJunkMove", () => {
	it("promotes the sender when moving out of Junk", async () => {
		const { service, promote, demote } = addressMock();
		await adjustSenderTrustForJunkMove({
			messageId: "m1",
			isMovingFromJunk: true,
			isMovingToJunk: false,
			addressService: service,
			threadMessageService: threadRow("sender@example.com"),
			log: silentLog,
		});
		assert.equal(promote.mock.callCount(), 1);
		assert.equal(demote.mock.callCount(), 0);
	});

	it("demotes the sender when moving into Junk", async () => {
		const { service, promote, demote } = addressMock();
		await adjustSenderTrustForJunkMove({
			messageId: "m1",
			isMovingFromJunk: false,
			isMovingToJunk: true,
			addressService: service,
			threadMessageService: threadRow("sender@example.com"),
			log: silentLog,
		});
		assert.equal(demote.mock.callCount(), 1);
		assert.equal(promote.mock.callCount(), 0);
	});

	it("does nothing when the move neither leaves nor enters Junk", async () => {
		const { service, promote, demote } = addressMock();
		await adjustSenderTrustForJunkMove({
			messageId: "m1",
			isMovingFromJunk: false,
			isMovingToJunk: false,
			addressService: service,
			threadMessageService: threadRow("sender@example.com"),
			log: silentLog,
		});
		assert.equal(promote.mock.callCount(), 0);
		assert.equal(demote.mock.callCount(), 0);
	});

	it("skips Junk -> Junk (both true) with no trust change", async () => {
		const { service, promote, demote } = addressMock();
		await adjustSenderTrustForJunkMove({
			messageId: "m1",
			isMovingFromJunk: true,
			isMovingToJunk: true,
			addressService: service,
			threadMessageService: threadRow("sender@example.com"),
			log: silentLog,
		});
		assert.equal(promote.mock.callCount(), 0);
		assert.equal(demote.mock.callCount(), 0);
	});

	it("no-ops when the message has no From address", async () => {
		const { service, promote, demote } = addressMock();
		await adjustSenderTrustForJunkMove({
			messageId: "m1",
			isMovingFromJunk: true,
			isMovingToJunk: false,
			addressService: service,
			threadMessageService: threadRow(undefined),
			log: silentLog,
		});
		assert.equal(promote.mock.callCount(), 0);
		assert.equal(demote.mock.callCount(), 0);
	});

	it("swallows a missing-Address NotFoundError (best-effort no-op)", async () => {
		const promote = mock.fn(async () => {
			throw new NotFoundError("Address not found: x");
		});
		const service = {
			promoteWellknownByUser: promote,
			demoteSenderTrust: mock.fn(),
		} as unknown as AddressService;

		await assert.doesNotReject(() =>
			adjustSenderTrustForJunkMove({
				messageId: "m1",
				isMovingFromJunk: true,
				isMovingToJunk: false,
				addressService: service,
				threadMessageService: threadRow("sender@example.com"),
				log: silentLog,
			}),
		);
	});

	it("swallows an unexpected error and warns (move must not fail)", async () => {
		const promote = mock.fn(async () => {
			throw new Error("ddb exploded");
		});
		const warn = mock.fn();
		const service = {
			promoteWellknownByUser: promote,
			demoteSenderTrust: mock.fn(),
		} as unknown as AddressService;

		await assert.doesNotReject(() =>
			adjustSenderTrustForJunkMove({
				messageId: "m1",
				isMovingFromJunk: true,
				isMovingToJunk: false,
				addressService: service,
				threadMessageService: threadRow("sender@example.com"),
				log: { info: () => {}, warn },
			}),
		);
		assert.equal(warn.mock.callCount(), 1);
	});
});
