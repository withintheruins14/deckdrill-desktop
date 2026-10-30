// Without an Apple Developer ID the app ships ad-hoc signed. Sealing the whole bundle (not just
// the Electron binary) lets macOS offer "Open Anyway" instead of calling the download damaged.
const { execFileSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
};
