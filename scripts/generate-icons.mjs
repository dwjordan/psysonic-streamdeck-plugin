// Generates simple solid-colour placeholder PNGs for the plugin/actions.
// The Now Playing button repaints itself with real album art at runtime;
// these are just the defaults shown in the Stream Deck action list.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

function crc32(buf) {
	let c = ~0;
	for (let i = 0; i < buf.length; i++) {
		c ^= buf[i];
		for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
	}
	return (~c) >>> 0;
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length, 0);
	const t = Buffer.from(type, "ascii");
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
	return Buffer.concat([len, t, data, crc]);
}

function png(w, h, [r, g, b, a]) {
	const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // colour type RGBA
	const row = Buffer.alloc(1 + w * 4);
	for (let x = 0; x < w; x++) {
		const o = 1 + x * 4;
		row[o] = r;
		row[o + 1] = g;
		row[o + 2] = b;
		row[o + 3] = a;
	}
	const raw = Buffer.concat(Array.from({ length: h }, () => row));
	return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const BLUE = [46, 120, 210, 255];
const DARK = [32, 34, 42, 255];
const GREEN = [42, 160, 110, 255];

function out(path, size, colour) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, png(size, size, colour));
}

const B = "com.dwjordan.psysonic.sdPlugin/imgs";
out(`${B}/plugin/marketplace.png`, 256, DARK);
out(`${B}/plugin/marketplace@2x.png`, 512, DARK);
out(`${B}/plugin/category-icon.png`, 28, BLUE);
out(`${B}/plugin/category-icon@2x.png`, 56, BLUE);
out(`${B}/actions/nowplaying/icon.png`, 20, BLUE);
out(`${B}/actions/nowplaying/icon@2x.png`, 40, BLUE);
out(`${B}/actions/nowplaying/key.png`, 72, DARK);
out(`${B}/actions/nowplaying/key@2x.png`, 144, DARK);
out(`${B}/actions/skip/icon.png`, 20, GREEN);
out(`${B}/actions/skip/icon@2x.png`, 40, GREEN);
out(`${B}/actions/skip/key.png`, 72, GREEN);
out(`${B}/actions/skip/key@2x.png`, 144, GREEN);

console.log("icons generated");
