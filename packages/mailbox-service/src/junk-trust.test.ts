import assert from "node:assert";
import { describe, it, mock } from "node:test";
import type {
	AddressService,
	ThreadMessageService,
} from "@remit/remit-electrodb-service";
import { NotFoundError } from "@remit/remit-electrodb-service";
import { adjustSenderTrustForJunkMove } from "./junk-trust.js";

const silentLog = { info: () => {} };

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

	it("propagates a missing Address row (NotFound) — a guaranteed row is absent only on a real bug", async () => {
		const { service, promote } = addressMock();
		promote.mock.mockImplementation(async () => {
			throw new NotFoundError("Address not found: x");
		});
		await assert.rejects(
			() =>
				adjustSenderTrustForJunkMove({
					messageId: "m1",
					isMovingFromJunk: true,
					isMovingToJunk: false,
					addressService: service,
					threadMessageService: threadRow("sender@example.com"),
					log: silentLog,
				}),
			(err: unknown) => err instanceof NotFoundError,
		);
	});

	it("propagates when the trust write fails", async () => {
		const { service, demote } = addressMock();
		demote.mock.mockImplementation(async () => {
			throw new Error("ddb exploded");
		});
		await assert.rejects(
			() =>
				adjustSenderTrustForJunkMove({
					messageId: "m1",
					isMovingFromJunk: false,
					isMovingToJunk: true,
					addressService: service,
					threadMessageService: threadRow("sender@example.com"),
					log: silentLog,
				}),
			/ddb exploded/,
		);
	});
});
