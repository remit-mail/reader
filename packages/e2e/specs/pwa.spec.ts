/**
 * Installability, asserted against what the deployment serves.
 *
 * The web client has two HTML templates — the package's own `index.html`, which
 * only the dev server uses, and `harness/index.html`, which the image builds
 * from. A head tag added to one and not the other works everywhere except in
 * production, and reading the served DOM is what catches it: each lane of this
 * suite runs against a different one of those templates.
 *
 * A declared icon size is checked against the PNG's own IHDR rather than
 * trusted, because a 512 that is really an upscaled 192 installs happily and
 * looks wrong only on the home screen.
 */
import { baseUrl } from "../src/env.js";
import { expect, test } from "../src/fixtures.js";

const MOBILE = { width: 390, height: 844 };

interface ManifestIcon {
	src: string;
	sizes: string;
	type: string;
	purpose: string;
}

interface Manifest {
	id: string;
	name: string;
	short_name: string;
	start_url: string;
	scope: string;
	display: string;
	theme_color: string;
	background_color: string;
	icons: ManifestIcon[];
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Width and height out of the IHDR chunk, which is always the first one. */
const pngDimensions = (
	bytes: ArrayBuffer,
): { width: number; height: number } => {
	const view = new DataView(bytes);
	for (const [index, byte] of PNG_SIGNATURE.entries()) {
		expect(view.getUint8(index), `byte ${index} of the PNG signature`).toBe(
			byte,
		);
	}
	const chunkType = String.fromCharCode(
		view.getUint8(12),
		view.getUint8(13),
		view.getUint8(14),
		view.getUint8(15),
	);
	expect(chunkType).toBe("IHDR");
	return { width: view.getUint32(16), height: view.getUint32(20) };
};

const readManifest = async (): Promise<Manifest> => {
	const response = await fetch(`${baseUrl}/manifest.webmanifest`);
	expect(response.status).toBe(200);
	expect(response.headers.get("content-type")).toContain("manifest+json");
	return (await response.json()) as Manifest;
};

const expectPng = async (path: string, size: number): Promise<void> => {
	const response = await fetch(`${baseUrl}${path}`);
	expect(response.status, `${path} is served`).toBe(200);
	expect(response.headers.get("content-type")).toContain("image/png");
	expect(pngDimensions(await response.arrayBuffer()), path).toEqual({
		width: size,
		height: size,
	});
};

test.describe("Installable web app", () => {
	test.use({ viewport: MOBILE });

	test("serves a manifest that describes a standalone app", async () => {
		const manifest = await readManifest();

		expect(manifest.id).toBe("/");
		expect(manifest.name).toBe("Remit");
		expect(manifest.short_name).toBe("Remit");
		expect(manifest.start_url).toBe("/");
		expect(manifest.scope).toBe("/");
		expect(manifest.display).toBe("standalone");
		expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/);
		expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/);
		expect(manifest.icons.length).toBeGreaterThan(0);
	});

	test("serves every declared icon at the size it declares", async () => {
		const manifest = await readManifest();

		for (const icon of manifest.icons) {
			const [width, height] = icon.sizes.split("x").map(Number);
			expect(width, `${icon.src} declares a square size`).toBe(height);
			await expectPng(icon.src, width);
		}

		const maskable = manifest.icons.filter(
			(icon) => icon.purpose === "maskable",
		);
		expect(maskable.length, "a maskable icon is declared").toBeGreaterThan(0);
	});

	// iOS ignores the manifest's icons entirely and takes this one, so it is not
	// covered by the loop above.
	test("serves the apple touch icon at 180x180", async () => {
		await expectPng("/apple-touch-icon.png", 180);
	});

	test("serves a favicon", async () => {
		const response = await fetch(`${baseUrl}/favicon.ico`);
		expect(response.status).toBe(200);
	});

	test("the served document links the manifest and the iOS tags", async ({
		page,
	}) => {
		await page.goto("/");

		await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
			"href",
			"/manifest.webmanifest",
		);
		await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
			"href",
			"/apple-touch-icon.png",
		);
		await expect(
			page.locator('meta[name="apple-mobile-web-app-capable"]'),
		).toHaveAttribute("content", "yes");
		await expect(
			page.locator(
				'meta[name="theme-color"][media="(prefers-color-scheme: light)"]',
			),
		).toHaveCount(1);
		await expect(
			page.locator(
				'meta[name="theme-color"][media="(prefers-color-scheme: dark)"]',
			),
		).toHaveCount(1);
	});

	test("the launch targets the manifest names render the app", async ({
		page,
	}) => {
		const manifest = await readManifest();

		// The two coincide today. Deduplicating rather than hardcoding one keeps
		// the launch target and the scope both covered if they ever diverge.
		for (const path of new Set([manifest.start_url, manifest.scope])) {
			await page.goto(path);
			await expect(page).toHaveURL(/\/mail/);
			// The mobile compose button: shell chrome that is up on every mail
			// route regardless of what has synced.
			await expect(
				page.getByRole("button", { name: "Compose new message" }),
			).toBeVisible({ timeout: 30_000 });
		}
	});

	// Nothing here registers a service worker. A phase that adds one has to flip
	// this deliberately, having decided what it does with authenticated
	// responses and with offline errors. Registrations rather than
	// `controller`, which is null on a context's first navigation whether or not
	// a worker was registered.
	test("no service worker is registered for the app", async ({ page }) => {
		await page.goto("/");

		const registrations = await page.evaluate(async () => {
			const existing = await navigator.serviceWorker.getRegistrations();
			return existing.map((registration) => registration.scope);
		});
		expect(registrations).toEqual([]);
		expect(
			await page.evaluate(
				() => navigator.serviceWorker.controller?.scriptURL ?? null,
			),
		).toBeNull();
	});
});
