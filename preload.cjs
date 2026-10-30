// What the site sees of the desktop app: AnkiConnect without CORS, and the computer's own
// voices rendered to audio files.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("deckdrillDesktop", {
  platform: process.platform,
  ankiConnect: (body) => ipcRenderer.invoke("anki-connect", body),
  systemVoices: (voices) => ipcRenderer.invoke("system-voices", voices),
  systemTts: (request) => ipcRenderer.invoke("system-tts", request),
});
