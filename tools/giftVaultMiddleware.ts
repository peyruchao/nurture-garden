import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

const MAX_REQUEST_BYTES = 120 * 1024 * 1024;

type StoredGift = {
  passphrase: string;
  fileName: string;
  kind: "card" | "pot";
  recipient: string;
  sender: string;
  date: string;
  message: string;
  createdAt: number;
  previewMime: string;
};

function normalizePassphrase(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, "").slice(0, 24);
}

function giftId(passphrase: string) {
  return createHash("sha256").update(passphrase).digest("hex");
}

function cors(response: ServerResponse, environment: Record<string, string | undefined>) {
  response.setHeader("Access-Control-Allow-Origin", environment.GIFT_VAULT_ALLOWED_ORIGIN?.trim() || "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(response: ServerResponse, status: number, payload: unknown, environment: Record<string, string | undefined>) {
  cors(response, environment);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

async function requestJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_REQUEST_BYTES) throw new Error("GIFT_TOO_LARGE");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function decodeDataUrl(value: unknown, expectedMime?: string) {
  const match = String(value || "").match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) throw new Error("INVALID_GIFT_DATA");
  if (expectedMime && match[1] !== expectedMime) throw new Error("INVALID_GIFT_TYPE");
  return { mime: match[1], data: Buffer.from(match[2].replace(/\s/g, ""), "base64") };
}

export function giftVaultPlugin(environment: Record<string, string | undefined> = process.env): Plugin {
  const vaultRoot = resolve(environment.GIFT_VAULT_DIR?.trim() || join(process.cwd(), ".nurture-garden-gift-vault"));

  return {
    name: "nurture-garden-shared-gift-vault",
    configureServer(server) {
      server.middlewares.use("/api/gifts", async (request, response) => {
        cors(response, environment);
        if (request.method === "OPTIONS") {
          response.statusCode = 204;
          response.end();
          return;
        }

        const url = new URL(request.url || "/", "http://nurture-garden.local");
        const segments = url.pathname.split("/").filter(Boolean);
        let passphrase = "";
        try { passphrase = normalizePassphrase(decodeURIComponent(segments[0] || "")); } catch { passphrase = ""; }
        if (passphrase.length < 4) {
          json(response, 400, { error: "A gift passphrase with at least 4 characters is required." }, environment);
          return;
        }

        const id = giftId(passphrase);
        const folder = join(vaultRoot, id.slice(0, 2));
        const metadataPath = join(folder, `${id}.json`);
        const modelPath = join(folder, `${id}.glb`);
        const previewPath = join(folder, `${id}.preview`);

        try {
          if (request.method === "HEAD") {
            response.statusCode = existsSync(metadataPath) && existsSync(modelPath) ? 200 : 404;
            response.end();
            return;
          }

          if (request.method === "POST") {
            if (existsSync(metadataPath) || existsSync(modelPath)) {
              json(response, 409, { error: "This passphrase is already in use." }, environment);
              return;
            }
            const body = await requestJson(request);
            const model = decodeDataUrl(body.modelDataUrl, "model/gltf-binary");
            if (model.data.length < 20 || model.data.subarray(0, 4).toString("ascii") !== "glTF") throw new Error("INVALID_GLB");
            const preview = body.previewDataUrl ? decodeDataUrl(body.previewDataUrl) : null;
            const metadata: StoredGift = {
              passphrase,
              fileName: String(body.fileName || "nurture-garden-gift.glb").slice(0, 120),
              kind: body.kind === "card" ? "card" : "pot",
              recipient: String(body.recipient || "").slice(0, 80),
              sender: String(body.sender || "").slice(0, 80),
              date: String(body.date || "").slice(0, 32),
              message: String(body.message || "").slice(0, 800),
              createdAt: Number(body.createdAt) || Date.now(),
              previewMime: preview?.mime || "",
            };
            await mkdir(folder, { recursive: true });
            const stamp = `${process.pid}-${Date.now()}`;
            const temporaryModel = `${modelPath}.${stamp}.tmp`;
            const temporaryMetadata = `${metadataPath}.${stamp}.tmp`;
            await writeFile(temporaryModel, model.data);
            if (preview) await writeFile(`${previewPath}.${stamp}.tmp`, preview.data);
            await writeFile(temporaryMetadata, JSON.stringify(metadata));
            await rename(temporaryModel, modelPath);
            if (preview) await rename(`${previewPath}.${stamp}.tmp`, previewPath);
            await rename(temporaryMetadata, metadataPath);
            json(response, 201, { ...metadata, modelUrl: `/api/gifts/${encodeURIComponent(passphrase)}/model`, previewUrl: preview ? `/api/gifts/${encodeURIComponent(passphrase)}/preview` : "" }, environment);
            return;
          }

          if (request.method === "GET" && segments[1] === "model") {
            if (!existsSync(modelPath)) { json(response, 404, { error: "Gift not found." }, environment); return; }
            response.statusCode = 200;
            response.setHeader("Content-Type", "model/gltf-binary");
            response.setHeader("Cache-Control", "private, max-age=300");
            response.end(await readFile(modelPath));
            return;
          }

          if (request.method === "GET" && segments[1] === "preview") {
            if (!existsSync(previewPath) || !existsSync(metadataPath)) { json(response, 404, { error: "Preview not found." }, environment); return; }
            const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as StoredGift;
            response.statusCode = 200;
            response.setHeader("Content-Type", metadata.previewMime || "image/png");
            response.setHeader("Cache-Control", "private, max-age=300");
            response.end(await readFile(previewPath));
            return;
          }

          if (request.method === "GET") {
            if (!existsSync(metadataPath) || !existsSync(modelPath)) { json(response, 404, { error: "Gift not found." }, environment); return; }
            const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as StoredGift;
            json(response, 200, { ...metadata, modelUrl: `/api/gifts/${encodeURIComponent(passphrase)}/model`, previewUrl: existsSync(previewPath) ? `/api/gifts/${encodeURIComponent(passphrase)}/preview` : "" }, environment);
            return;
          }

          json(response, 405, { error: "Method not allowed." }, environment);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Gift vault request failed.";
          const status = message === "GIFT_TOO_LARGE" ? 413 : message.startsWith("INVALID_") ? 400 : 500;
          json(response, status, { error: message }, environment);
        }
      });
    },
  };
}
