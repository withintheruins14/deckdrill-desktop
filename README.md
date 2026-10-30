# deckdrill desktop

[deckdrill](https://www.deckdrill.app) for Mac and Windows: Anki decks and Pimsleur- and Glossika-style audio drills, in your own voice.

**Download:** https://www.deckdrill.app/download

The app is a secure window onto www.deckdrill.app (context isolation, sandboxed renderer, navigation and permissions limited to deckdrill.app), plus:

- **Send to Anki without CORS setup** — the main process talks to AnkiConnect on `127.0.0.1:8765`; the page can't choose any other address.
- **Save drills spoken by the computer's own voices** — `say` on macOS, SAPI (System.Speech) on Windows render each line to WAV; only voices that match an installed voice are used.
- Native Save dialogs for drills and decks, microphone access for voice cloning, and an offline screen.

Because the studio itself runs on the site, the app doesn't need updating when the site changes.

## Build

```sh
npm install
npm start                       # run locally
npm run dist:mac -- --arm64     # or --x64
npm run dist:win
```

Builds are unsigned (macOS builds are ad-hoc signed), so Mac and Windows ask for confirmation on first open — see the download page.

## Legal

- Terms, privacy and voice licensing: https://www.deckdrill.app/legal (also under Help in the app).
- Your computer's own voices are licensed by Apple and Microsoft for personal, non-commercial use; drills saved with them are for your own study.
- Electron (MIT) and Chromium license texts ship inside the app (`Resources/licenses`, Help → Electron License / Chromium Licenses) and are in `build/licenses/` here.
- © 2026 Phillip Jacowski. All rights reserved unless a license file says otherwise.
