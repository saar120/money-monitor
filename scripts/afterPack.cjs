const { execFileSync } = require("child_process");
const path = require("path");

exports.default = async function afterPack(context) {
  if (process.platform !== "darwin") return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  // Ad-hoc sign with a designated requirement based on the bundle identifier
  // instead of the default cdhash. Without this, each ad-hoc build gets a
  // unique cdhash requirement that no other build can ever satisfy, causing
  // Squirrel.Mac's ShipIt to reject every update.
  console.log("[afterPack] Signing with stable designated requirement...");
  execFileSync("codesign", [
    "--force",
    "--deep",
    "-s",
    "-",
    "-r",
    '=designated => identifier "com.money-monitor.app"',
    appPath,
  ], { stdio: "inherit" });
  console.log("[afterPack] Signed successfully");
};
