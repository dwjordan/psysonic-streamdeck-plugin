import streamDeck, { action, KeyDownEvent, SingletonAction } from "@elgato/streamdeck";
import { DEFAULT_PSYSONIC_BIN, Psysonic } from "../psysonic";

type Settings = {
	direction?: "next" | "previous";
	psysonicPath?: string;
};

/**
 * Skip to the next or previous track via PsySonic's CLI (after waking the UI).
 * Does nothing (alerts) if Psysonic isn't running, so a stray press can't hijack
 * another app's playback.
 */
@action({ UUID: "com.dwjordan.psysonic.skip" })
export class Skip extends SingletonAction<Settings> {
	override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
		const settings = ev.payload.settings;
		const psysonic = new Psysonic(settings.psysonicPath || DEFAULT_PSYSONIC_BIN);

		if (!(await psysonic.isRunning())) {
			await ev.action.showAlert();
			return;
		}

		try {
			await psysonic.skip((settings.direction ?? "next") === "previous" ? "previous" : "next");
		} catch (err) {
			streamDeck.logger.error("skip failed", err);
			await ev.action.showAlert();
		}
	}
}
