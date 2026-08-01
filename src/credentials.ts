import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type CredentialStore = Record<string, { password: string }>;

/** Persists Navidrome passwords outside plugin memory (Stream Deck omits them on restart). */
const CREDS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".credentials");
const CREDS_FILE = path.join(CREDS_DIR, "navidrome.json");

function storeKey(serverUrl: string, username: string): string {
	const base = serverUrl.trim().replace(/\/+$/, "");
	const normalized = /^https?:\/\//i.test(base) ? base : `http://${base}`;
	return `${normalized}|${username.trim()}`;
}

async function readStore(): Promise<CredentialStore> {
	try {
		const raw = await readFile(CREDS_FILE, "utf8");
		return JSON.parse(raw) as CredentialStore;
	} catch {
		return {};
	}
}

async function writeStore(store: CredentialStore): Promise<void> {
	await mkdir(CREDS_DIR, { recursive: true, mode: 0o700 });
	await writeFile(CREDS_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
	await chmod(CREDS_DIR, 0o700).catch(() => undefined);
	await chmod(CREDS_FILE, 0o600).catch(() => undefined);
}

export async function loadPassword(
	serverUrl?: string,
	username?: string,
): Promise<string | undefined> {
	const creds = await loadCredentials(serverUrl, username);
	return creds?.password;
}

export async function loadCredentials(
	serverUrl?: string,
	username?: string,
): Promise<{ username: string; password: string } | undefined> {
	if (!serverUrl?.trim()) {
		return undefined;
	}

	const store = await readStore();
	const normalized = storeKey(serverUrl, username ?? "");

	if (username?.trim()) {
		const exact = store[normalized];
		if (exact?.password) {
			return { username: username.trim(), password: exact.password };
		}
	}

	const prefix = `${normalizeServerUrl(serverUrl)}|`;
	for (const [key, value] of Object.entries(store)) {
		if (key.startsWith(prefix) && value.password) {
			return { username: key.slice(prefix.length), password: value.password };
		}
	}

	return undefined;
}

function normalizeServerUrl(raw: string): string {
	const url = raw.trim();
	if (!url) {
		return "";
	}
	if (!/^https?:\/\//i.test(url)) {
		return `http://${url}`;
	}
	return url.replace(/\/+$/, "");
}

export async function savePassword(
	serverUrl: string,
	username: string,
	password: string,
): Promise<void> {
	if (!serverUrl.trim() || !username.trim() || !password) {
		return;
	}
	const store = await readStore();
	store[storeKey(serverUrl, username)] = { password };
	await writeStore(store);
}
