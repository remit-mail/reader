// Renders the installable app's icon set from the one committed source image.
//
// The source is 460x460, which is the full resolution the mark exists at. Every
// target at or below that is a lanczos downscale; a target above it is reached
// by padding the canvas with the mark's own background colour, never by
// interpolating pixels upward — 512 is exactly the size Android uses for the
// install splash, where a 460 upscale reads as soft.
//
// The background colour is sampled from the source rather than hardcoded, so a
// new mark carries its own ground through the padding and the maskable safe
// zone. The sampled hex is printed: `background_color` in the manifest is the
// same value and has to be changed with it.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import sharp from "sharp";

const SOURCE = "packages/web-client/brand/remit-mark.png";
const PUBLIC_DIR = "packages/web-client/public";

// Android masks an adaptive icon down to an arbitrary shape and guarantees only
// the central 80%. The mark fills its frame edge to edge, so the maskable
// variant is the artwork shrunk into that zone with ground around it.
const MASKABLE_SAFE_ZONE = 0.8;

const ICO_SIZES = [32, 16];

const toHex = (r, g, b) =>
	`#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;

const sampleGround = (data, info) => {
	const counts = new Map();
	const border = 8;
	for (let y = 0; y < info.height; y += 1) {
		for (let x = 0; x < info.width; x += 1) {
			const inside =
				x >= border &&
				x < info.width - border &&
				y >= border &&
				y < info.height - border;
			if (inside) continue;
			const offset = (y * info.width + x) * info.channels;
			const key = `${data[offset]},${data[offset + 1]},${data[offset + 2]}`;
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}
	const [dominant] = [...counts].sort((a, b) => b[1] - a[1])[0];
	const [r, g, b] = dominant.split(",").map(Number);
	return { r, g, b, alpha: 1 };
};

const centred = (outer, inner) => {
	const pad = outer - inner;
	const left = Math.floor(pad / 2);
	const top = Math.floor(pad / 2);
	return {
		left,
		top,
		right: pad - left,
		bottom: pad - top,
	};
};

const render = (source, sourceSize, size, background) => {
	if (size <= sourceSize) {
		return sharp(source).resize(size, size, { kernel: "lanczos3" });
	}
	return sharp(source).extend({ ...centred(size, sourceSize), background });
};

const renderMaskable = (source, size, background) => {
	const inner = Math.round(size * MASKABLE_SAFE_ZONE);
	return sharp(source)
		.resize(inner, inner, { kernel: "lanczos3" })
		.extend({ ...centred(size, inner), background });
};

const png = (pipeline) =>
	pipeline.png({ compressionLevel: 9, palette: false }).toBuffer();

// An .ico is a directory of whole images: a 6-byte header, one 16-byte entry per
// size, then the image payloads. PNG payloads are read by every browser that has
// shipped this decade, so the entries are the PNGs above rather than BMPs.
const buildIco = (images) => {
	const header = Buffer.alloc(6);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(images.length, 4);

	const directory = Buffer.alloc(16 * images.length);
	let offset = header.length + directory.length;
	images.forEach(({ size, data }, index) => {
		const entry = index * 16;
		directory.writeUInt8(size % 256, entry);
		directory.writeUInt8(size % 256, entry + 1);
		directory.writeUInt8(0, entry + 2);
		directory.writeUInt8(0, entry + 3);
		directory.writeUInt16LE(1, entry + 4);
		directory.writeUInt16LE(32, entry + 6);
		directory.writeUInt32LE(data.length, entry + 8);
		directory.writeUInt32LE(offset, entry + 12);
		offset += data.length;
	});

	return Buffer.concat([header, directory, ...images.map(({ data }) => data)]);
};

const write = async (repoRoot, relativePath, data) => {
	const target = join(repoRoot, relativePath);
	await mkdir(dirname(target), { recursive: true });
	await writeFile(target, data);
	console.log(`${relativePath}  ${(data.length / 1024).toFixed(1)} KiB`);
};

const repoRoot = process.argv[2] ?? process.cwd();
const source = join(repoRoot, SOURCE);
const { width, height } = await sharp(source).metadata();
if (width !== height) {
	throw new Error(
		`${SOURCE} is ${width}x${height}, and the mark has to be square`,
	);
}

const { data, info } = await sharp(source)
	.removeAlpha()
	.raw()
	.toBuffer({ resolveWithObject: true });
const background = sampleGround(data, info);
console.log(
	`ground sampled from ${SOURCE}: ${toHex(background.r, background.g, background.b)}`,
);

for (const [size, path] of [
	[192, `${PUBLIC_DIR}/icons/icon-192.png`],
	[512, `${PUBLIC_DIR}/icons/icon-512.png`],
	[180, `${PUBLIC_DIR}/apple-touch-icon.png`],
]) {
	await write(
		repoRoot,
		path,
		await png(render(source, width, size, background)),
	);
}

await write(
	repoRoot,
	`${PUBLIC_DIR}/icons/icon-maskable-512.png`,
	await png(renderMaskable(source, 512, background)),
);

const icoImages = [];
for (const size of ICO_SIZES) {
	icoImages.push({
		size,
		data: await png(render(source, width, size, background)),
	});
}
await write(repoRoot, `${PUBLIC_DIR}/favicon.ico`, buildIco(icoImages));
