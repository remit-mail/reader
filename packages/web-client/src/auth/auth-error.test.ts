import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { __resetFatalError, getCurrentFatalError } from "@/lib/fatal-error";
import {
	type AuthRequest,
	authInlineMessage,
	buildFatalAuthMessage,
	classifyAuthError,
	reportFatalAuthError,
} from "./auth-error";

const SIGN_UP: AuthRequest = {
	method: "POST",
	path: "/api/auth/sign-up/email",
};

describe("classifyAuthError", () => {
	it("treats a 404 on our own route as fatal", () => {
		assert.equal(
			classifyAuthError({ status: 404, statusText: "Not Found" }),
			"fatal",
		);
	});

	it("treats a 5xx as fatal", () => {
		assert.equal(
			classifyAuthError({ status: 503, statusText: "Service Unavailable" }),
			"fatal",
		);
	});

	it("treats an unexpected 4xx with no message as fatal", () => {
		assert.equal(classifyAuthError({ status: 418 }), "fatal");
	});

	it("treats an expected, server-described 4xx as validation", () => {
		assert.equal(
			classifyAuthError({
				status: 422,
				code: "USER_ALREADY_EXISTS",
				message: "User already exists.",
			}),
			"validation",
		);
		assert.equal(
			classifyAuthError({
				status: 401,
				code: "INVALID_EMAIL_OR_PASSWORD",
				message: "Invalid email or password.",
			}),
			"validation",
		);
	});

	it("treats a statusless failure as network", () => {
		assert.equal(classifyAuthError(new Error("Failed to fetch")), "network");
	});

	it("treats better-auth's Fetch Error sentinel as network", () => {
		assert.equal(
			classifyAuthError({
				status: 500,
				statusText: "Fetch Error",
				message: "Fetch related error.",
			}),
			"network",
		);
	});
});

describe("authInlineMessage", () => {
	it("surfaces the server's message for a validation error", () => {
		assert.equal(
			authInlineMessage(
				{ status: 422, message: "User already exists." },
				"validation",
			),
			"User already exists.",
		);
	});

	it("gives a connection hint for a network error", () => {
		assert.match(authInlineMessage(new Error("boom"), "network"), /offline/i);
	});
});

describe("buildFatalAuthMessage", () => {
	it("names the method, path, and status, with 404 troubleshooting guidance", () => {
		const message = buildFatalAuthMessage(
			{ status: 404, statusText: "Not Found" },
			SIGN_UP,
		);
		assert.match(message, /POST \/api\/auth\/sign-up\/email/);
		assert.match(message, /404 Not Found/);
		assert.match(message, /backend is running and up to date/);
	});
});

describe("reportFatalAuthError", () => {
	afterEach(() => __resetFatalError());

	it("escalates to a non-recoverable fatal carrying the request detail", () => {
		reportFatalAuthError({ status: 404, statusText: "Not Found" }, SIGN_UP);
		const fatal = getCurrentFatalError();
		assert.ok(fatal);
		assert.equal(fatal.recoverable, false);
		assert.match(fatal.message, /POST \/api\/auth\/sign-up\/email failed: 404/);
	});
});
