// Refreshes the Psysonic logo from the app bundle, then renders plugin branding icons.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const ROOT = "com.dwjordan.psysonic.sdPlugin/imgs";
const NOW_PLAYING = join(ROOT, "actions/nowplaying");
const RENDER_BIN = "com.dwjordan.psysonic.sdPlugin/bin/render-icons";
const APP_ICON = "/Applications/Psysonic.app/Contents/Resources/icon.icns";
const LOGO = join(NOW_PLAYING, "psysonic.png");
const LOGO_2X = join(NOW_PLAYING, "psysonic@2x.png");

function refreshLogoFromApp() {
	const source = "/tmp/psysonic-logo-source.png";
	execFileSync("sips", ["-s", "format", "png", APP_ICON, "--out", source], { stdio: "pipe" });
	execFileSync("sips", ["-z", "144", "144", source, "--out", LOGO], { stdio: "pipe" });
	execFileSync("sips", ["-z", "288", "288", source, "--out", LOGO_2X], { stdio: "pipe" });
	unlinkSync(source);
}

mkdirSync(NOW_PLAYING, { recursive: true });

if (existsSync(APP_ICON)) {
	refreshLogoFromApp();
	console.log("refreshed Psysonic logo from app bundle");
} else if (!existsSync(LOGO_2X)) {
	throw new Error(`Psysonic app icon not found at ${APP_ICON} and no bundled logo present`);
}

execFileSync(RENDER_BIN, [ROOT, LOGO_2X], { stdio: "inherit" });

console.log("icons generated");
