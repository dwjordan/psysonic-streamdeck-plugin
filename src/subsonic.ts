import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * Connection settings shared by the actions, edited in the Property Inspector.
 * Used to fetch album art from the Subsonic-compatible server Psysonic streams from.
 */
export type ConnectionSettings = {
	serverUrl?: string;
	username?: string;
	password?: string;
};

/**
 * Thin client for the Subsonic / OpenSubsonic REST API (Navidrome, Gonic, etc.).
 * Uses token authentication (salted MD5) so the plaintext password is never sent.
 */
export class SubsonicClient {
	constructor(
		private readonly baseUrl: string,
		private readonly username: string,
		private readonly password: string,
		private readonly clientName = "streamdeck-psysonic",
	) {}

	private authParams(): URLSearchParams {
		const salt = randomBytes(6).toString("hex");
		const token = createHash("md5").update(this.password + salt).digest("hex");
		return new URLSearchParams({
			u: this.username,
			t: token,
			s: salt,
			v: "1.16.1",
			c: this.clientName,
			f: "json",
		});
	}

	private url(endpoint: string, extra: Record<string, string | number> = {}): string {
		const params = this.authParams();
		for (const [key, value] of Object.entries(extra)) {
			params.set(key, String(value));
		}
		const base = this.baseUrl.replace(/\/+$/, "");
		return `${base}/rest/${endpoint}?${params.toString()}`;
	}

	/** Fetch cover art and return it as a data URI ready for Stream Deck's setImage. */
	async coverArtDataUri(id: string, size = 144): Promise<string | null> {
		const url = this.url("getCoverArt", { id, size });
		const fromCurl = await this.coverArtViaCurl(url);
		if (fromCurl) {
			return fromCurl;
		}
		return this.coverArtViaFetch(url);
	}

	private async coverArtViaFetch(url: string): Promise<string | null> {
		try {
			const res = await fetchResilient(url);
			if (!res.ok) {
				return null;
			}
			const contentType = res.headers.get("content-type") ?? "image/jpeg";
			if (contentType.includes("json")) {
				return null;
			}
			const buffer = Buffer.from(await res.arrayBuffer());
			if (!buffer.length) {
				return null;
			}
			return `data:${contentType};base64,${buffer.toString("base64")}`;
		} catch {
			return null;
		}
	}

	/** Fallback when Node's fetch flakes right after Stream Deck reconnects. */
	private async coverArtViaCurl(url: string): Promise<string | null> {
		try {
			const { stdout } = await run(
				"/usr/bin/curl",
				["-sfL", "--max-time", "10", "-H", "Connection: close", url],
				{ encoding: "buffer", maxBuffer: 8 * 1024 * 1024, timeout: 12000 },
			);
			if (!stdout?.length || stdout[0] === 0x7b) {
				return null;
			}
			return `data:image/jpeg;base64,${stdout.toString("base64")}`;
		} catch {
			return null;
		}
	}
}

/** Build a client from Property Inspector settings, or null if not configured yet. */
export function clientFromSettings(settings: ConnectionSettings): SubsonicClient | null {
	const serverUrl = normalizeServerUrl(settings.serverUrl ?? "");
	if (!serverUrl || !settings.username || !settings.password) {
		return null;
	}
	return new SubsonicClient(serverUrl, settings.username, settings.password);
}

function normalizeServerUrl(raw: string): string {
	const url = raw.trim();
	if (!url) {
		return "";
	}
	if (!/^https?:\/\//i.test(url)) {
		return `http://${url}`;
	}
	return url;
}

const FETCH_OPTS: RequestInit = {
	headers: { Connection: "close" },
};

/**
 * `fetch` with retries. Node's global fetch pools keep-alive sockets; a home
 * server that closes idle connections leaves a dead socket in the pool, and the
 * next reuse fails with ECONNRESET — especially right after Stream Deck restarts.
 */
async function fetchResilient(url: string): Promise<Response> {
	let last: unknown;
	for (let attempt = 0; attempt < 5; attempt++) {
		try {
			return await fetch(url, FETCH_OPTS);
		} catch (err) {
			last = err;
			if (attempt < 4) {
				await delay(250 * (attempt + 1));
			}
		}
	}
	throw last;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
