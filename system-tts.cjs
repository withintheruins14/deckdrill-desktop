// Renders a line with one of the computer's own voices to a WAV file, so drills spoken by
// "this device" voices can be saved as MP3s in the app. macOS uses `say`, Windows uses SAPI
// (System.Speech) through PowerShell. The page names a voice the way the browser's Web Speech
// API does; it's only used if it matches an installed voice, and nothing passes through a shell.
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const run = promisify(execFile);
const MAX_TEXT = 2000;
// Slow lines should come out as much longer as the neural voices' 0.8× speed makes them (~1/0.85,
// see estimateSeconds in lib/drill/schedule.ts). `say -r` is an absolute words-per-minute rate and
// each voice starts from its own default, so each voice is calibrated on its first slow line.
const SLOW_LENGTH = 1 / 0.85;
const FIRST_GUESS_WPM = 140;
const slowWpm = new Map(); // voice name -> calibrated words per minute
const SLOW_SAPI_RATE = -2; // SAPI rates run -10..10

let installed = null; // [{ name, locale }]

const base = (name) => name.replace(/\s*\((Enhanced|Premium)\)$/, "");
const first = (name) => name.split(/\s+[-(]/)[0].trim().toLowerCase();
const locale = (lang) => lang.replace("_", "-").toLowerCase();

async function listMac() {
  const { stdout } = await run("say", ["-v", "?"], { maxBuffer: 4 * 1024 * 1024 });
  return stdout.split("\n").map((line) => line.match(/^(.+?)\s+([a-z]{2,3}_[A-Za-z0-9]+)\s+#/)).filter(Boolean)
    .map((m) => ({ name: m[1].trim(), locale: locale(m[2]) }));
}

const PS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"];

async function listWindows() {
  const script = "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture.Name }";
  const { stdout } = await run("powershell.exe", [...PS, script], { windowsHide: true });
  return stdout.split(/\r?\n/).filter((l) => l.includes("|")).map((l) => {
    const [name, culture] = l.split("|");
    return { name: name.trim(), locale: locale(culture.trim()) };
  });
}

async function voices() {
  if (!installed) {
    try {
      installed = process.platform === "darwin" ? await listMac() : process.platform === "win32" ? await listWindows() : [];
    } catch {
      installed = [];
    }
  }
  return installed;
}

// Web Speech and the OS name voices slightly differently ("Angélica" vs "Angélica (Enhanced)",
// "Microsoft Sabina - Spanish (Mexico)" vs "Microsoft Sabina Desktop"), so match on the name
// first, then on the first name within the same language.
async function match({ name, lang }) {
  const all = await voices();
  const want = locale(lang);
  return all.find((v) => v.name === name)
    ?? all.find((v) => base(v.name) === name && v.locale === want)
    ?? all.find((v) => first(v.name) === first(name) && v.locale === want)
    ?? (process.platform === "win32" ? all.find((v) => v.name.toLowerCase().startsWith(name.split(" - ")[0].toLowerCase())) : undefined)
    ?? null;
}

async function resolvable(list) {
  const ok = [];
  for (const v of list) if (await match(v)) ok.push(v.name);
  return ok;
}

// Seconds of speech in a 16-bit mono WAV, ignoring silence the same way the site's trim() does.
function speechSeconds(wav) {
  const buf = Buffer.from(wav);
  let off = 12;
  while (off + 8 <= buf.length && buf.toString("ascii", off, off + 4) !== "data") off += 8 + buf.readUInt32LE(off + 4);
  const rate = buf.readUInt32LE(24);
  const data = buf.subarray(off + 8);
  let first = -1, last = -1;
  for (let i = 0; i + 1 < data.length; i += 2) if (Math.abs(data.readInt16LE(i)) > 164) { if (first < 0) first = i; last = i; }
  return first < 0 ? 0 : (last - first) / 2 / rate;
}

async function say(voice, input, output, wpm) {
  await run("say", ["-v", voice, ...(wpm ? ["-r", String(Math.round(wpm))] : []), "-f", input, "-o", output, "--file-format=WAVE", "--data-format=LEI16@24000"]);
  return fs.readFile(output);
}

async function sayMac(voice, input, output, slow) {
  if (!slow) return say(voice, input, output);
  const known = slowWpm.get(voice);
  if (known) return say(voice, input, output, known);
  // Calibrate: compare this line at the voice's own pace and at a first guess, then correct
  // the guess (spoken length scales roughly with 1 / words per minute).
  const normal = speechSeconds(await say(voice, input, output));
  const guess = await say(voice, input, output, FIRST_GUESS_WPM);
  const ratio = normal ? speechSeconds(guess) / normal : SLOW_LENGTH;
  const wpm = Math.min(260, Math.max(80, (FIRST_GUESS_WPM * ratio) / SLOW_LENGTH));
  slowWpm.set(voice, wpm);
  return Math.abs(ratio - SLOW_LENGTH) < 0.03 ? guess : say(voice, input, output, wpm);
}

async function synthesize({ name, lang, text, slow }) {
  const voice = await match({ name, lang });
  if (!voice) throw new Error(`The voice “${name}” isn't installed on this computer`);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "deckdrill-tts-"));
  const input = path.join(dir, "line.txt");
  const output = path.join(dir, "line.wav");
  try {
    await fs.writeFile(input, text, "utf8");
    if (process.platform === "darwin") {
      return new Uint8Array(await sayMac(voice.name, input, output, slow));
    } else if (process.platform === "win32") {
      const script = "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice($env:DD_VOICE); $s.Rate = [int]$env:DD_RATE; $s.SetOutputToWaveFile($env:DD_OUT); $s.Speak([System.IO.File]::ReadAllText($env:DD_IN, [System.Text.Encoding]::UTF8)); $s.Dispose()";
      await run("powershell.exe", [...PS, script], {
        windowsHide: true,
        env: { ...process.env, DD_VOICE: voice.name, DD_RATE: String(slow ? SLOW_SAPI_RATE : 0), DD_IN: input, DD_OUT: output },
      });
    } else {
      throw new Error("Saving device voices isn't supported on this system");
    }
    return new Uint8Array(await fs.readFile(output));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

module.exports = { MAX_TEXT, resolvable, synthesize };
