import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

const MAX_MODEL_BYTES = 500 * 1024 * 1024;
const VALID_RESOLUTIONS = new Set(["performance", "balanced", "high", "ultra"]);
const VALID_COLLIDER_SCALES = new Set(["0.3", "2", "5", "10", "100"]);

type CliFileResult = {
  file?: string;
  assetId?: string;
  status?: string;
  failedType?: string;
  error?: string;
  errorCode?: string;
  previewUrl?: string;
  convertedUrl?: string;
  url?: string;
};

type CliUploadResult = { files?: CliFileResult[] };

const enabled = (value: string | undefined) => /^(1|true|yes)$/i.test(value || "");

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

async function readModel(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_MODEL_BYTES) throw new Error("MODEL_TOO_LARGE");
    chunks.push(buffer);
  }
  if (!size) throw new Error("EMPTY_MODEL");
  return Buffer.concat(chunks);
}

function runPlsCli(binary: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string; code: number }>((resolveResult, reject) => {
    const child = spawn(binary, args, { shell: false, env: process.env });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("PLS_CLI_TIMEOUT"));
    }, 15 * 60 * 1000);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolveResult({ stdout, stderr, code: code ?? 1 });
    });
  });
}

function previewUrlFor(asset: CliFileResult, environment: Record<string, string | undefined>) {
  const direct = asset.previewUrl || asset.convertedUrl || asset.url;
  if (direct) return direct;
  const template = environment.PLS_PREVIEW_URL_TEMPLATE?.trim();
  if (template && asset.assetId) return template.replaceAll("{assetId}", encodeURIComponent(asset.assetId));
  if (!asset.assetId) return undefined;
  return `https://stream.viverse.com/model/${encodeURIComponent(asset.assetId)}`;
}

export function plsCliUploadPlugin(environment: Record<string, string | undefined> = process.env): Plugin {
  return {
    name: "nurture-garden-pls-cli-upload",
    configureServer(server) {
      server.middlewares.use("/api/polygon/upload", async (request, response, next) => {
        if (request.method !== "POST") {
          if (request.method === "GET") {
            sendJson(response, 200, { provider: "pls-cli", configured: true });
            return;
          }
          next();
          return;
        }

        let temporaryDirectory: string | undefined;
        try {
          if (request.headers["content-type"] !== "model/gltf-binary") {
            sendJson(response, 415, { error: "Expected model/gltf-binary request body." });
            return;
          }
          const model = await readModel(request);
          temporaryDirectory = await mkdtemp(join(tmpdir(), "nurture-garden-pls-"));
          const modelPath = join(temporaryDirectory, "nurture-garden-arrangement.glb");
          await writeFile(modelPath, model);

          const bundledBinary = resolve(process.cwd(), "tools/bin/pls-cli");
          const binary = environment.PLS_CLI_BIN?.trim()
            || (existsSync(bundledBinary) ? bundledBinary : "pls-cli");
          const args = ["upload", modelPath, "--json"];
          const groupId = environment.PLS_GROUP_ID?.trim();
          if (groupId) args.push(`--group=${groupId}`);
          if (enabled(environment.PLS_CLI_STAGE)) args.push("--stage");
          if (enabled(environment.PLS_AI_ENHANCE)) args.push("--ai-enhance");
          if (enabled(environment.PLS_COLLIDER)) args.push("--collider");
          if (enabled(environment.PLS_SECURE)) args.push("--secure");
          const resolution = environment.PLS_RESOLUTION?.trim();
          if (resolution && VALID_RESOLUTIONS.has(resolution)) args.push(`--resolution=${resolution}`);
          const colliderScale = environment.PLS_COLLIDER_SCALE?.trim();
          if (colliderScale && VALID_COLLIDER_SCALES.has(colliderScale)) args.push(`--collider-scale=${colliderScale}`);

          const result = await runPlsCli(binary, args);
          let payload: CliUploadResult;
          try {
            payload = JSON.parse(result.stdout) as CliUploadResult;
          } catch {
            sendJson(response, 502, {
              error: "pls-cli did not return valid JSON.",
              detail: result.stderr.trim() || result.stdout.trim(),
            });
            return;
          }
          const asset = payload.files?.[0];
          if (result.code !== 0 || !asset?.assetId || asset.status !== "ready") {
            sendJson(response, 422, {
              error: asset?.error || "Polygon Streaming conversion failed.",
              errorCode: asset?.errorCode,
              failedType: asset?.failedType,
              status: asset?.status,
            });
            return;
          }
          sendJson(response, 200, {
            provider: "pls-cli",
            assetId: asset.assetId,
            status: asset.status,
            previewUrl: previewUrlFor(asset, environment),
          });
        } catch (error) {
          const code = error instanceof Error && "code" in error ? String(error.code) : "";
          if (error instanceof Error && error.message === "MODEL_TOO_LARGE") {
            sendJson(response, 413, { error: "The GLB exceeds the pls-cli 500 MB limit." });
          } else if (error instanceof Error && error.message === "EMPTY_MODEL") {
            sendJson(response, 400, { error: "No GLB data was received." });
          } else if (code === "ENOENT") {
            sendJson(response, 503, { error: "pls-cli is not installed. Run npm run polygon:install-cli." });
          } else {
            sendJson(response, 500, { error: error instanceof Error ? error.message : "pls-cli upload failed." });
          }
        } finally {
          if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
        }
      });
    },
  };
}
