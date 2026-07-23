import streamDeck, {
	action,
	DidReceiveSettingsEvent,
	KeyDownEvent,
	SingletonAction,
	WillAppearEvent,
	WillDisappearEvent,
} from "@elgato/streamdeck";
import { clientFromSettings, ConnectionSettings } from "../subsonic";
import { DEFAULT_PSYSONIC_BIN, Psysonic } from "../psysonic";

type Settings = ConnectionSettings & {
	pollSeconds?: number;
	showTitle?: boolean;
	psysonicPath?: string;
};

/** Shown when Psysonic isn't running (bundled from the app's own icon). */
const LOGO_IMAGE = "imgs/actions/nowplaying/psysonic.png";
/** How long a press's optimistic play-state wins over the (laggy) snapshot. */
const OPTIMISTIC_HOLD_MS = 4500;

/**
 * A Spotify-style button for a local Psysonic client:
 * - Not running → shows the Psysonic logo; a press launches it and starts playing.
 * - Running, paused/stopped → album art with a play overlay; a press resumes/starts.
 * - Running, playing → album art; a press pauses.
 *
 * Control sends Space to PsySonic's `play-pause` shortcut (briefly activating the
 * app). The CLI snapshot is used to read the current track (for art) and play state.
 */
@action({ UUID: "com.dwjordan.psysonic.nowplaying" })
export class NowPlaying extends SingletonAction<Settings> {
	private readonly timers = new Map<string, NodeJS.Timeout>();
	/** coverArt id → fetched data URI, so play/pause overlay swaps don't refetch. */
	private readonly coverCache = new Map<string, string>();
	/** Last image signature painted per button, to skip redundant setImage calls. */
	private readonly lastRender = new Map<string, string>();
	private readonly playState = new Map<string, boolean>();
	/** Until when a recent press's optimistic state should override the snapshot. */
	private readonly holdUntil = new Map<string, number>();
	/** Guards against overlapping presses while a launch is in flight. */
	private readonly busy = new Set<string>();
	/** App-wide cache of the (slow) is-running check. */
	private runningCache?: { at: number; value: boolean };
	/** Last known Property Inspector settings per button (password is omitted on many events). */
	private readonly settingsByAction = new Map<string, Settings>();

	override onWillAppear(ev: WillAppearEvent<Settings>): void {
		this.rememberSettings(ev.action.id, ev.payload.settings);
		this.runningCache = undefined;
		this.lastRender.delete(ev.action.id);
		this.startPolling(ev.action);
	}

	override onWillDisappear(ev: WillDisappearEvent<Settings>): void {
		this.stopPolling(ev.action.id);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): void {
		this.rememberSettings(ev.action.id, ev.payload.settings);
		this.stopPolling(ev.action.id);
		this.runningCache = undefined;
		this.lastRender.delete(ev.action.id);
		this.startPolling(ev.action);
	}

