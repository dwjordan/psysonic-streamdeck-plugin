# Psysonic for Stream Deck

An Elgato Stream Deck plugin for the [Psysonic](https://github.com/Psychotoxical/psysonic)
desktop client. The **Now Playing** button live-updates its icon to the current track's
album art, similar to the official Spotify plugin.

## Actions

- **Now Playing** — shows the current track's album art from Psysonic; press to play/pause.
- **Skip Track** — next or previous track in the Psysonic queue.

## Configuration

Each button's Property Inspector takes:

- **Server URL** — your music server, e.g. `http://localhost:4533` (optional; auto-detected from Psysonic when running)
- **Username** / **Password** — server credentials for cover art (salted-MD5 token auth, never sent in plaintext)
- **Show title** — overlay track name on the key (off by default)
- **Refresh (sec)** — how often to poll for updates
- **Psysonic path** — override the CLI binary location

### macOS permissions

Stream Deck needs **Accessibility** permission (System Settings → Privacy & Security) so the plugin can send Space to Psysonic for play/pause.

## Development

```bash
npm install
npm run icons     # regenerate placeholder icons
npm run build     # bundle src -> com.dwjordan.psysonic.sdPlugin/bin/plugin.js
npm run watch     # rebuild + restart the plugin on change
```

Install into Stream Deck (once):

```bash
streamdeck link com.dwjordan.psysonic.sdPlugin
streamdeck restart com.dwjordan.psysonic
```

Requires the Stream Deck app 6.5+ and Node 20. Built on the
[`@elgato/streamdeck`](https://github.com/elgatosf/streamdeck) v2 SDK.
