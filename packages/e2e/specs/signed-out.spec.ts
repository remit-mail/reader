/**
 * A tab whose bearer the server no longer accepts. The session cookie still
 * opens the app and every API call answers 401, which must raise the one
 * signed-out notice rather than an error page or an empty screen. Signing in
 * from it returns to the address the reader was on.
 *
 * Its own browser context and its own session, so the run's session is left
 * alone.
 */

import { CALENDAR_ZONE, weekDay } from "../src/calendar.js";
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";

/** What the web client keeps in session storage for its bearer, refused by the server. */
const REVOKED_TOKEN = JSON.stringify({
	value: "eyJhbGciOiJSUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.revoked",
	expiresAt: 4102444800,
});

test("a 401 shows the signed-out notice, and signing in returns to the same screen", async ({
	browser,
	run,
}) => {
	const context = await browser.newContext({
		baseURL: baseUrl,
		storageState: { cookies: [], origins: [] },
		viewport: { width: 1440, height: 900 },
		timezoneId: CALENDAR_ZONE,
		locale: "en-GB",
	});
	const signIn = await context.request.post("/api/auth/sign-in/email", {
		data: { email: run.email, password: run.password },
		headers: { origin: baseUrl },
	});
	expect(signIn.ok()).toBe(true);

	const page = await context.newPage();
	await page.addInitScript((token) => {
		if (sessionStorage.getItem("e2e-revoked") !== null) return;
		sessionStorage.setItem("e2e-revoked", "1");
		sessionStorage.setItem("remit.better-auth.token", token);
	}, REVOKED_TOKEN);
	const address = `/calendar/week/${weekDay(0)}`;
	await page.goto(address);

	const notice = page.getByRole("alertdialog", { name: "You're signed out" });
	await expect(notice).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText(/something went wrong|unexpected/i)).toHaveCount(
		0,
	);

	await notice.getByRole("button", { name: "Sign in" }).click();
	await page.getByLabel("Email", { exact: true }).fill(run.email);
	await page.getByLabel("Password", { exact: true }).fill(run.password);
	await page.getByRole("button", { name: "Sign in" }).last().click();

	await expect(page).toHaveURL(new RegExp(`${address}$`), { timeout: 30_000 });
	await expect(page.getByRole("toolbar", { name: "Calendar" })).toBeVisible();
	await expect(notice).toHaveCount(0);
	await context.close();
});
