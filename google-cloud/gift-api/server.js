import crypto from "node:crypto";
import express from "express";
import multer from "multer";
import { Firestore } from "@google-cloud/firestore";
import { Storage } from "@google-cloud/storage";

const port = Number(process.env.PORT || 8080);
const bucketName = process.env.GIFT_BUCKET;
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (!bucketName) throw new Error("GIFT_BUCKET is required");

const firestore = new Firestore();
const storage = new Storage();
const bucket = storage.bucket(bucketName);
const gifts = firestore.collection("nurture_gifts");
const app = express();
app.set("trust proxy", true);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 28 * 1024 * 1024, files: 2, fields: 2 },
});

const normalizePassphrase = (value) =>
  String(value || "").trim().toLocaleLowerCase("en-US").replace(/\s+/g, "");

const cleanText = (value, maxLength) =>
  String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);

const isAllowedOrigin = (origin) =>
  !origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin);

app.use((request, response, next) => {
  const origin = request.headers.origin;
  if (isAllowedOrigin(origin)) {
    const allowedOrigin = allowedOrigins.includes("*") ? "*" : origin;
    if (allowedOrigin) response.set("Access-Control-Allow-Origin", allowedOrigin);
    response.set("Vary", "Origin");
  }
  response.set("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type");
  response.set("Access-Control-Max-Age", "86400");
  if (request.method === "OPTIONS") return response.sendStatus(204);
  if (!isAllowedOrigin(origin)) return response.status(403).json({ error: "ORIGIN_NOT_ALLOWED" });
  next();
});

app.get("/health", (_request, response) => response.json({ ok: true }));

const passphraseFrom = (request) => normalizePassphrase(request.params.passphrase);
const validPassphrase = (passphrase) => passphrase.length >= 4 && passphrase.length <= 64;
const documentIdFor = (passphrase) =>
  crypto.createHash("sha256").update(passphrase).digest("hex");

const metadataFor = (request, passphrase, data) => {
  const encoded = encodeURIComponent(passphrase);
  const origin = `${request.protocol}://${request.get("host")}`;
  return {
    passphrase,
    fileName: data.fileName || "nurture-garden-gift.glb",
    kind: data.kind === "card" ? "card" : "pot",
    recipient: data.recipient || "",
    sender: data.sender || "",
    date: data.date || "",
    message: data.message || "",
    createdAt: Number(data.createdAt) || Date.now(),
    modelUrl: `${origin}/api/gifts/${encoded}/model`,
    previewUrl: data.previewPath ? `${origin}/api/gifts/${encoded}/preview` : "",
    shared: true,
  };
};

const findGift = async (passphrase) => {
  const snapshot = await gifts.doc(documentIdFor(passphrase)).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  return data?.passphrase === passphrase ? data : null;
};

app.head("/api/gifts/:passphrase", async (request, response, next) => {
  try {
    const passphrase = passphraseFrom(request);
    if (!validPassphrase(passphrase)) return response.sendStatus(400);
    response.sendStatus((await findGift(passphrase)) ? 200 : 404);
  } catch (error) {
    next(error);
  }
});

app.get("/api/gifts/:passphrase", async (request, response, next) => {
  try {
    const passphrase = passphraseFrom(request);
    if (!validPassphrase(passphrase)) return response.status(400).json({ error: "INVALID_PASSPHRASE" });
    const data = await findGift(passphrase);
    if (!data) return response.status(404).json({ error: "GIFT_NOT_FOUND" });
    response.set("Cache-Control", "no-store").json(metadataFor(request, passphrase, data));
  } catch (error) {
    next(error);
  }
});

const streamGiftFile = (field) => async (request, response, next) => {
  try {
    const passphrase = passphraseFrom(request);
    if (!validPassphrase(passphrase)) return response.sendStatus(400);
    const data = await findGift(passphrase);
    const path = data?.[field];
    if (!path) return response.sendStatus(404);

    const file = bucket.file(path);
    const [metadata] = await file.getMetadata();
    response.set({
      "Content-Type": metadata.contentType || (field === "modelPath" ? "model/gltf-binary" : "image/png"),
      "Content-Length": metadata.size,
      "Cache-Control": "private, max-age=3600",
      ...(field === "modelPath" ? {
        "Content-Disposition": `attachment; filename="${cleanText(data.fileName, 120).replace(/["\\]/g, "_")}"`,
      } : {}),
    });
    file.createReadStream().on("error", next).pipe(response);
  } catch (error) {
    next(error);
  }
};

