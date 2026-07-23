import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Default location of the Psysonic CLI binary inside the app bundle (macOS). */
export const DEFAULT_PSYSONIC_BIN = "/Applications/Psysonic.app/Contents/MacOS/psysonic";

export type PsysonicTrack = {
	id?: string;
	title?: string;
	artist?: string;
	album?: string;
	albumId?: string;
	/** Track length in seconds, when the snapshot reports it. */
	duration?: number;
	/** Subsonic cover-art id — resolvable against the same server Psysonic streams from. */
	coverArt?: string;
};

export type PsysonicSnapshot = {
	isPlaying: boolean;
	/** Playhead position in seconds. Advances only while the snapshot is live. */
	currentTime: number;
	queueLength: number;
	track: PsysonicTrack | null;
	/** Navidrome/Subsonic base URL inferred from the active server entry. */
	serverUrl?: string;
	/** Host/port label from the active server, e.g. `192.168.0.196:4533`. */
	serverName?: string;
};

/**
 * Controls a local Psysonic desktop client via its bundled CLI.
 *
 * Important behaviours the callers rely on:
 * - `--info` reads a JSON snapshot the GUI republishes on events *while its window
 *   is loaded*. When Psysonic is backgrounded the file can go stale (frozen
 *   `currentTime`, wrong `isPlaying`), so callers treat it as a hint, not truth.
 * - Playback control on macOS goes through the app's Space shortcut (`play-pause`),
 *   not `--player` or synthetic media keys — both of those are unreliable on macOS.
 * - `--player next|prev` is used for skip after a brief UI wake; it may still be flaky
 *   when the window was hidden to the tray.
 * - `--player <verb>` on a cold system boots the full GUI **with focus** — never invoke
 *   it until {@link isRunning} is true; cold-start via {@link launchBackground} first.
 */
export class Psysonic {
	constructor(private readonly bin: string = DEFAULT_PSYSONIC_BIN) {}

	/**
	 * Toggle play/pause via PsySonic's in-app Space binding (`togglePlay`).
	 * Briefly activates the app so System Events can deliver the keystroke.
	 *
	 * Requires Stream Deck → Privacy & Security → Accessibility.
	 */
	async togglePlayPause(): Promise<void> {
		await run(
			"/usr/bin/osascript",
			[
				"-e",
				'tell application "Psysonic" to activate',
				"-e",
				"delay 0.15",
				"-e",
				'tell application "System Events" to tell process "Psysonic" to keystroke space',
			],
			{ timeout: 6000 },
		);
	}

	/** Skip track after waking the UI (best-effort; CLI forwarding can be flaky). */
	async skip(direction: "next" | "previous"): Promise<void> {
		await this.wakeForUiControl();
		const verb = direction === "previous" ? "prev" : "next";
		await run(this.bin, ["-q", "--player", verb], { timeout: 4000 });
	}

	/** Bring PsySonic forward long enough for UI/CLI input to land. */
	private async wakeForUiControl(): Promise<void> {
		await run(
			"/usr/bin/osascript",
			["-e", 'tell application "Psysonic" to activate', "-e", "delay 0.15"],
			{ timeout: 5000 },
		);
	}

	/** Best-effort read of the player snapshot; null if unavailable/unparseable. */
	async info(): Promise<PsysonicSnapshot | null> {
		for (let attempt = 0; attempt < 4; attempt++) {
			const snap = await this.readInfoOnce();
			if (snap) {
				return snap;
			}
			if (attempt < 3) {
				await delay(200 * (attempt + 1));
			}
		}
		return null;
	}

	private async readInfoOnce(): Promise<PsysonicSnapshot | null> {
		try {
			const { stdout } = await run(this.bin, ["--info", "--json", "--quiet"], { timeout: 6000 });
			return parseSnapshot(stdout);
		} catch {
			return null;
		}
	}

	/**
	 * Whether the Psysonic GUI process is currently running (macOS).
	 */
	async isRunning(): Promise<boolean> {
		try {
			const { stdout } = await run(
				"/usr/bin/osascript",
				["-e", 'application "Psysonic" is running'],
				{ timeout: 4000 },
			);
			return stdout.trim() === "true";
		} catch {
			return false;
		}
	}

	/**
	 * Launch Psysonic in the background without stealing focus (macOS).
	 * `-g` keeps it behind the current app. We deliberately do NOT pass `-j`
	 * (launch hidden): a hidden window occludes the webview, and WebKit suspends
	 * the JS that drives playback — so a hidden launch swallows `--player` commands.
	 * Visible-but-unfocused keeps the player responsive.
	 */
	async launchBackground(): Promise<void> {
		await run("/usr/bin/open", ["-g", "-a", "Psysonic"], { timeout: 8000 });
	}

	/**
	 * Launch (if needed) and wait until the app is running and ready to accept
	 * `--player` commands. Resolves true once ready, false on timeout.
	 */
	async ensureRunning(timeoutMs = 12000): Promise<boolean> {
		if (await this.isRunning()) {
			return true;
		}
		await this.launchBackground();
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			await delay(500);
			if (await this.isRunning()) {
				// Give the webview a beat to finish loading before we send Space.
				await delay(1500);
				return true;
			}
		}
		return false;
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function serverUrlFromSnapshot(data: any): string | undefined {
	const name = serverNameFromSnapshot(data);
	if (!name) {
		return undefined;
	}
	return /^https?:\/\//i.test(name) ? name : `http://${name}`;
}

function serverNameFromSnapshot(data: any): string | undefined {
	const servers = data?.servers;
	if (!Array.isArray(servers) || servers.length === 0) {
		return undefined;
	}
	const activeId = data?.music_library?.active_server_id;
	const server = servers.find((entry: any) => entry.id === activeId) ?? servers[0];
	const name = String(server?.name ?? "").trim();
	return name || undefined;
}

function parseSnapshot(stdout: string): PsysonicSnapshot | null {
	try {
		const data = JSON.parse(stdout);
		const t = data?.current_track ?? null;
		return {
			isPlaying: data?.is_playing === true,
			currentTime: typeof data?.current_time === "number" ? data.current_time : 0,
			queueLength:
				typeof data?.queue_length === "number"
					? data.queue_length
					: Array.isArray(data?.queue)
						? data.queue.length
						: 0,
			serverUrl: serverUrlFromSnapshot(data),
			serverName: serverNameFromSnapshot(data),
			track: t
				? {
						id: t.id,
						title: t.title,
						artist: t.artist,
						album: t.album,
						albumId: t.albumId,
						duration: typeof t.duration === "number" ? t.duration : undefined,
						coverArt: t.coverArt ?? t.albumId,
					}
				: null,
		};
	} catch {
		return null;
	}
}
