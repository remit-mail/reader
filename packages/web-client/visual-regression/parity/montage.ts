/**
 * parity:montage — stitch live|story capture pairs into labelled side-by-side images.
 *
 * Reads:  tmp/parity/<surface>/<state>__<viewport>__<theme>.{live,story}.png
 * Writes: tmp/parity/_montage/<surface>/<state>__<viewport>__<theme>.png
 *
 * When the story side is missing, emits the live panel alone with a
 * "no design" marker rather than failing.
 */

import { createReadStream, existsSync, mkdirSync, readdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PARITY_DIR = path.join(REPO_ROOT, "tmp/parity");
const MONTAGE_DIR = path.join(PARITY_DIR, "_montage");

const HEADER_HEIGHT = 40;
const DIVIDER_WIDTH = 4;
const LABEL_FONT_SIZE = 14; // px — used for guide only; we draw with a bitmap font

// Minimal 8×13 bitmap font for ASCII printable chars (space–tilde).
// Each char is 8 wide × 13 tall, stored as 13 bytes (1 bit per pixel, MSB first).
// Generated from the classic IBM 8×13 public-domain bitmap.
const FONT_W = 8;
const FONT_H = 13;
// prettier-ignore
const FONT: Readonly<Uint8Array> = new Uint8Array([
	// 0x20 space
	0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
	// 0x21 !
	0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0, 0x18, 0x18, 0, 0, 0,
	// 0x22 "
	0x6c, 0x6c, 0x6c, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
	// 0x23 #
	0x6c, 0x6c, 0xfe, 0x6c, 0xfe, 0x6c, 0x6c, 0, 0, 0, 0, 0, 0,
	// 0x24 $
	0x18, 0x7e, 0xd8, 0x7e, 0x1b, 0x7e, 0x18, 0, 0, 0, 0, 0, 0,
	// 0x25 %
	0xc6, 0xcc, 0x18, 0x30, 0x66, 0xc6, 0, 0, 0, 0, 0, 0, 0,
	// 0x26 &
	0x38, 0x6c, 0x6c, 0x76, 0xdc, 0xce, 0x77, 0, 0, 0, 0, 0, 0,
	// 0x27 '
	0x30, 0x30, 0x60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
	// 0x28 (
	0x0c, 0x18, 0x30, 0x30, 0x30, 0x18, 0x0c, 0, 0, 0, 0, 0, 0,
	// 0x29 )
	0x30, 0x18, 0x0c, 0x0c, 0x0c, 0x18, 0x30, 0, 0, 0, 0, 0, 0,
	// 0x2a *
	0, 0x66, 0x3c, 0xff, 0x3c, 0x66, 0, 0, 0, 0, 0, 0, 0,
	// 0x2b +
	0, 0x18, 0x18, 0x7e, 0x18, 0x18, 0, 0, 0, 0, 0, 0, 0,
	// 0x2c ,
	0, 0, 0, 0, 0, 0x30, 0x30, 0x60, 0, 0, 0, 0, 0,
	// 0x2d -
	0, 0, 0, 0x7e, 0, 0, 0, 0, 0, 0, 0, 0, 0,
	// 0x2e .
	0, 0, 0, 0, 0, 0x30, 0x30, 0, 0, 0, 0, 0, 0,
	// 0x2f /
	0x06, 0x0c, 0x18, 0x30, 0x60, 0xc0, 0x80, 0, 0, 0, 0, 0, 0,
	// 0x30 0
	0x7c, 0xc6, 0xce, 0xde, 0xf6, 0xe6, 0x7c, 0, 0, 0, 0, 0, 0,
	// 0x31 1
	0x18, 0x38, 0x18, 0x18, 0x18, 0x18, 0x7e, 0, 0, 0, 0, 0, 0,
	// 0x32 2
	0x7c, 0xc6, 0x06, 0x1c, 0x70, 0xc6, 0xfe, 0, 0, 0, 0, 0, 0,
	// 0x33 3
	0x7c, 0xc6, 0x06, 0x3c, 0x06, 0xc6, 0x7c, 0, 0, 0, 0, 0, 0,
	// 0x34 4
	0x1c, 0x3c, 0x6c, 0xcc, 0xfe, 0x0c, 0x1e, 0, 0, 0, 0, 0, 0,
	// 0x35 5
	0xfe, 0xc0, 0xfc, 0x06, 0x06, 0xc6, 0x7c, 0, 0, 0, 0, 0, 0,
	// 0x36 6
	0x38, 0x60, 0xc0, 0xfc, 0xc6, 0xc6, 0x7c, 0, 0, 0, 0, 0, 0,
	// 0x37 7
	0xfe, 0xc6, 0x0c, 0x18, 0x30, 0x30, 0x30, 0, 0, 0, 0, 0, 0,
	// 0x38 8
	0x7c, 0xc6, 0xc6, 0x7c, 0xc6, 0xc6, 0x7c, 0, 0, 0, 0, 0, 0,
	// 0x39 9
	0x7c, 0xc6, 0xc6, 0x7e, 0x06, 0x0c, 0x70, 0, 0, 0, 0, 0, 0,
	// 0x3a :
	0, 0, 0x30, 0x30, 0, 0x30, 0x30, 0, 0, 0, 0, 0, 0,
	// 0x3b ;
	0, 0, 0x30, 0x30, 0, 0x30, 0x30, 0x60, 0, 0, 0, 0, 0,
	// 0x3c <
	0x0e, 0x1c, 0x38, 0x70, 0x38, 0x1c, 0x0e, 0, 0, 0, 0, 0, 0,
	// 0x3d =
	0, 0, 0x7e, 0, 0x7e, 0, 0, 0, 0, 0, 0, 0, 0,
	// 0x3e >
	0x70, 0x38, 0x1c, 0x0e, 0x1c, 0x38, 0x70, 0, 0, 0, 0, 0, 0,
	// 0x3f ?
	0x7c, 0xc6, 0x06, 0x1c, 0x18, 0, 0x18, 0, 0, 0, 0, 0, 0,
	// 0x40 @
	0x7c, 0xc6, 0xde, 0xde, 0xde, 0xc0, 0x7e, 0, 0, 0, 0, 0, 0,
	// 0x41 A
	0x38, 0x6c, 0xc6, 0xfe, 0xc6, 0xc6, 0xc6, 0, 0, 0, 0, 0, 0,
	// 0x42 B
	0xfc, 0xc6, 0xc6, 0xfc, 0xc6, 0xc6, 0xfc, 0, 0, 0, 0, 0, 0,
	// 0x43 C
	0x7c, 0xc6, 0xc0, 0xc0, 0xc0, 0xc6, 0x7c, 0, 0, 0, 0, 0, 0,
	// 0x44 D
	0xf8, 0xcc, 0xc6, 0xc6, 0xc6, 0xcc, 0xf8, 0, 0, 0, 0, 0, 0,
	// 0x45 E
	0xfe, 0xc0, 0xc0, 0xf8, 0xc0, 0xc0, 0xfe, 0, 0, 0, 0, 0, 0,
	// 0x46 F
	0xfe, 0xc0, 0xc0, 0xf8, 0xc0, 0xc0, 0xc0, 0, 0, 0, 0, 0, 0,
	// 0x47 G
	0x7c, 0xc6, 0xc0, 0xde, 0xc6, 0xc6, 0x7c, 0, 0, 0, 0, 0, 0,
	// 0x48 H
	0xc6, 0xc6, 0xc6, 0xfe, 0xc6, 0xc6, 0xc6, 0, 0, 0, 0, 0, 0,
	// 0x49 I
	0x7e, 0x18, 0x18, 0x18, 0x18, 0x18, 0x7e, 0, 0, 0, 0, 0, 0,
	// 0x4a J
	0x06, 0x06, 0x06, 0x06, 0xc6, 0xc6, 0x7c, 0, 0, 0, 0, 0, 0,
	// 0x4b K
	0xc6, 0xcc, 0xd8, 0xf0, 0xd8, 0xcc, 0xc6, 0, 0, 0, 0, 0, 0,
	// 0x4c L
	0xc0, 0xc0, 0xc0, 0xc0, 0xc0, 0xc0, 0xfe, 0, 0, 0, 0, 0, 0,
	// 0x4d M
	0xc6, 0xee, 0xfe, 0xd6, 0xc6, 0xc6, 0xc6, 0, 0, 0, 0, 0, 0,
	// 0x4e N
	0xc6, 0xe6, 0xf6, 0xde, 0xce, 0xc6, 0xc6, 0, 0, 0, 0, 0, 0,
	// 0x4f O
	0x7c, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0x7c, 0, 0, 0, 0, 0, 0,
	// 0x50 P
	0xfc, 0xc6, 0xc6, 0xfc, 0xc0, 0xc0, 0xc0, 0, 0, 0, 0, 0, 0,
	// 0x51 Q
	0x7c, 0xc6, 0xc6, 0xc6, 0xd6, 0xcc, 0x76, 0, 0, 0, 0, 0, 0,
	// 0x52 R
	0xfc, 0xc6, 0xc6, 0xfc, 0xd8, 0xcc, 0xc6, 0, 0, 0, 0, 0, 0,
	// 0x53 S
	0x7c, 0xc6, 0xc0, 0x7c, 0x06, 0xc6, 0x7c, 0, 0, 0, 0, 0, 0,
	// 0x54 T
	0x7e, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0, 0, 0, 0, 0, 0,
	// 0x55 U
	0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0x7c, 0, 0, 0, 0, 0, 0,
	// 0x56 V
	0xc6, 0xc6, 0xc6, 0xc6, 0xc6, 0x6c, 0x38, 0, 0, 0, 0, 0, 0,
	// 0x57 W
	0xc6, 0xc6, 0xd6, 0xd6, 0xfe, 0xee, 0xc6, 0, 0, 0, 0, 0, 0,
	// 0x58 X
	0xc6, 0x6c, 0x38, 0x38, 0x38, 0x6c, 0xc6, 0, 0, 0, 0, 0, 0,
	// 0x59 Y
	0x66, 0x66, 0x66, 0x3c, 0x18, 0x18, 0x18, 0, 0, 0, 0, 0, 0,
	// 0x5a Z
	0xfe, 0x06, 0x0c, 0x18, 0x30, 0x60, 0xfe, 0, 0, 0, 0, 0, 0,
	// 0x5b [
	0x3c, 0x30, 0x30, 0x30, 0x30, 0x30, 0x3c, 0, 0, 0, 0, 0, 0,
	// 0x5c backslash
	0xc0, 0x60, 0x30, 0x18, 0x0c, 0x06, 0x02, 0, 0, 0, 0, 0, 0,
	// 0x5d ]
	0x3c, 0x0c, 0x0c, 0x0c, 0x0c, 0x0c, 0x3c, 0, 0, 0, 0, 0, 0,
	// 0x5e ^
	0x10, 0x38, 0x6c, 0xc6, 0, 0, 0, 0, 0, 0, 0, 0, 0,
	// 0x5f _
	0, 0, 0, 0, 0, 0, 0xff, 0, 0, 0, 0, 0, 0,
	// 0x60 `
	0x30, 0x18, 0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
	// 0x61 a
	0, 0, 0x7c, 0x06, 0x7e, 0xc6, 0x7e, 0, 0, 0, 0, 0, 0,
	// 0x62 b
	0xc0, 0xc0, 0xfc, 0xc6, 0xc6, 0xc6, 0xfc, 0, 0, 0, 0, 0, 0,
	// 0x63 c
	0, 0, 0x7c, 0xc6, 0xc0, 0xc6, 0x7c, 0, 0, 0, 0, 0, 0,
	// 0x64 d
	0x06, 0x06, 0x7e, 0xc6, 0xc6, 0xc6, 0x7e, 0, 0, 0, 0, 0, 0,
	// 0x65 e
	0, 0, 0x7c, 0xc6, 0xfe, 0xc0, 0x7c, 0, 0, 0, 0, 0, 0,
	// 0x66 f
	0x1c, 0x30, 0x7c, 0x30, 0x30, 0x30, 0x30, 0, 0, 0, 0, 0, 0,
	// 0x67 g
	0, 0, 0x7e, 0xc6, 0xc6, 0x7e, 0x06, 0x7c, 0, 0, 0, 0, 0,
	// 0x68 h
	0xc0, 0xc0, 0xfc, 0xc6, 0xc6, 0xc6, 0xc6, 0, 0, 0, 0, 0, 0,
	// 0x69 i
	0x18, 0, 0x38, 0x18, 0x18, 0x18, 0x3c, 0, 0, 0, 0, 0, 0,
	// 0x6a j
	0x06, 0, 0x06, 0x06, 0x06, 0xc6, 0xc6, 0x7c, 0, 0, 0, 0, 0,
	// 0x6b k
	0xc0, 0xc0, 0xcc, 0xd8, 0xf8, 0xd8, 0xcc, 0, 0, 0, 0, 0, 0,
	// 0x6c l
	0x38, 0x18, 0x18, 0x18, 0x18, 0x18, 0x3c, 0, 0, 0, 0, 0, 0,
	// 0x6d m
	0, 0, 0xec, 0xfe, 0xd6, 0xc6, 0xc6, 0, 0, 0, 0, 0, 0,
	// 0x6e n
	0, 0, 0xdc, 0xe6, 0xc6, 0xc6, 0xc6, 0, 0, 0, 0, 0, 0,
	// 0x6f o
	0, 0, 0x7c, 0xc6, 0xc6, 0xc6, 0x7c, 0, 0, 0, 0, 0, 0,
	// 0x70 p
	0, 0, 0xfc, 0xc6, 0xc6, 0xfc, 0xc0, 0xc0, 0, 0, 0, 0, 0,
	// 0x71 q
	0, 0, 0x7e, 0xc6, 0xc6, 0x7e, 0x06, 0x06, 0, 0, 0, 0, 0,
	// 0x72 r
	0, 0, 0xdc, 0xe6, 0xc0, 0xc0, 0xc0, 0, 0, 0, 0, 0, 0,
	// 0x73 s
	0, 0, 0x7c, 0xc0, 0x7c, 0x06, 0xfc, 0, 0, 0, 0, 0, 0,
	// 0x74 t
	0x30, 0x30, 0xfc, 0x30, 0x30, 0x30, 0x1c, 0, 0, 0, 0, 0, 0,
	// 0x75 u
	0, 0, 0xc6, 0xc6, 0xc6, 0xce, 0x76, 0, 0, 0, 0, 0, 0,
	// 0x76 v
	0, 0, 0xc6, 0xc6, 0xc6, 0x6c, 0x38, 0, 0, 0, 0, 0, 0,
	// 0x77 w
	0, 0, 0xc6, 0xc6, 0xd6, 0xfe, 0x6c, 0, 0, 0, 0, 0, 0,
	// 0x78 x
	0, 0, 0xc6, 0x6c, 0x38, 0x6c, 0xc6, 0, 0, 0, 0, 0, 0,
	// 0x79 y
	0, 0, 0xc6, 0xc6, 0x7e, 0x06, 0x7c, 0, 0, 0, 0, 0, 0,
	// 0x7a z
	0, 0, 0xfe, 0x0c, 0x18, 0x30, 0xfe, 0, 0, 0, 0, 0, 0,
	// 0x7b {
	0x0e, 0x18, 0x18, 0x70, 0x18, 0x18, 0x0e, 0, 0, 0, 0, 0, 0,
	// 0x7c |
	0x18, 0x18, 0x18, 0, 0x18, 0x18, 0x18, 0, 0, 0, 0, 0, 0,
	// 0x7d }
	0x70, 0x18, 0x18, 0x0e, 0x18, 0x18, 0x70, 0, 0, 0, 0, 0, 0,
	// 0x7e ~
	0x76, 0xdc, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);

function drawText(
	out: PNG,
	text: string,
	x: number,
	y: number,
	r: number,
	g: number,
	b: number,
): void {
	for (let ci = 0; ci < text.length; ci++) {
		const code = text.charCodeAt(ci);
		if (code < 0x20 || code > 0x7e) continue;
		const glyphBase = (code - 0x20) * FONT_H;
		for (let row = 0; row < FONT_H; row++) {
			const bits = FONT[glyphBase + row];
			for (let col = 0; col < FONT_W; col++) {
				if (bits & (0x80 >> col)) {
					const px = x + ci * FONT_W + col;
					const py = y + row;
					if (px < 0 || px >= out.width || py < 0 || py >= out.height) continue;
					const idx = (py * out.width + px) * 4;
					out.data[idx] = r;
					out.data[idx + 1] = g;
					out.data[idx + 2] = b;
					out.data[idx + 3] = 255;
				}
			}
		}
	}
}

function loadPng(filePath: string): Promise<PNG> {
	return new Promise((resolve, reject) => {
		const png = new PNG();
		createReadStream(filePath)
			.pipe(png)
			.on("parsed", () => resolve(png))
			.on("error", reject);
	});
}

function buildMontage(live: PNG, story: PNG | null, label: string): PNG {
	const panelW = Math.max(live.width, story?.width ?? 0);
	const panelH = Math.max(live.height, story?.height ?? 0);
	const panelCount = 2; // always two columns; right may be empty/placeholder
	const totalW = panelW * panelCount + DIVIDER_WIDTH;
	const totalH = HEADER_HEIGHT + panelH;

	const out = new PNG({ width: totalW, height: totalH, colorType: 2 });

	// Fill background: white
	out.data.fill(255);
	// Set alpha to 255 everywhere
	for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;

	// Draw divider (dark grey)
	const divX = panelW;
	for (let py = 0; py < totalH; py++) {
		for (let dx = 0; dx < DIVIDER_WIDTH; dx++) {
			const idx = (py * totalW + divX + dx) * 4;
			out.data[idx] = 80;
			out.data[idx + 1] = 80;
			out.data[idx + 2] = 80;
			out.data[idx + 3] = 255;
		}
	}

	// Draw header background (dark blue-grey)
	for (let py = 0; py < HEADER_HEIGHT; py++) {
		for (let px = 0; px < totalW; px++) {
			const idx = (py * totalW + px) * 4;
			out.data[idx] = 30;
			out.data[idx + 1] = 40;
			out.data[idx + 2] = 60;
			out.data[idx + 3] = 255;
		}
	}

	// Draw label text in header
	const textY = Math.floor((HEADER_HEIGHT - FONT_H) / 2);
	drawText(out, label, 8, textY, 220, 220, 255);

	// Draw column captions: "live" left, "story" right (or "no design")
	const rightCaption = story ? "story" : "no design";
	const rightCaptionX = panelW + DIVIDER_WIDTH + 8;
	drawText(out, "live", 8, textY, 120, 220, 120);
	drawText(
		out,
		rightCaption,
		rightCaptionX,
		textY,
		story ? 120 : 180,
		story ? 180 : 120,
		story ? 220 : 120,
	);

	// Blit live panel
	blitPanel(live, out, 0, HEADER_HEIGHT, panelW, panelH);

	// Blit story panel or placeholder
	const storyX = panelW + DIVIDER_WIDTH;
	if (story) {
		blitPanel(story, out, storyX, HEADER_HEIGHT, panelW, panelH);
	} else {
		drawNoDesignPlaceholder(out, storyX, HEADER_HEIGHT, panelW, panelH);
	}

	return out;
}

function blitPanel(
	src: PNG,
	dst: PNG,
	offsetX: number,
	offsetY: number,
	panelW: number,
	panelH: number,
): void {
	// Centre within panel if smaller
	const dx = Math.floor((panelW - src.width) / 2);
	const dy = Math.floor((panelH - src.height) / 2);
	for (let sy = 0; sy < src.height; sy++) {
		for (let sx = 0; sx < src.width; sx++) {
			const si = (sy * src.width + sx) * 4;
			const di = ((offsetY + dy + sy) * dst.width + offsetX + dx + sx) * 4;
			if (di < 0 || di + 3 >= dst.data.length) continue;
			const a = src.data[si + 3] / 255;
			dst.data[di] = Math.round(src.data[si] * a + dst.data[di] * (1 - a));
			dst.data[di + 1] = Math.round(
				src.data[si + 1] * a + dst.data[di + 1] * (1 - a),
			);
			dst.data[di + 2] = Math.round(
				src.data[si + 2] * a + dst.data[di + 2] * (1 - a),
			);
			dst.data[di + 3] = 255;
		}
	}
}

function drawNoDesignPlaceholder(
	out: PNG,
	x: number,
	y: number,
	w: number,
	h: number,
): void {
	// Light grey fill
	for (let py = y; py < y + h; py++) {
		for (let px = x; px < x + w; px++) {
			const idx = (py * out.width + px) * 4;
			out.data[idx] = 230;
			out.data[idx + 1] = 230;
			out.data[idx + 2] = 230;
			out.data[idx + 3] = 255;
		}
	}
	const msg = "no design";
	const tx = x + Math.floor((w - msg.length * FONT_W) / 2);
	const ty = y + Math.floor((h - FONT_H) / 2);
	drawText(out, msg, tx, ty, 120, 120, 120);
}

function pngToBuffer(png: PNG): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		png
			.pack()
			.on("data", (chunk: Buffer) => chunks.push(chunk))
			.on("end", () => resolve(Buffer.concat(chunks)))
			.on("error", reject);
	});
}

