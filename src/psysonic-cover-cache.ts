import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CACHE_ROOT = path.join(
	os.homedir(),
	"Library/Application Support/dev.psysonic.player/cover-cache",
);

/** Turn `192.168.0.196:4533` into the folder name Psysonic uses for cover-cache. */
function serverCacheKey(serverName: string): string {
	return serverName.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "").replace(":", "_");
}

function coverArtCandidates(coverArtId: string, albumId?: string): string[] {
	const ids = new Set<string>();
	const add = (value?: string): void => {
		const id = value?.trim();
		if (id) {
			ids.add(id);
		}
	};

	add(coverArtId);
	add(albumId);

	// Disc-style ids look like `dc-<albumId>:1_0` — the album folder uses the raw album id.
	if (coverArtId.startsWith("dc-")) {
		const inner = coverArtId.slice(3).split(":")[0];
		add(inner);
	}

	return [...ids];
}

/**
 * Read album art Psysonic already downloaded to its local cover-cache.
 * No Navidrome credentials required.
 */
export async function coverArtFromPsysonicCache(
	serverName: string | undefined,
	coverArtId: string,
	albumId?: string,
): Promise<string | null> {
	if (!serverName?.trim()) {
		return null;
	}

	const serverDir = path.join(CACHE_ROOT, serverCacheKey(serverName), "album");
	for (const id of coverArtCandidates(coverArtId, albumId)) {
		for (const size of [256, 128, 512]) {
			const filePath = path.join(serverDir, id, `${size}.webp`);
			try {
				const buffer = await readFile(filePath);
				if (buffer.length > 0) {
					return `data:image/webp;base64,${buffer.toString("base64")}`;
				}
			} catch {
				// try next size / id
			}
		}
	}

	return null;
}
