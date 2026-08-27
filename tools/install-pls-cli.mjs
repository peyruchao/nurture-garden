import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const version = process.env.PLS_CLI_VERSION || "v1.0.0";
const platformNames = { darwin: "darwin", linux: "linux", win32: "windows" };
const architectureNames = { arm64: "arm64", x64: "amd64" };
const platform = platformNames[process.platform];
const architecture = architectureNames[process.arch];
if (!platform || !architecture) throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`);

const extension = platform === "windows" ? ".exe" : "";
const assetName = `pls-cli-${platform}-${architecture}${extension}`;
const url = `https://github.com/ViveportSoftware/pls-cli/releases/download/${version}/${assetName}`;
const destination = resolve("tools/bin", `pls-cli${extension}`);
const temporary = `${destination}.download`;

console.log(`Downloading official ${assetName} (${version})…`);
const response = await fetch(url, { redirect: "follow" });
if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
const bytes = new Uint8Array(await response.arrayBuffer());
await mkdir(dirname(destination), { recursive: true });
await writeFile(temporary, bytes, { mode: 0o755 });
await chmod(temporary, 0o755);
await rm(destination, { force: true });
await rename(temporary, destination);
console.log(`Installed ${destination}. Run "npm run polygon:status" to verify login.`);
