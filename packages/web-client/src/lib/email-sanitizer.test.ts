import assert from "node:assert";
import { describe, test } from "node:test";
import { buildCidResolver } from "./cid-resolver";

/**
 * Test the color parsing and detection logic.
 *
 * Note: DOMPurify requires a DOM (browser or JSDOM), so we test the
 * color utility functions separately by duplicating them here.
 * The full sanitizer is tested in the browser.
 */

interface RGB {
	r: number;
	g: number;
	b: number;
	a?: number;
}

const parseColor = (color: string): RGB | null => {
	const trimmed = color.trim().toLowerCase();

	const namedColors: Record<string, RGB> = {
		white: { r: 255, g: 255, b: 255 },
		black: { r: 0, g: 0, b: 0 },
		transparent: { r: 0, g: 0, b: 0, a: 0 },
	};

	if (namedColors[trimmed]) {
		return namedColors[trimmed];
	}

	const hexMatch = trimmed.match(/^#([0-9a-f]{3,8})$/);
	if (hexMatch) {
		const hex = hexMatch[1];
		if (hex.length === 3) {
			return {
				r: Number.parseInt(hex[0] + hex[0], 16),
				g: Number.parseInt(hex[1] + hex[1], 16),
				b: Number.parseInt(hex[2] + hex[2], 16),
			};
		}
		if (hex.length === 6) {
			return {
				r: Number.parseInt(hex.slice(0, 2), 16),
				g: Number.parseInt(hex.slice(2, 4), 16),
				b: Number.parseInt(hex.slice(4, 6), 16),
			};
		}
		if (hex.length === 8) {
			return {
				r: Number.parseInt(hex.slice(0, 2), 16),
				g: Number.parseInt(hex.slice(2, 4), 16),
				b: Number.parseInt(hex.slice(4, 6), 16),
				a: Number.parseInt(hex.slice(6, 8), 16) / 255,
			};
		}
	}

	const rgbMatch = trimmed.match(
		/^rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/,
	);
	if (rgbMatch) {
		return {
			r: Number.parseInt(rgbMatch[1], 10),
			g: Number.parseInt(rgbMatch[2], 10),
			b: Number.parseInt(rgbMatch[3], 10),
			a: rgbMatch[4] ? Number.parseFloat(rgbMatch[4]) : undefined,
		};
	}

	return null;
};

const getLuminance = (rgb: RGB): number => {
	const [rs, gs, bs] = [rgb.r / 255, rgb.g / 255, rgb.b / 255].map((c) =>
		c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
	);
	return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
};

const isLightColor = (rgb: RGB): boolean => getLuminance(rgb) > 0.85;
const isDarkColor = (rgb: RGB): boolean => getLuminance(rgb) < 0.15;
const hasLowAlpha = (rgb: RGB): boolean => rgb.a !== undefined && rgb.a < 0.5;

describe("color parsing", () => {
	test("parses named color: white", () => {
		const result = parseColor("white");
		assert.deepEqual(result, { r: 255, g: 255, b: 255 });
	});

	test("parses named color: black", () => {
		const result = parseColor("black");
		assert.deepEqual(result, { r: 0, g: 0, b: 0 });
	});

	test("parses 3-digit hex", () => {
		const result = parseColor("#fff");
		assert.deepEqual(result, { r: 255, g: 255, b: 255 });
	});

	test("parses 6-digit hex", () => {
		const result = parseColor("#336699");
		assert.deepEqual(result, { r: 51, g: 102, b: 153 });
	});

	test("parses 8-digit hex with alpha", () => {
		const result = parseColor("#ffffff80");
		assert.ok(result);
		assert.equal(result.r, 255);
		assert.equal(result.g, 255);
		assert.equal(result.b, 255);
		assert.ok(result.a !== undefined && result.a > 0.49 && result.a < 0.51);
	});

	test("parses rgb()", () => {
		const result = parseColor("rgb(255, 128, 0)");
		assert.ok(result);
		assert.equal(result.r, 255);
		assert.equal(result.g, 128);
		assert.equal(result.b, 0);
		assert.equal(result.a, undefined);
	});

	test("parses rgba()", () => {
		const result = parseColor("rgba(255, 255, 255, 0.5)");
		assert.deepEqual(result, { r: 255, g: 255, b: 255, a: 0.5 });
	});

	test("returns null for invalid color", () => {
		const result = parseColor("not-a-color");
		assert.equal(result, null);
	});

	test("handles whitespace", () => {
		const result = parseColor("  #fff  ");
		assert.deepEqual(result, { r: 255, g: 255, b: 255 });
	});

	test("case insensitive", () => {
		const result = parseColor("#FFF");
		assert.deepEqual(result, { r: 255, g: 255, b: 255 });
	});
});

describe("luminance detection", () => {
	test("white is a light color", () => {
		const white = { r: 255, g: 255, b: 255 };
		assert.ok(isLightColor(white));
		assert.ok(!isDarkColor(white));
	});

	test("black is a dark color", () => {
		const black = { r: 0, g: 0, b: 0 };
		assert.ok(isDarkColor(black));
		assert.ok(!isLightColor(black));
	});

	test("#f0f0f0 is a light color", () => {
		const color = { r: 240, g: 240, b: 240 };
		assert.ok(isLightColor(color));
	});

	test("#333333 is a dark color", () => {
		const color = { r: 51, g: 51, b: 51 };
		assert.ok(isDarkColor(color));
	});

	test("mid-gray is neither light nor dark", () => {
		const gray = { r: 128, g: 128, b: 128 };
		assert.ok(!isLightColor(gray));
		assert.ok(!isDarkColor(gray));
	});
});

describe("alpha detection", () => {
	test("detects low alpha", () => {
		assert.ok(hasLowAlpha({ r: 255, g: 255, b: 255, a: 0.3 }));
		assert.ok(hasLowAlpha({ r: 255, g: 255, b: 255, a: 0.0 }));
	});

	test("high alpha is not low", () => {
		assert.ok(!hasLowAlpha({ r: 255, g: 255, b: 255, a: 0.8 }));
		assert.ok(!hasLowAlpha({ r: 255, g: 255, b: 255, a: 1.0 }));
	});

	test("undefined alpha is not low", () => {
		assert.ok(!hasLowAlpha({ r: 255, g: 255, b: 255 }));
	});
});

describe("buildCidResolver (#224 PR 2)", () => {
	const PARTS = [
		{
			contentId: "<inline-1@example.com>",
			contentUrl:
				"https://cdn.test/content/accounts/cfg/acc/messages/m/parts/1",
		},
		{
			contentId: "inline-2@example.com",
			contentUrl:
				"https://cdn.test/content/accounts/cfg/acc/messages/m/parts/2",
		},
		{ contentUrl: "https://cdn.test/no-cid/parts/3" },
		{
			contentId: "<inline-blank>",
			contentUrl: "",
		},
	];

	test("looks up the URL by Content-ID, stripping angle brackets on both sides", () => {
		const resolve = buildCidResolver(PARTS);
		assert.equal(
			resolve("inline-1@example.com"),
			"https://cdn.test/content/accounts/cfg/acc/messages/m/parts/1",
		);
		assert.equal(
			resolve("<inline-1@example.com>"),
			"https://cdn.test/content/accounts/cfg/acc/messages/m/parts/1",
		);
	});

	test("matches Content-IDs that came in without angle brackets", () => {
		const resolve = buildCidResolver(PARTS);
		assert.equal(
			resolve("inline-2@example.com"),
			"https://cdn.test/content/accounts/cfg/acc/messages/m/parts/2",
		);
	});

	test("returns undefined when no body part has a matching Content-ID — fail-loud, do not silently substitute", () => {
		const resolve = buildCidResolver(PARTS);
		assert.equal(resolve("missing@example.com"), undefined);
	});

	test("skips parts without a contentId or with an empty contentUrl", () => {
		const resolve = buildCidResolver(PARTS);
		assert.equal(resolve("inline-blank"), undefined);
	});

	test("empty body-part list returns a resolver that always returns undefined", () => {
		const resolve = buildCidResolver([]);
		assert.equal(resolve("anything"), undefined);
	});
});