interface Pair {
	surface: string;
	stem: string; // <state>__<viewport>__<theme>
	livePath: string;
	storyPath: string | null;
}

function collectPairs(): Pair[] {
	if (!existsSync(PARITY_DIR)) {
		console.error(`tmp/parity directory not found: ${PARITY_DIR}`);
		return [];
	}

	const pairs: Pair[] = [];
	for (const entry of readdirSync(PARITY_DIR, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name === "_montage") continue;
		const surface = entry.name;
		const surfaceDir = path.join(PARITY_DIR, surface);
		const files = readdirSync(surfaceDir);

		// Find all .live.png files and pair them with .story.png if present
		for (const file of files) {
			if (!file.endsWith(".live.png")) continue;
			const stem = file.replace(/\.live\.png$/, "");
			const storyFile = `${stem}.story.png`;
			pairs.push({
				surface,
				stem,
				livePath: path.join(surfaceDir, file),
				storyPath: files.includes(storyFile)
					? path.join(surfaceDir, storyFile)
					: null,
			});
		}
	}
	return pairs;
}

function buildLabel(surface: string, stem: string): string {
	// stem is <state>__<viewport>__<theme>
	const parts = stem.split("__");
	const [state = stem, viewport = "", theme = ""] = parts;
	const chunks = [surface, state, viewport, theme].filter(Boolean);
	return chunks.join(" \xB7 "); // middle dot
}

async function processPair(pair: Pair): Promise<void> {
	const outDir = path.join(MONTAGE_DIR, pair.surface);
	mkdirSync(outDir, { recursive: true });
	const outPath = path.join(outDir, `${pair.stem}.png`);

	const [live, story] = await Promise.all([
		loadPng(pair.livePath),
		pair.storyPath ? loadPng(pair.storyPath) : Promise.resolve(null),
	]);

	const label = buildLabel(pair.surface, pair.stem);
	const montage = buildMontage(live, story, label);
	const buf = await pngToBuffer(montage);
	await writeFile(outPath, buf);
	console.log(`  wrote ${path.relative(REPO_ROOT, outPath)}`);
}

async function main(): Promise<void> {
	const pairs = collectPairs();
	if (pairs.length === 0) {
		console.log("No .live.png files found under tmp/parity/. Nothing to do.");
		return;
	}
	console.log(`Montaging ${pairs.length} pair(s)...`);
	for (const pair of pairs) {
		await processPair(pair);
	}
	console.log("Done.");
}

main().catch((err: unknown) => {
	console.error(err);
	process.exit(1);
});
