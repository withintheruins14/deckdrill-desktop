// The only thing the site sees of the desktop app: a way to reach AnkiConnect without CORS.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("deckdrillDesktop", {
  platform: process.platform,
  ankiConnect: (body) => ipcRenderer.invoke("anki-connect", body),
});