app.get("/api/gifts/:passphrase/model", streamGiftFile("modelPath"));
app.get("/api/gifts/:passphrase/preview", streamGiftFile("previewPath"));

app.post(
  "/api/gifts/:passphrase",
  upload.fields([{ name: "model", maxCount: 1 }, { name: "preview", maxCount: 1 }]),
  async (request, response, next) => {
    let modelPath = "";
    let previewPath = "";
    try {
      const passphrase = passphraseFrom(request);
      if (!validPassphrase(passphrase)) return response.status(400).json({ error: "INVALID_PASSPHRASE" });

      const doc = gifts.doc(documentIdFor(passphrase));
      if ((await doc.get()).exists) return response.status(409).json({ error: "PASSPHRASE_IN_USE" });

      const model = request.files?.model?.[0];
      const preview = request.files?.preview?.[0];
      if (!model || model.size < 20 || model.buffer.subarray(0, 4).toString("utf8") !== "glTF") {
        return response.status(415).json({ error: "INVALID_GLB" });
      }
      if (preview && preview.size > 3 * 1024 * 1024) {
        return response.status(413).json({ error: "PREVIEW_TOO_LARGE" });
      }

      let metadata = {};
      try {
        metadata = JSON.parse(String(request.body.metadata || "{}"));
      } catch {
        return response.status(400).json({ error: "INVALID_METADATA" });
      }

      const giftId = crypto.randomUUID();
      modelPath = `${giftId}/gift.glb`;
      const previewExtension = preview?.mimetype === "image/webp" ? "webp" : preview?.mimetype === "image/jpeg" ? "jpg" : "png";
      previewPath = preview ? `${giftId}/preview.${previewExtension}` : "";

      await bucket.file(modelPath).save(model.buffer, {
        resumable: false,
        contentType: "model/gltf-binary",
        metadata: { cacheControl: "private, max-age=3600" },
      });
      if (preview) {
        await bucket.file(previewPath).save(preview.buffer, {
          resumable: false,
          contentType: preview.mimetype || "image/png",
          metadata: { cacheControl: "private, max-age=3600" },
        });
      }

      const data = {
        passphrase,
        modelPath,
        previewPath,
        fileName: cleanText(metadata.fileName, 120) || "nurture-garden-gift.glb",
        kind: metadata.kind === "card" ? "card" : "pot",
        recipient: cleanText(metadata.recipient, 120),
        sender: cleanText(metadata.sender, 120),
        date: cleanText(metadata.date, 40),
        message: cleanText(metadata.message, 2000),
        createdAt: Number(metadata.createdAt) || Date.now(),
      };

      await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(doc);
        if (snapshot.exists) throw Object.assign(new Error("PASSPHRASE_IN_USE"), { status: 409 });
        transaction.create(doc, data);
      });

      response.status(201).json(metadataFor(request, passphrase, data));
    } catch (error) {
      if (modelPath) await bucket.file(modelPath).delete({ ignoreNotFound: true }).catch(() => {});
      if (previewPath) await bucket.file(previewPath).delete({ ignoreNotFound: true }).catch(() => {});
      next(error);
    }
  },
);

app.use((error, _request, response, _next) => {
  if (error instanceof multer.MulterError) {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return response.status(status).json({ error: error.code });
  }
  const status = Number(error?.status) || 500;
  console.error(error);
  response.status(status).json({ error: status === 409 ? "PASSPHRASE_IN_USE" : "INTERNAL_ERROR" });
});

app.listen(port, "0.0.0.0", (error) => {
  if (error) {
    console.error("Gift API could not start", error);
    process.exitCode = 1;
    return;
  }
  console.log(`Nurture Garden gift API listening on ${port}`);
});
