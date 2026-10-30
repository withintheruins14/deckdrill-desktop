// deckdrill desktop: a secure window onto https://www.deckdrill.app, plus the few things a
// browser tab can't do — talk to AnkiConnect without CORS setup, save drills spoken by the
// computer's own voices, and a clear offline screen.
// Studio logic stays on the site, so the app never needs updating for site changes.
const { app, BrowserWindow, ipcMain, session, shell } = require("electron");
const path = require("node:path");
const systemTts = require("./system-tts.cjs");

const SITE = "https://www.deckdrill.app";
const HOSTS = new Set(["www.deckdrill.app", "deckdrill.app"]);
// Fixed, like the site's relays: the renderer can't choose where requests go.
const ANKI_CONNECT = "http://127.0.0.1:8765";
const MAX_ANKI_BODY = 64 * 1024 * 1024;

const isSite = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && HOSTS.has(u.hostname);
  } catch {
    return false;
  }
};

const openOutside = (url) => {
  if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
};

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    title: "deckdrill",
    backgroundColor: "#e7ece4",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.once("ready-to-show", () => win.show());

  const contents = win.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    if (isSite(url)) win.loadURL(url);
    else openOutside(url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    if (isSite(url)) return;
    event.preventDefault();
    openOutside(url);
  });
  contents.on("did-fail-load", (_event, code, _desc, url, isMainFrame) => {
    // -3 is an aborted load (e.g. a new navigation replaced it), not a connection problem.
    if (isMainFrame && code !== -3 && isSite(url)) win.loadFile(path.join(__dirname, "offline.html"), { query: { next: url } });
  });

  win.loadURL(SITE);
}

// The microphone is only for recording a voice to clone, and only for deckdrill itself.
function limitPermissions() {
  const allowed = new Set(["media", "clipboard-sanitized-write", "fullscreen"]);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(allowed.has(permission) && isSite(details.requestingUrl));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => allowed.has(permission) && isSite(origin));
}

ipcMain.handle("anki-connect", async (event, body) => {
  if (!isSite(event.senderFrame?.url ?? "")) throw new Error("Not allowed");
  if (typeof body !== "string" || body.length > MAX_ANKI_BODY) throw new Error("Bad request");
  try {
    const res = await fetch(ANKI_CONNECT, { method: "POST", body, headers: { "Content-Type": "application/json" } });
    return await res.text();
  } catch {
    throw new Error("Anki isn't running, or the AnkiConnect add-on isn't installed");
  }
});

// The page only ever names a voice; the main process checks it against the installed voices.
ipcMain.handle("system-voices", async (event, voices) => {
  if (!isSite(event.senderFrame?.url ?? "")) throw new Error("Not allowed");
  if (!Array.isArray(voices) || voices.length > 1000) throw new Error("Bad request");
  return systemTts.resolvable(voices.filter((v) => v && typeof v.name === "string" && typeof v.lang === "string"));
});

ipcMain.handle("system-tts", async (event, request) => {
  if (!isSite(event.senderFrame?.url ?? "")) throw new Error("Not allowed");
  const { name, lang, text, slow } = request ?? {};
  if (typeof name !== "string" || typeof lang !== "string" || typeof text !== "string" || !text.trim() || text.length > systemTts.MAX_TEXT) {
    throw new Error("Bad request");
  }
  return systemTts.synthesize({ name, lang, text, slow: !!slow });
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(() => {
    limitPermissions();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