	override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
		const id = ev.action.id;
		const settings = this.rememberSettings(id, ev.payload.settings);
		if (this.busy.has(id)) {
			return;
		}
		this.busy.add(id);
		try {
			const psysonic = new Psysonic(settings.psysonicPath || DEFAULT_PSYSONIC_BIN);

			if (!(await this.isRunning(psysonic, 0))) {
				const ready = await psysonic.ensureRunning();
				this.runningCache = { at: Date.now(), value: ready };
				if (!ready) {
					streamDeck.logger.error("Psysonic did not become ready in time");
					await ev.action.showAlert();
					return;
				}
				await psysonic.togglePlayPause();
				this.setOptimistic(id, true);
				return;
			}

			await psysonic.togglePlayPause();
			this.setOptimistic(id, !(this.playState.get(id) ?? false));
		} catch (err) {
			streamDeck.logger.error("nowplaying key press failed", err);
			await ev.action.showAlert();
		} finally {
			this.busy.delete(id);
			void this.refresh(ev.action);
		}
	}

	/** Merge incoming settings; keep password when Stream Deck omits it from the payload. */
	private rememberSettings(actionId: string, incoming: Settings): Settings {
		const previous = this.settingsByAction.get(actionId) ?? {};
		const merged: Settings = { ...previous, ...incoming };
		if (!incoming.password && previous.password) {
			merged.password = previous.password;
		}
		this.settingsByAction.set(actionId, merged);
		return merged;
	}

	private setOptimistic(id: string, playing: boolean): void {
		this.playState.set(id, playing);
		this.holdUntil.set(id, Date.now() + OPTIMISTIC_HOLD_MS);
	}

	/** is-running with a short app-wide cache to avoid spawning osascript every poll. */
	private async isRunning(psysonic: Psysonic, maxAgeMs = 8000): Promise<boolean> {
		const now = Date.now();
		if (this.runningCache && now - this.runningCache.at < maxAgeMs) {
			return this.runningCache.value;
		}
		const value = await psysonic.isRunning();
		this.runningCache = { at: now, value };
		return value;
	}

	private startPolling(action: any): void {
		const settings = this.settingsByAction.get(action.id) ?? {};
		const seconds = Math.min(30, Math.max(2, settings.pollSeconds ?? 3));
		void this.refresh(action);
		const timer = setInterval(() => void this.refresh(action), seconds * 1000);
		this.timers.set(action.id, timer);
	}

	private stopPolling(id: string): void {
		const timer = this.timers.get(id);
		if (timer) {
			clearInterval(timer);
			this.timers.delete(id);
		}
	}

	private async refresh(action: any): Promise<void> {
		const id = action.id;
		const settings = this.settingsByAction.get(id) ?? {};
		const psysonic = new Psysonic(settings.psysonicPath || DEFAULT_PSYSONIC_BIN);

		if (!(await this.isRunning(psysonic))) {
			await action.setTitle("");
			await this.paint(action, "logo", LOGO_IMAGE);
			return;
		}

		const snap = await psysonic.info();

		if (snap && Date.now() >= (this.holdUntil.get(id) ?? 0)) {
			this.playState.set(id, snap.isPlaying);
		}
		const playing = this.playState.get(id) ?? snap?.isPlaying ?? false;

		const track = snap?.track ?? null;
		if (!track || !track.coverArt) {
			await action.setTitle(
				!track ? "Nothing\nplaying" : settings.showTitle === true ? formatTitle(track) : "",
			);
			if (!track) {
				await this.paint(action, "logo", LOGO_IMAGE);
			}
			return;
		}

		await action.setTitle(settings.showTitle === true ? formatTitle(track) : "");

		const artSettings: Settings = {
			...settings,
			serverUrl: settings.serverUrl || snap?.serverUrl,
		};
		const cover = await this.coverArt(artSettings, track.coverArt);
		if (!cover) {
			await this.paint(action, "logo-no-cover", LOGO_IMAGE);
			return;
		}
		const sig = `${track.coverArt}|${playing ? "play" : "pause"}`;
		await this.paint(action, sig, playing ? cover : playOverlaySvg(cover));
	}

	/** Fetch (and cache) a cover-art data URI by its Subsonic id. */
	private async coverArt(settings: Settings, coverArtId: string): Promise<string | null> {
		const cached = this.coverCache.get(coverArtId);
		if (cached) {
			return cached;
		}
		const client = clientFromSettings(settings);
		if (!client) {
			streamDeck.logger.warn(
				`cover art skipped: configure Server URL, username, and password in the button settings ` +
					`(server=${Boolean(settings.serverUrl)}, user=${Boolean(settings.username)}, ` +
					`pass=${Boolean(settings.password)})`,
			);
			return null;
		}
		try {
			const dataUri = await client.coverArtDataUri(coverArtId, 144);
			if (dataUri) {
				this.coverCache.set(coverArtId, dataUri);
				return dataUri;
			}
			streamDeck.logger.warn(`cover art unavailable for id ${coverArtId}`);
			return null;
		} catch (err) {
			streamDeck.logger.warn(`cover art fetch failed: ${(err as any)?.message ?? err}`);
			return null;
		}
	}

	/** setImage only when the rendered signature changed. */
	private async paint(action: any, signature: string, image: string): Promise<void> {
		if (this.lastRender.get(action.id) === signature) {
			return;
		}
		await action.setImage(image);
		this.lastRender.set(action.id, signature);
	}
}

/** Two short lines (title over artist) that fit a Stream Deck key. */
function formatTitle(track: { title?: string; artist?: string }): string {
	const clip = (value: string | undefined, max = 12): string => {
		const text = (value ?? "").trim();
		return text.length > max ? `${text.slice(0, max - 1)}…` : text;
	};
	return `${clip(track.title)}\n${clip(track.artist)}`;
}

/**
 * Wrap a cover-art data URI in an SVG with a large (~80% of the key) translucent
 * centered play button.
 */
function playOverlaySvg(coverDataUri: string): string {
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">` +
		`<image href="${coverDataUri}" x="0" y="0" width="144" height="144"/>` +
		`<circle cx="72" cy="72" r="58" fill="#000" fill-opacity="0.7"/>` +
		`<path d="M56 44 L56 100 Q56 104 59.5 102.5 L105.5 74.5 Q109 72 105.5 69.5 L59.5 41.5 Q56 40 56 44 Z" fill="#fff" fill-opacity="0.95"/>` +
		`</svg>`;
	return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
