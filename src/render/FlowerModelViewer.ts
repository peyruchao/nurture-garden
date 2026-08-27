import {
  AnimationClip,
  AnimationMixer,
  Box3,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  QuaternionKeyframeTrack,
  Raycaster,
  RepeatWrapping,
  RingGeometry,
  Scene,
  Shape,
  ShapeGeometry,
  Sphere,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { WebIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, dequantize, meshopt, prune, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

type GiftGlbExportMode = "compatible" | "cloud";

type FlowerStage = HTMLElement & {
  __flowerCleanup?: () => void;
  __flowerModelUrl?: string;
  __flowerLanguage?: string;
  __flowerReady?: Promise<void>;
};

type ArrangementStage = HTMLElement & {
  __arrangementCleanup?: () => void;
  __arrangementUpdateItem?: (id: string, patch: Partial<ArrangementItem>) => void;
  __arrangementSetMode?: (mode: ArrangementTransformMode) => void;
  __arrangementExportGlb?: (mode?: GiftGlbExportMode) => Promise<Blob>;
};

type GiftCardStage = HTMLElement & {
  __giftCardCleanup?: () => void;
  __giftCardExportGlb?: (mode?: GiftGlbExportMode) => Promise<Blob>;
};

type ReceivedGiftStage = HTMLElement & {
  __receivedGiftCleanup?: () => void;
};

export interface GiftCardOptions {
  modelUrl?: string;
  modelKind?: string;
  imageUrl?: string;
  recipient?: string;
  sender?: string;
  giftDate?: string;
  message?: string;
  language?: string;
  title?: string;
  date?: string;
  time?: string;
  temperature?: string;
  gardener?: string;
}

export type ArrangementTransformMode = "translate" | "rotate" | "scale";

export interface ArrangementItem {
  id: string;
  type: string;
  modelUrl?: string;
  x?: number;
  y?: number;
  z?: number;
  angle?: number;
  rotationX?: number;
  rotationY?: number;
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
  scale?: number;
}

export type ArrangementVessel = "round" | "rectangle" | "bouquet" | "dish";

interface ArrangementViewerOptions {
  selectedId?: string | null;
  mode?: ArrangementTransformMode;
  readOnly?: boolean;
  onSelect?: (id: string | null) => void;
  onTransform?: (item: ArrangementItem) => void;
  viewRotation?: { x: number; y: number };
  onViewRotation?: (rotation: { x: number; y: number }) => void;
  giftTag?: {
    shape: "round" | "heart" | "square";
    recipient?: string;
    sender?: string;
    date?: string;
    message?: string;
    depth?: number;
    animate?: boolean;
  };
}

const WIDTH = 300;
const HEIGHT = 220;
// Fit every model inside a rotation-safe bounding sphere. The canvas remains
// 300 x 220 so the entire stage stays draggable; only the model is smaller.
const MODEL_MARGIN = 0.9;
const modelLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const modelPromises = new Map<string, Promise<Group>>();
const resolvedModels = new Map<string, Group>();
const modelFits = new Map<string, { center: Vector3; radius: number }>();

async function optimizeGiftGlb(source: ArrayBuffer, mode: GiftGlbExportMode = "compatible") {
  try {
    await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
    const io = new WebIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({
        "meshopt.decoder": MeshoptDecoder,
        "meshopt.encoder": MeshoptEncoder,
      });
    const document = await io.readBinary(new Uint8Array(source));
    if (mode === "cloud") {
      await document.transform(dedup(), prune());
      try {
        await document.transform(textureCompress({ targetFormat: "webp", resize: [1024, 1024] }));
      } catch (error) {
        console.warn("[NurtureGarden] Cloud WebP texture optimization was skipped.", error);
      }
      await document.transform(meshopt({ encoder: MeshoptEncoder, level: "high" }));
      const compressed = await io.writeBinary(document);
      console.info("[NurtureGarden] cloud gift GLB compressed", {
        originalMB: Number((source.byteLength / 1024 / 1024).toFixed(2)),
        finalMB: Number((compressed.byteLength / 1024 / 1024).toFixed(2)),
        uploadLimitMB: 28,
        fitsUploadLimit: compressed.byteLength <= 28 * 1024 * 1024,
        compressionMode: "meshopt-webp",
      });
      return compressed.buffer.slice(compressed.byteOffset, compressed.byteOffset + compressed.byteLength) as ArrayBuffer;
    }
    await document.transform(
      dedup(),
      prune(),
      dequantize(),
      weld(),
      simplify({ simplifier: MeshoptSimplifier, ratio: 0.8, error: 0.0001 }),
    );
    try {
      await document.transform(textureCompress({
        targetFormat: "png",
        formats: /^image\/(?:webp|avif)$/,
        resize: [768, 768],
      }));
      await document.transform(textureCompress({
        targetFormat: "jpeg",
        formats: /^image\/(?:jpeg|png)$/,
        resize: [768, 768],
      }));
    } catch (error) {
      console.warn("[NurtureGarden] JPEG texture optimization was skipped.", error);
    }
    const optimized = await io.writeBinary(document);
    const originalBytes = source.byteLength;
    const optimizedBytes = optimized.byteLength;
    const finalBytes = optimizedBytes;
    console.info("[NurtureGarden] gift GLB optimized", {
      originalMB: Number((originalBytes / 1024 / 1024).toFixed(2)),
      optimizedMB: Number((optimizedBytes / 1024 / 1024).toFixed(2)),
      savedMB: Number(((originalBytes - finalBytes) / 1024 / 1024).toFixed(2)),
      reductionPercent: Number((((originalBytes - finalBytes) / Math.max(1, originalBytes)) * 100).toFixed(1)),
      finalMB: Number((finalBytes / 1024 / 1024).toFixed(2)),
      uploadLimitMB: 28,
      fitsUploadLimit: finalBytes <= 28 * 1024 * 1024,
      optimizerApplied: true,
      compatibilityMode: "core-gltf-jpeg-png",
    });
    return optimized.buffer.slice(optimized.byteOffset, optimized.byteOffset + optimized.byteLength) as ArrayBuffer;
  } catch (error) {
    console.warn("[NurtureGarden] gift GLB optimization was skipped.", {
      originalMB: Number((source.byteLength / 1024 / 1024).toFixed(2)),
      finalMB: Number((source.byteLength / 1024 / 1024).toFixed(2)),
      uploadLimitMB: 28,
      fitsUploadLimit: source.byteLength <= 28 * 1024 * 1024,
      error,
    });
    return source;
  }
}

function wrapCanvasLines(context: CanvasRenderingContext2D, value: string, maxWidth: number, maxLines: number) {
  const lines: string[] = [];
  for (const paragraph of String(value || "").split(/\r?\n/)) {
    if (lines.length >= maxLines) break;
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const glyph of [...paragraph]) {
      const trial = line + glyph;
      if (context.measureText(trial).width > maxWidth && line) {
        lines.push(line);
        line = glyph;
        if (lines.length >= maxLines) break;
      } else line = trial;
    }
    if (line && lines.length < maxLines) lines.push(line);
  }
  return lines.slice(0, maxLines);
}

function createMoonPollenObject(onMesh?: (mesh: Mesh) => void) {
  const pollen = new Group();
  pollen.name = "Moonlight Pollen";
  const material = new MeshPhysicalMaterial({ color: 0xffef9c, emissive: 0x8d742a, emissiveIntensity: 1.55, roughness: 0.28, clearcoat: 0.72 });
  const core = new Mesh(new SphereGeometry(0.105, 18, 14), material);
  core.scale.set(1, 0.72, 1);
  onMesh?.(core);
  pollen.add(core);
  for (let index = 0; index < 28; index += 1) {
    const speck = new Mesh(new SphereGeometry(0.048 + (index % 3) * 0.014, 12, 9), material);
    const angle = index * 2.399;
    const radius = 0.14 + (index % 6) * 0.042;
    speck.position.set(Math.cos(angle) * radius, Math.sin(index * 1.7) * 0.18, Math.sin(angle) * radius * 0.78);
    onMesh?.(speck);
    pollen.add(speck);
  }
  return pollen;
}

function createJapaneseWoodTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#b9824f");
  gradient.addColorStop(0.5, "#8c5834");
  gradient.addColorStop(1, "#6e4027");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalAlpha = 0.32;
  for (let line = 0; line < 18; line += 1) {
    const y = 4 + line * 7;
    context.strokeStyle = line % 3 ? "#4a2819" : "#e0a66a";
    context.lineWidth = line % 4 === 0 ? 1.7 : 0.8;
    context.beginPath();
    for (let x = 0; x <= canvas.width; x += 4) {
      const wave = Math.sin(x * 0.045 + line * 0.8) * (2.2 + (line % 3));
      if (x === 0) context.moveTo(x, y + wave);
      else context.lineTo(x, y + wave);
    }
    context.stroke();
  }
  context.globalAlpha = 0.24;
  for (let knot = 0; knot < 5; knot += 1) {
    context.strokeStyle = "#321b12";
    context.beginPath();
    context.ellipse(35 + knot * 47, 30 + (knot % 2) * 52, 14, 4.5, 0, 0, Math.PI * 2);
    context.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(2.4, 1.2);
  return texture;
}

function measureModel(model: Group, modelUrl: string) {
  const cached = modelFits.get(modelUrl);
  if (cached) return cached;

  model.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(model, true);
  const center = bounds.getCenter(new Vector3());
  const fallbackSphere = bounds.getBoundingSphere(new Sphere());
  const point = new Vector3();
  let radiusSquared = 0;

  // Measure actual rendered vertices instead of the empty corners of an AABB.
  // This makes sparse flowers visibly larger while the resulting sphere still
  // guarantees that no petal can be clipped at any drag angle.
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const position = object.geometry.getAttribute("position");
    if (!position) return;
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
      radiusSquared = Math.max(radiusSquared, point.distanceToSquared(center));
    }
  });

  const fit = {
    center: center.clone(),
    radius: radiusSquared > 0 ? Math.sqrt(radiusSquared) : fallbackSphere.radius,
  };
  modelFits.set(modelUrl, fit);
  return fit;
}

const purpleTextureUrl = (modelUrl: string, part: string) =>
  modelUrl.replace(/purple_flower\.glb(?:\?.*)?$/, `purple_flower_${part}.webp`);

async function restorePurpleFlowerMaterials(model: Group, modelUrl: string) {
  if (!/purple_flower\.glb(?:\?.*)?$/.test(modelUrl)) return;

  const loader = new TextureLoader();
  const textures = await Promise.all(
    ["stem", "bloom", "leaf"].map((part) =>
      loader.loadAsync(purpleTextureUrl(modelUrl, part)),
    ),
  );
  textures.forEach((texture) => {
    texture.colorSpace = SRGBColorSpace;
    texture.flipY = false;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.needsUpdate = true;
  });
  const [stemTexture, bloomTexture, leafTexture] = textures;

  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const name = object.name.toLowerCase();
    let map: Texture = stemTexture;
    let alphaTest = 0;
    if (name.includes("hoa_mat")) {
      map = bloomTexture;
      alphaTest = 0.18;
    } else if (!name.includes("than_mat")) {
      map = leafTexture;
      alphaTest = 0.18;
    }
    const previous = object.material;
    object.material = new MeshStandardMaterial({
      map,
      alphaTest,
      side: DoubleSide,
      metalness: 0,
      roughness: name.includes("hoa_mat") ? 0.62 : 0.82,
    });
    if (Array.isArray(previous)) previous.forEach((material) => material.dispose());
    else previous.dispose();
  });
}

function loadPreparedModel(modelUrl: string) {
  const existing = modelPromises.get(modelUrl);
  if (existing) return existing;
  const pending = modelLoader.loadAsync(modelUrl).then(async (gltf) => {
    const model = gltf.scene;
    await restorePurpleFlowerMaterials(model, modelUrl);
    resolvedModels.set(modelUrl, model);
    return model;
  });
  modelPromises.set(modelUrl, pending);
  return pending;
}

export function preloadFlowerModels(modelUrls: string[]) {
  return Promise.allSettled(
    [...new Set(modelUrls.filter(Boolean))].map((modelUrl) => loadPreparedModel(modelUrl)),
  );
}

export function createFlowerViewer(
  stage: FlowerStage,
  modelUrl: string,
  language: string,
  onError?: () => void,
  options: { kind?: "flower" | "gem" | "treasure" } = {},
) {
  const kind = options.kind ?? "flower";
  if (
    stage.__flowerModelUrl === modelUrl &&
    stage.__flowerLanguage === language &&
    stage.querySelector(
      kind === "gem"
        ? ".aps-gem-model"
        : kind === "treasure"
          ? ".aps-treasure-model"
          : ".aps-flower-model",
    )
  ) {
    console.info(
      `[NurtureGarden] flower-viewer-reused ${JSON.stringify({ modelUrl })}`,
    );
    return stage.__flowerReady ?? Promise.resolve();
  }

  stage.__flowerCleanup?.();
  stage.replaceChildren();
  stage.hidden = false;
  stage.onpointerdown = null;
  stage.onpointermove = null;
  stage.onpointerup = null;
  stage.onpointercancel = null;
  stage.__flowerModelUrl = modelUrl;
  stage.__flowerLanguage = language;
  console.info(
    `[NurtureGarden] flower-viewer-start ${JSON.stringify({ modelUrl })}`,
  );

  const loading = document.createElement("span");
  loading.className = "aps-flower-loading";
  loading.textContent = kind === "gem"
    ? language === "en" ? "CRYSTALLIZING GEM…" : "正在凝聚發光寶石…"
    : kind === "treasure"
      ? language === "en" ? "AWAKENING 3D TREASURE…" : "正在喚醒 3D 藴育物…"
      : language === "en" ? "GROWING 3D FLOWER…" : "正在綻放 3D 花朵…";

  const renderer = new WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = kind === "gem"
    ? "aps-gem-model"
    : kind === "treasure"
      ? "aps-treasure-model"
      : "aps-flower-model";
  renderer.domElement.style.pointerEvents = "none";
  renderer.domElement.setAttribute(
    "aria-label",
    kind === "gem"
      ? language === "en" ? "A glowing 3D gem" : "藴育出的 3D 發光寶石"
      : kind === "treasure"
        ? language === "en" ? "A draggable 3D nurtured treasure" : "可拖曳查看的 3D 藴育物"
        : language === "en" ? "A nurtured 3D flower" : "藴育出的 3D 花朵",
  );
  stage.append(loading, renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(26, WIDTH / HEIGHT, 0.01, 100);
  camera.position.set(0, 0, 4.2);
  camera.lookAt(0, 0, 0);
  scene.add(new HemisphereLight(0xfff4da, 0x26334a, 2.4));
  const key = new DirectionalLight(new Color(0xffe4ae), 3.2);
  key.position.set(3, 4, 5);
  scene.add(key);
  const rim = new DirectionalLight(new Color(0xc7d7ff), 1.8);
  rim.position.set(-4, 2, -3);
  scene.add(rim);

  const flower = new Group();
  flower.rotation.set(-0.12, 0.4, 0);
  scene.add(flower);

  let frame = 0;
  let disposed = false;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let lastInteraction = performance.now();

  const render = () => {
    if (disposed || !stage.isConnected) return;
    if (!dragging && performance.now() - lastInteraction > 1200) {
      flower.rotation.y += 0.0035;
    }
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };

  const mountModel = (source: Group) => {
      if (disposed) return;
      const model = source.clone(true);
      const normalizedModel = new Group();
      normalizedModel.add(model);
      const { center, radius } = measureModel(source, modelUrl);
      // Center the source inside an untransformed wrapper, then scale the
      // wrapper. Scaling the model itself after moving it caused the original
      // offset to survive, which pushed some flowers to the top of the stage.
      model.position.sub(center);
      const verticalHalfView = camera.position.z * Math.sin((camera.fov * Math.PI) / 360);
      const safeRadius = verticalHalfView * MODEL_MARGIN;
      const fittedScale = safeRadius / Math.max(radius, 0.0001);
      normalizedModel.scale.setScalar(fittedScale);
      flower.add(normalizedModel);
      loading.remove();
      console.info(
        `[NurtureGarden] flower-viewer-ready ${JSON.stringify({ modelUrl, cached: resolvedModels.has(modelUrl), fittedScale, radius })}`,
      );
  };
  const failModel = (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      loading.textContent =
        language === "en" ? "3D MODEL COULD NOT APPEAR" : "3D 模型載入失敗";
      console.error(
        `[NurtureGarden] flower-viewer-error ${JSON.stringify({ modelUrl, message })}`,
      );
      onError?.();
  };
  const cachedModel = resolvedModels.get(modelUrl);
  const ready = cachedModel
    ? Promise.resolve().then(() => mountModel(cachedModel))
    : loadPreparedModel(modelUrl).then(mountModel).catch(failModel);
  stage.__flowerReady = ready;

  const pointerDown = (event: PointerEvent) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    lastInteraction = performance.now();
    stage.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    flower.rotation.y += (event.clientX - lastX) * 0.012;
    flower.rotation.x = Math.max(
      -0.9,
      Math.min(0.65, flower.rotation.x + (event.clientY - lastY) * 0.009),
    );
    lastX = event.clientX;
    lastY = event.clientY;
    lastInteraction = performance.now();
  };
  const pointerUp = (event: PointerEvent) => {
    dragging = false;
    lastInteraction = performance.now();
    if (stage.hasPointerCapture(event.pointerId)) {
      stage.releasePointerCapture(event.pointerId);
    }
  };

  stage.addEventListener("pointerdown", pointerDown);
  stage.addEventListener("pointermove", pointerMove);
  stage.addEventListener("pointerup", pointerUp);
  stage.addEventListener("pointercancel", pointerUp);
  render();

  stage.__flowerCleanup = () => {
    disposed = true;
    cancelAnimationFrame(frame);
    stage.removeEventListener("pointerdown", pointerDown);
    stage.removeEventListener("pointermove", pointerMove);
    stage.removeEventListener("pointerup", pointerUp);
    stage.removeEventListener("pointercancel", pointerUp);
    renderer.dispose();
    renderer.forceContextLoss();
    stage.__flowerModelUrl = undefined;
    stage.__flowerLanguage = undefined;
    stage.__flowerReady = undefined;
    stage.__flowerCleanup = undefined;
  };

  return ready;
}

/**
 * A lightweight bouquet composer used by the Collection mockup. It reuses the
 * exact GLB collectibles already loaded by the single-object viewer, then
 * arranges them in a procedural vessel so the result stays genuinely 3D.
 */
export function createArrangementViewer(
  stage: ArrangementStage,
  items: ArrangementItem[],
  vessel: ArrangementVessel = "round",
  language = "zh",
  options: ArrangementViewerOptions = {},
) {
  stage.__arrangementCleanup?.();
  stage.replaceChildren();

  const loading = document.createElement("span");
  loading.className = "aps-arrangement-loading";
  loading.textContent = language === "en" ? "ARRANGING YOUR GARDEN…" : "正在整理你的花園…";
  stage.append(loading);

  const width = Math.max(1, stage.clientWidth || 640);
  const height = Math.max(1, stage.clientHeight || 520);
  const renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  const arrangementPixelRatio = options.readOnly && stage.classList.contains("aps-gift-card-stage")
    ? Math.min(Math.max(window.devicePixelRatio || 1, 2.5), 4)
    : Math.min(Math.max(window.devicePixelRatio || 1, 1.5), 3);
  renderer.setPixelRatio(arrangementPixelRatio);
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = "aps-arrangement-canvas";
  renderer.domElement.setAttribute("aria-label", language === "en" ? "Rotatable 3D floral arrangement" : "可旋轉的 3D 盆栽插花");
  stage.append(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, width / height, 0.01, 100);
  camera.position.set(0, 1.15, 7.2);
  camera.lookAt(0, 0.45, 0);
  scene.add(new HemisphereLight(0xfff2d5, 0x172638, 3));
  const key = new DirectionalLight(new Color(0xffd89b), 4.2);
  key.position.set(4, 6, 5);
  scene.add(key);
  const rim = new DirectionalLight(new Color(0x9fc8ff), 2.4);
  rim.position.set(-5, 3, -4);
  scene.add(rim);

  const arrangement = new Group();
  arrangement.position.y = -0.72;
  // The arrangement never spins by itself. Dragging empty space rotates it;
  // dragging a collectible moves that individual piece instead.
  // Once a gift note is planted, the editor's default view is the authored
  // front instead of the view angle that happened to be saved on completion.
  arrangement.rotation.set(
    options.giftTag ? 0 : (options.viewRotation?.x ?? 0),
    options.giftTag ? 0 : (options.viewRotation?.y ?? 0),
    0,
  );
  scene.add(arrangement);
  const transformControls = new TransformControls(camera, renderer.domElement);
  let currentMode: ArrangementTransformMode = options.mode ?? "translate";
  transformControls.setMode(currentMode === "scale" ? "translate" : currentMode);
  transformControls.setSpace("local");
  transformControls.setSize(0.72);
  scene.add(transformControls.getHelper());

  const vesselGroup = new Group();
  vesselGroup.name = `NurtureGarden_${vessel}_vessel`;
  arrangement.add(vesselGroup);
  const addVesselMesh = (mesh: Mesh, name: string) => {
    mesh.name = name;
    mesh.userData.vessel = true;
    vesselGroup.add(mesh);
    return mesh;
  };
  const soilMaterial = new MeshStandardMaterial({ color: 0x33281f, roughness: 1 });

  if (vessel === "round") {
    const material = new MeshPhysicalMaterial({ color: 0xd8d1c4, roughness: 0.88, metalness: 0.02, clearcoat: 0.08 });
    const body = addVesselMesh(new Mesh(new CylinderGeometry(0.76, 0.54, 1.18, 48), material), "Round ceramic vessel");
    body.position.y = -0.56;
    const rimMaterial = material.clone();
    rimMaterial.color.offsetHSL(0, 0, 0.08);
    const vesselRim = addVesselMesh(new Mesh(new CylinderGeometry(0.86, 0.78, 0.2, 48), rimMaterial), "Round ceramic rim");
    vesselRim.position.y = 0.04;
    const soil = addVesselMesh(new Mesh(new CircleGeometry(0.72, 48), soilMaterial), "Round vessel soil");
    soil.rotation.x = -Math.PI / 2;
    soil.position.y = 0.151;
  } else if (vessel === "rectangle") {
    const woodTexture = createJapaneseWoodTexture();
    const material = new MeshPhysicalMaterial({ color: 0xc28a55, map: woodTexture, roughness: 0.82, metalness: 0, clearcoat: 0.08 });
    const body = addVesselMesh(new Mesh(new BoxGeometry(1.76, 0.78, 1.04), material), "Japanese cedar planter");
    body.position.y = -0.34;
    const darkWood = new MeshPhysicalMaterial({ color: 0x3d2518, roughness: 0.9, metalness: 0 });
    const vesselRim = addVesselMesh(new Mesh(new BoxGeometry(1.94, 0.16, 1.2), darkWood), "Japanese planter dark rim");
    vesselRim.position.y = 0.1;
    const soil = addVesselMesh(new Mesh(new BoxGeometry(1.54, 0.055, 0.9), soilMaterial), "Rectangular planter soil");
    soil.position.y = 0.19;
    [-0.58, 0, 0.58].forEach((x) => {
      const slat = addVesselMesh(new Mesh(new BoxGeometry(0.045, 0.62, 1.075), darkWood), "Japanese planter joinery");
      slat.position.set(x, -0.34, 0);
    });
    [-0.67, 0.67].forEach((x) => {
      const foot = addVesselMesh(new Mesh(new BoxGeometry(0.18, 0.17, 0.84), darkWood), "Japanese planter foot");
      foot.position.set(x, -0.82, 0);
    });
  } else if (vessel === "bouquet") {
    const paper = new MeshPhysicalMaterial({ color: 0xd8ad93, roughness: 0.76, metalness: 0, side: DoubleSide });
    const wrap = addVesselMesh(new Mesh(new ConeGeometry(0.92, 1.68, 48, 1, true), paper), "Bouquet paper wrap");
    wrap.rotation.z = Math.PI;
    wrap.position.y = -0.45;
    const collar = addVesselMesh(
      new Mesh(new CylinderGeometry(0.92, 0.86, 0.13, 48, 1, true), paper.clone()),
      "Bouquet paper collar",
    );
    collar.position.y = 0.36;
    const ribbon = addVesselMesh(
      new Mesh(new CylinderGeometry(0.25, 0.25, 0.16, 32), new MeshPhysicalMaterial({ color: 0xead18e, roughness: 0.58 })),
      "Bouquet ribbon",
    );
    ribbon.position.y = -0.27;
  } else {
    const material = new MeshPhysicalMaterial({ color: 0x879b90, roughness: 0.48, metalness: 0.02, clearcoat: 0.42 });
    const dish = addVesselMesh(new Mesh(new CylinderGeometry(1.16, 0.96, 0.34, 56), material), "Round dish");
    dish.position.y = -0.12;
    const rimMaterial = material.clone();
    rimMaterial.color.offsetHSL(0, 0, 0.08);
    const vesselRim = addVesselMesh(new Mesh(new CylinderGeometry(1.24, 1.13, 0.12, 56), rimMaterial), "Round dish rim");
    vesselRim.position.y = 0.06;
    const soil = addVesselMesh(new Mesh(new CircleGeometry(1.05, 56), soilMaterial), "Round dish soil");
    soil.rotation.x = -Math.PI / 2;
    soil.position.y = 0.135;
  }

  let giftTagGroup: Group | null = null;
  let giftTagAnimationStart = 0;
  let giftTagRestY = 0;
  if (options.giftTag) {
    const tag = options.giftTag;
    const insertionDepth = Math.max(0, Math.min(100, tag.depth ?? 25));
    // Keep the previous deepest position at 100%, while extending the range
    // upward so low values plant the note more shallowly.
    giftTagRestY = 0.42 - insertionDepth * 0.0102;
    giftTagGroup = new Group();
    giftTagGroup.name = "Nurture Garden planted gift note";
    // Keep the original placement inside the vessel on its right side.
    giftTagGroup.position.set(vessel === "rectangle" ? 0.72 : 0.58, tag.animate ? giftTagRestY + 1.65 : giftTagRestY, 0.34);
    giftTagGroup.rotation.z = -0.1;
    arrangement.add(giftTagGroup);
    const stem = new Mesh(new CylinderGeometry(0.018, 0.018, 1.05, 12), new MeshStandardMaterial({ color: 0x7b5a38, roughness: 0.9 }));
    stem.position.y = 0.62;
    giftTagGroup.add(stem);
    const noteCanvas = document.createElement("canvas");
    const noteWidth = 512;
    const noteHeight = 420;
    const noteResolutionScale = 2;
    noteCanvas.width = noteWidth * noteResolutionScale;
    noteCanvas.height = noteHeight * noteResolutionScale;
    const noteContext = noteCanvas.getContext("2d");
    const drawNote = () => {
      if (!noteContext) return;
      noteContext.setTransform(noteResolutionScale, 0, 0, noteResolutionScale, 0, 0);
      noteContext.clearRect(0, 0, noteWidth, noteHeight);
      const paperColor = tag.shape === "heart" ? "#eab3b4" : tag.shape === "round" ? "#eadb9d" : "#d8e2cc";
      noteContext.fillStyle = paperColor;
      noteContext.fillRect(0, 0, noteWidth, noteHeight);
      noteContext.fillStyle = "#1d2832";
      noteContext.font = "700 24px Inter, system-ui, sans-serif";
      noteContext.textAlign = "center";
      noteContext.fillText("◐ NURTURE GARDEN", 256, tag.shape === "heart" ? 142 : 92, 300);
      noteContext.fillStyle = "#17232d";
      noteContext.font = "italic 800 36px Palatino, serif";
      noteContext.fillText(tag.recipient?.trim() ? `FOR ${tag.recipient.trim()}` : "FOR YOU", 256, tag.shape === "heart" ? 208 : 178, 330);
      noteContext.font = "italic 700 25px Palatino, serif";
      const messageLines = wrapCanvasLines(noteContext, (tag.message || "Grown with care").trim(), tag.shape === "heart" ? 290 : 350, 3);
      const messageStartY = tag.shape === "heart" ? 250 : 224;
      messageLines.forEach((line, index) => noteContext.fillText(line, 256, messageStartY + index * 31));
      noteContext.fillStyle = "rgba(23,35,45,.72)";
      noteContext.font = "italic 700 20px Palatino, serif";
      const signature = [tag.sender?.trim() ? `FROM ${tag.sender.trim()}` : "", tag.date || ""].filter(Boolean).join(" · ");
      noteContext.fillText(signature, 256, tag.shape === "heart" ? 354 : 348, tag.shape === "heart" ? 245 : 350);
    };
    drawNote();
    const noteTexture = new CanvasTexture(noteCanvas);
    noteTexture.colorSpace = SRGBColorSpace;
    const noteMaterial = new MeshStandardMaterial({ map: noteTexture, roughness: 0.82, metalness: 0, side: DoubleSide });
    let noteGeometry;
    if (tag.shape === "round") noteGeometry = new CircleGeometry(0.34, 40);
    else if (tag.shape === "heart") {
      const heart = new Shape();
      heart.moveTo(0, -0.3);heart.bezierCurveTo(-0.48, -0.02, -0.4, 0.34, -0.17, 0.34);heart.bezierCurveTo(-0.04, 0.34, 0, 0.23, 0, 0.18);heart.bezierCurveTo(0, 0.23, 0.04, 0.34, 0.17, 0.34);heart.bezierCurveTo(0.4, 0.34, 0.48, -0.02, 0, -0.3);
      noteGeometry = new ShapeGeometry(heart, 8);
    } else noteGeometry = new PlaneGeometry(0.68, 0.52);
    noteGeometry.computeBoundingBox();
    const noteBounds = noteGeometry.boundingBox;
    const notePositions = noteGeometry.getAttribute("position");
    const noteUvs = noteGeometry.getAttribute("uv");
    if (noteBounds && noteUvs) {
      const noteWidth = Math.max(0.001, noteBounds.max.x - noteBounds.min.x);
      const noteHeight = Math.max(0.001, noteBounds.max.y - noteBounds.min.y);
      for (let index = 0; index < notePositions.count; index += 1) {
        noteUvs.setXY(
          index,
          (notePositions.getX(index) - noteBounds.min.x) / noteWidth,
          (notePositions.getY(index) - noteBounds.min.y) / noteHeight,
        );
      }
      noteUvs.needsUpdate = true;
    }
    const note = new Mesh(noteGeometry, noteMaterial);
    note.name = `${tag.shape} gift note`;
    note.position.set(0, 1.18, 0);
    note.scale.setScalar(1.25);
    giftTagGroup.add(note);
    const noteBack = note.clone();
    noteBack.material = new MeshStandardMaterial({ color: tag.shape === "heart" ? 0xb96f78 : tag.shape === "round" ? 0xb89d58 : 0x849879, roughness: 0.9 });
    noteBack.position.z = -0.035;
    noteBack.rotation.y = Math.PI;
    giftTagGroup.add(noteBack);
    if (tag.animate) giftTagAnimationStart = performance.now();
  }

  const shadow = new Mesh(
    new CircleGeometry(vessel === "rectangle" ? 1.48 : 1.35, 48),
    new MeshStandardMaterial({ color: 0x05080d, transparent: true, opacity: 0.3 }),
  );
  shadow.name = "Editor shadow";
  shadow.userData.editorOnly = true;
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = vessel === "bouquet" ? -1.31 : -1.17;
  shadow.scale.y = 0.38;
  vesselGroup.add(shadow);

  const defaultSlots = [
    { x: 0, y: 0.08, z: -0.08, angle: 0 },
    { x: -0.42, y: 0.05, z: 0.02, angle: 14 },
    { x: 0.42, y: 0.05, z: 0.08, angle: -14 },
    { x: -0.7, y: -0.02, z: -0.16, angle: 24 },
    { x: 0.7, y: -0.02, z: -0.12, angle: -24 },
    { x: -0.24, y: -0.02, z: 0.34, angle: 8 },
    { x: 0.28, y: -0.02, z: 0.38, angle: -8 },
  ];
  const wrappers = new Map<string, Group>();
  const pickTargets: Mesh[] = [];
  const selectionRing = new Mesh(
    new RingGeometry(0.16, 0.21, 32),
    new MeshStandardMaterial({ color: 0xf3d98f, emissive: 0x6a5324, transparent: true, opacity: 0.9, side: DoubleSide }),
  );
  selectionRing.rotation.x = -Math.PI / 2;
  selectionRing.visible = false;
  selectionRing.name = "Editor selection ring";
  selectionRing.userData.editorOnly = true;
  arrangement.add(selectionRing);

  let disposed = false;
  let frame = 0;
  let draggingItemId: string | null = null;
  let rightDraggingItem = false;
  let rotatingView = false;
  let lastX = 0;
  let lastY = 0;
  let selectedId = options.selectedId ?? null;
  const raycaster = new Raycaster();
  const pointer = new Vector2();

  const defaultTransform = (item: ArrangementItem, index: number) => {
    const slot = defaultSlots[index] ?? defaultSlots[index % defaultSlots.length];
    const isAccent = ["gem", "moss", "glowMoss", "moonPollen"].includes(item.type);
    const uniformScale = item.scale ?? item.scaleX ?? item.scaleY ?? item.scaleZ ?? 1;
    return {
      x: item.x ?? slot.x,
      y: item.y ?? (isAccent ? 0.12 : slot.y),
      z: item.z ?? (isAccent ? 0.46 - index * 0.035 : slot.z),
      angle: item.angle ?? (isAccent ? 0 : slot.angle),
      rotationX: item.rotationX ?? 0,
      rotationY: item.rotationY ?? 0,
      scale: uniformScale,
      scaleX: uniformScale,
      scaleY: uniformScale,
      scaleZ: uniformScale,
    };
  };
  items.forEach((item, index) => Object.assign(item, defaultTransform(item, index)));

  const applyItemTransform = (item: ArrangementItem) => {
    const wrapper = wrappers.get(item.id);
    if (!wrapper) return;
    wrapper.position.set(item.x ?? 0, item.y ?? 0.08, item.z ?? 0);
    wrapper.rotation.set(item.rotationX ?? 0, item.rotationY ?? 0, ((item.angle ?? 0) * Math.PI) / 180);
    const baseScale = wrapper.userData.baseScale ?? 1;
    const uniformScale = item.scale ?? item.scaleX ?? item.scaleY ?? item.scaleZ ?? 1;
    wrapper.scale.setScalar(baseScale * uniformScale);
    if (selectedId === item.id) {
      selectionRing.position.set(item.x ?? 0, (item.y ?? 0) + 0.17, item.z ?? 0);
      selectionRing.visible = true;
    }
  };
  const setSelected = (id: string | null) => {
    selectedId = id;
    selectionRing.visible = false;
    if (id) {
      const item = items.find((candidate) => candidate.id === id);
      const wrapper = wrappers.get(id);
      if (item) applyItemTransform(item);
      if (wrapper?.parent && currentMode !== "scale") transformControls.attach(wrapper);
    } else transformControls.detach();
    options.onSelect?.(id);
  };
  const makePollen = (itemId: string) => {
    const pollen = createMoonPollenObject((speck) => {
      speck.userData.itemId = itemId;
      pickTargets.push(speck);
    });
    pollen.position.y = 0.18;
    return pollen;
  };

  const itemReady = Promise.allSettled(items.slice(0, 15).map(async (item) => {
    if (disposed) return;
    const wrapper = new Group();
    wrapper.userData.itemId = item.id;
    wrapper.userData.baseScale = 1;
    wrappers.set(item.id, wrapper);
    if (item.type === "moonPollen" || !item.modelUrl) {
      wrapper.userData.baseScale = item.type === "moonPollen" ? 1.35 : 1;
      wrapper.add(makePollen(item.id));
    } else {
      const source = await loadPreparedModel(item.modelUrl);
      if (disposed) return;
      const model = source.clone(true);
      const bounds = new Box3().setFromObject(source, true);
      const center = bounds.getCenter(new Vector3());
      const size = bounds.getSize(new Vector3());
      model.position.set(-center.x, -bounds.min.y, -center.z);
      const isAccent = item.type === "gem" || item.type === "moss" || item.type === "glowMoss";
      const targetHeight = isAccent ? 0.62 : 1.92;
      wrapper.userData.baseScale = targetHeight / Math.max(size.y, size.x, 0.001);
      model.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.userData.itemId = item.id;
        pickTargets.push(object);
      });
      wrapper.add(model);
    }
    arrangement.add(wrapper);
    applyItemTransform(item);
    if (selectedId === item.id) setSelected(item.id);
  })).finally(() => {
    if (!disposed) loading.remove();
  });
  const ready = itemReady;

  if (!items.length) loading.textContent = language === "en" ? "CHOOSE A BLOOM FROM YOUR COLLECTION" : "從收藏選一朵花開始";

  const render = () => {
    if (disposed || !stage.isConnected) return;
    if (giftTagGroup && giftTagAnimationStart) {
      const progress = Math.min(1, (performance.now() - giftTagAnimationStart) / 1350);
      const eased = 1 - Math.pow(1 - progress, 3);
      giftTagGroup.position.y = giftTagRestY + (1 - eased) * 1.65;
      giftTagGroup.rotation.z = -0.1 + Math.sin(progress * Math.PI) * 0.08;
      if (progress >= 1) giftTagAnimationStart = 0;
    }
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };
  const resize = () => {
    if (disposed) return;
    const nextWidth = Math.max(1, stage.clientWidth || width);
    const nextHeight = Math.max(1, stage.clientHeight || height);
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(nextWidth, nextHeight, false);
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  transformControls.addEventListener("objectChange", () => {
    const wrapper = transformControls.object as Group | undefined;
    const itemId = wrapper?.userData.itemId as string | undefined;
    const item = items.find((candidate) => candidate.id === itemId);
    if (!wrapper || !item) return;
    const baseScale = wrapper.userData.baseScale || 1;
    item.x = wrapper.position.x;
    item.y = wrapper.position.y;
    item.z = wrapper.position.z;
    item.rotationX = wrapper.rotation.x;
    item.rotationY = wrapper.rotation.y;
    item.angle = Math.round((wrapper.rotation.z * 180) / Math.PI);
    const uniformScale = wrapper.scale.x / baseScale;
    item.scale = uniformScale;
    item.scaleX = uniformScale;
    item.scaleY = uniformScale;
    item.scaleZ = uniformScale;
    stage.dataset.lastMovedItem = item.id;
    options.onTransform?.(item);
  });
  const hitItem = (event: PointerEvent) => {
    const rect = stage.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickTargets, false)[0];
    return hit?.object.userData.itemId as string | undefined;
  };
  const pointerDown = (event: PointerEvent) => {
    const isRightButton = event.button === 2;
    if (options.readOnly) {
      if (isRightButton) event.preventDefault();
      draggingItemId = null;
      rightDraggingItem = false;
      rotatingView = true;
      lastX = event.clientX;
      lastY = event.clientY;
      stage.setPointerCapture(event.pointerId);
      return;
    }
    if (transformControls.axis && !isRightButton) {
      rotatingView = false;
      draggingItemId = null;
      return;
    }
    const itemId = hitItem(event);
    if (isRightButton) {
      event.preventDefault();
      rotatingView = false;
      draggingItemId = itemId ?? null;
      rightDraggingItem = Boolean(itemId);
      if (!itemId) return;
      setSelected(itemId);
      stage.dataset.rightDrag = "selected";
      lastX = event.clientX;
      lastY = event.clientY;
      stage.setPointerCapture(event.pointerId);
      return;
    }
    if (itemId) {
      draggingItemId = currentMode === "translate" ? itemId : null;
      rightDraggingItem = false;
      rotatingView = false;
      setSelected(itemId);
    } else {
      draggingItemId = null;
      rightDraggingItem = false;
      rotatingView = true;
      setSelected(null);
    }
    lastX = event.clientX;
    lastY = event.clientY;
    stage.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent) => {
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    if (draggingItemId) {
      const item = items.find((candidate) => candidate.id === draggingItemId);
      if (item) {
        item.x = Math.max(-1.15, Math.min(1.15, (item.x ?? 0) + (dx / Math.max(stage.clientWidth, 1)) * 3.25));
        item.y = Math.max(-0.08, Math.min(1.25, (item.y ?? 0.08) - (dy / Math.max(stage.clientHeight, 1)) * 2.8));
        applyItemTransform(item);
        stage.dataset.lastMovedItem = item.id;
        if (rightDraggingItem) stage.dataset.rightDrag = "moved";
        options.onTransform?.(item);
      }
    } else if (rotatingView) {
      arrangement.rotation.y += dx * 0.012;
      arrangement.rotation.x = Math.max(-0.78, Math.min(0.78, arrangement.rotation.x + dy * 0.009));
      stage.dataset.viewRotation = `${arrangement.rotation.x.toFixed(3)},${arrangement.rotation.y.toFixed(3)}`;
      options.onViewRotation?.({ x: arrangement.rotation.x, y: arrangement.rotation.y });
    } else return;
    lastX = event.clientX;
    lastY = event.clientY;
  };
  const pointerUp = (event: PointerEvent) => {
    draggingItemId = null;
    rightDraggingItem = false;
    rotatingView = false;
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  };
  stage.addEventListener("pointerdown", pointerDown);
  stage.addEventListener("pointermove", pointerMove);
  stage.addEventListener("pointerup", pointerUp);
  stage.addEventListener("pointercancel", pointerUp);
  const preventContextMenu = (event: MouseEvent) => event.preventDefault();
  stage.addEventListener("contextmenu", preventContextMenu);
  stage.__arrangementUpdateItem = (id, patch) => {
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return;
    Object.assign(item, patch);
    applyItemTransform(item);
  };
  stage.__arrangementSetMode = (mode) => {
    currentMode = mode;
    if (mode === "scale") {
      transformControls.detach();
      return;
    }
    transformControls.setMode(mode);
    const wrapper = selectedId ? wrappers.get(selectedId) : undefined;
    if (wrapper?.parent) transformControls.attach(wrapper);
  };
  stage.__arrangementExportGlb = async (mode = "compatible") => {
    await ready;
    if (disposed) throw new Error("The arrangement editor has already been closed.");
    transformControls.detach();
    selectionRing.visible = false;
    const exportRoot = arrangement.clone(true);
    exportRoot.name = "Nurture Garden Arrangement";
    exportRoot.rotation.set(0, 0, 0);
    const editorOnly: Object3D[] = [];
    exportRoot.traverse((object) => {
      if (object.userData.editorOnly) editorOnly.push(object);
    });
    editorOnly.forEach((object) => object.removeFromParent());
    const result = await new GLTFExporter().parseAsync(exportRoot, {
      binary: true,
      onlyVisible: true,
      trs: true,
      maxTextureSize: 1024,
    });
    if (!(result instanceof ArrayBuffer)) throw new Error("GLB exporter returned an unexpected result.");
    if (selectedId) setSelected(selectedId);
    return new Blob([await optimizeGiftGlb(result, mode)], { type: "model/gltf-binary" });
  };
  if (selectedId) setSelected(selectedId);
  render();

  stage.__arrangementCleanup = () => {
    disposed = true;
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    stage.removeEventListener("pointerdown", pointerDown);
    stage.removeEventListener("pointermove", pointerMove);
    stage.removeEventListener("pointerup", pointerUp);
    stage.removeEventListener("pointercancel", pointerUp);
    stage.removeEventListener("contextmenu", preventContextMenu);
    renderer.dispose();
    renderer.forceContextLoss();
    transformControls.detach();
    transformControls.dispose();
    scene.remove(transformControls.getHelper());
    stage.__arrangementUpdateItem = undefined;
    stage.__arrangementSetMode = undefined;
    stage.__arrangementExportGlb = undefined;
    delete stage.dataset.lastMovedItem;
    delete stage.dataset.viewRotation;
    delete stage.dataset.rightDrag;
    stage.__arrangementCleanup = undefined;
  };
  return ready;
}

export function createGiftCardViewer(stage: GiftCardStage, options: GiftCardOptions) {
  stage.__giftCardCleanup?.();
  stage.replaceChildren();

  const width = Math.max(300, stage.clientWidth || 520);
  const height = Math.max(260, stage.clientHeight || 420);
  const renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(Math.max(window.devicePixelRatio || 1, 2.5), 4));
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.domElement.setAttribute("aria-label", "Interactive Nurture Garden GLB gift card");
  stage.append(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(34, width / height, 0.1, 100);
  camera.position.set(0, 0.1, 8.8);
  scene.add(new HemisphereLight(0xfff5d8, 0x19243a, 2.5));
  const key = new DirectionalLight(0xffedbd, 4.2);
  key.position.set(4, 6, 8);
  scene.add(key);
  const rim = new DirectionalLight(0xaac7ff, 2.4);
  rim.position.set(-5, 2, 3);
  scene.add(rim);

  const card = new Group();
  card.rotation.set(-0.06, 0.14, 0);
  scene.add(card);
  const back = new Mesh(
    new BoxGeometry(5.05, 3.55, 0.18, 2, 2, 1),
    new MeshPhysicalMaterial({ color: 0xd9c58c, roughness: 0.42, metalness: 0.08, clearcoat: 0.35 }),
  );
  back.position.z = -0.08;
  card.add(back);

  const cardCanvas = document.createElement("canvas");
  const cardWidth = 1200;
  const cardHeight = 840;
  const cardResolutionScale = 2;
  cardCanvas.width = cardWidth * cardResolutionScale;
  cardCanvas.height = cardHeight * cardResolutionScale;
  const context = cardCanvas.getContext("2d");
  if (!context) throw new Error("Gift card canvas is unavailable.");
  context.setTransform(cardResolutionScale, 0, 0, cardResolutionScale, 0, 0);
  const cardTexture = new CanvasTexture(cardCanvas);
  cardTexture.colorSpace = SRGBColorSpace;
  const face = new Mesh(
    new PlaneGeometry(4.9, 3.4),
    new MeshStandardMaterial({ map: cardTexture, roughness: 0.72, metalness: 0, side: DoubleSide }),
  );
  face.position.z = 0.025;
  card.add(face);

  const drawTape = (x: number, y: number, tapeWidth: number, tapeHeight: number, angle = 0) => {
    context.save();
    context.translate(x + tapeWidth / 2, y + tapeHeight / 2);
    context.rotate(angle);
    context.fillStyle = "rgba(232,207,143,.86)";
    context.beginPath();
    context.moveTo(-tapeWidth / 2, -tapeHeight / 2 + 4);
    context.lineTo(tapeWidth / 2 - 5, -tapeHeight / 2);
    context.lineTo(tapeWidth / 2, tapeHeight / 2 - 5);
    context.lineTo(-tapeWidth / 2 + 4, tapeHeight / 2);
    context.closePath();
    context.fill();
    context.globalAlpha = 0.22;
    context.strokeStyle = "#8f714c";
    for (let stripe = -tapeWidth / 2 + 10; stripe < tapeWidth / 2; stripe += 13) {
      context.beginPath();context.moveTo(stripe, -tapeHeight / 2 + 4);context.lineTo(stripe + 8, tapeHeight / 2 - 4);context.stroke();
    }
    context.restore();
  };
  const drawCard = (photo?: HTMLImageElement) => {
    const gradient = context.createLinearGradient(0, 0, cardWidth, cardHeight);
    gradient.addColorStop(0, "#caa579");
    gradient.addColorStop(0.58, "#b88d60");
    gradient.addColorStop(1, "#a87950");
    context.fillStyle = gradient;
    context.fillRect(0, 0, cardWidth, cardHeight);
    context.strokeStyle = "rgba(79,51,30,.1)";
    context.lineWidth = 1;
    for (let fiber = 0; fiber < 145; fiber += 1) {
      const x = (fiber * 83) % cardWidth;
      const y = (fiber * 47) % cardHeight;
      context.beginPath();context.moveTo(x, y);context.lineTo(x + 16 + (fiber % 19), y + ((fiber % 5) - 2));context.stroke();
    }
    context.strokeStyle = "rgba(76,48,28,.35)";
    context.lineWidth = 5;
    context.strokeRect(18, 18, cardWidth - 36, cardHeight - 36);
    drawTape(490, 2, 220, 55, -0.025);
    context.fillStyle = "rgba(55,35,22,.64)";
    context.font = "700 15px Inter, system-ui, sans-serif";
    context.textAlign = "left";
    context.fillText("A LITTLE GARDEN GIFT", 72, 76);
    if (photo) {
      const box = { x: 70, y: 135, w: 745, h: 455 };
      const scale = Math.max(box.w / photo.width, box.h / photo.height);
      const dw = photo.width * scale;
      const dh = photo.height * scale;
      context.save();
      context.beginPath();
      context.roundRect(box.x, box.y, box.w, box.h, 24);
      context.clip();
      context.drawImage(photo, box.x + (box.w - dw) / 2, box.y + (box.h - dh) / 2, dw, dh);
      context.restore();
      context.save();
      context.translate(852, 150);
      context.rotate(-0.025);
      context.fillStyle = "#f2dfaa";
      context.shadowColor = "rgba(0,0,0,.24)";
      context.shadowBlur = 18;
      context.fillRect(0, 0, 280, 440);
      context.shadowBlur = 0;
      drawTape(82, -16, 116, 36, 0.035);
      context.fillStyle = "#2a3440";
      context.font = "700 17px Inter, system-ui, sans-serif";
      context.fillText("GARDEN NOTE", 24, 42);
      const noteValueLines = (label: string, value: string) => {
        const raw = value?.trim() || "—";
        const parts = raw.split(/\s*·\s*/).filter(Boolean);
        const dayIndex = label === "TIME" ? parts.findIndex((part) => /^(?:Day\s+\d+|第\s*\d+\s*天)/i.test(part)) : -1;
        const candidates = dayIndex > 0
          ? [parts.slice(0, dayIndex).join(" · "), parts.slice(dayIndex).join(" · ")]
          : [raw];
        const fitted: string[] = [];
        candidates.forEach((candidate) => {
          if (context.measureText(candidate).width <= 232) {
            fitted.push(candidate);
            return;
          }
          const words = candidate.split(/\s+/);
          let line = "";
          words.forEach((word) => {
            const trial = line ? `${line} ${word}` : word;
            if (line && context.measureText(trial).width > 232) {
              fitted.push(line);
              line = word;
            } else line = trial;
          });
          if (line) fitted.push(line);
        });
        return fitted.slice(0, 2).map((line) => {
          if (context.measureText(line).width <= 232) return line;
          let safe = line;
          while (safe.length > 1 && context.measureText(`${safe}…`).width > 232) safe = safe.slice(0, -1);
          return `${safe}…`;
        });
      };
      const noteRows = [
        { label: "DATE", value: options.date, y: 92 },
        { label: "TIME", value: options.time, y: 170 },
        { label: "TEMP", value: options.temperature, y: 266 },
        { label: "GARDENER", value: options.gardener, y: 344 },
      ];
      context.save();
      context.beginPath();
      context.rect(16, 18, 248, 408);
      context.clip();
      noteRows.forEach(({ label, value, y }) => {
        context.fillStyle = "rgba(42,52,64,.55)";
        context.font = "700 12px Inter, system-ui, sans-serif";
        context.fillText(label || "", 24, y);
        context.fillStyle = "#26313d";
        context.font = "500 18px Inter, system-ui, sans-serif";
        noteValueLines(label, value || "—").forEach((line, lineIndex) => context.fillText(line, 24, y + 26 + lineIndex * 22));
      });
      context.restore();
      context.restore();
    } else {
      context.fillStyle = "rgba(255,243,214,.14)";
      context.beginPath();
      context.roundRect(70, 135, 1060, 440, 24);
      context.fill();
    }
    context.fillStyle = "#3f291b";
    context.font = "italic 700 26px Palatino, serif";
    context.fillText(options.recipient?.trim() ? `FOR ${options.recipient.trim()}` : "FOR SOMEONE SPECIAL", 76, 650);
    context.fillStyle = "rgba(63,41,27,.72)";
    context.font = "italic 700 21px Palatino, serif";
    context.textAlign = "right";
    const senderLine = [options.sender?.trim() ? `FROM ${options.sender.trim()}` : "", options.giftDate || ""].filter(Boolean).join(" · ");
    context.fillText(senderLine, 1124, 650);
    context.textAlign = "left";
    context.fillStyle = "#2f2118";
    context.font = "italic 700 34px Palatino, serif";
    wrapCanvasLines(context, options.message || (options.language === "en" ? "A little garden, made for you." : "這座小花園，想送給你。"), 1010, 3).forEach((line, index) => context.fillText(line, 76, 700 + index * 39));
    context.fillStyle = "#ddc484";
    context.beginPath();
    context.arc(475, 786, 22, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#172434";
    context.font = "700 19px Inter, system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText("◐", 475, 793);
    context.fillStyle = "#342419";
    context.font = "700 22px Inter, system-ui, sans-serif";
    context.textAlign = "left";
    context.fillText("Nurture Garden", 510, 793);
    context.fillStyle = "rgba(52,36,25,.5)";
    context.font = "600 13px Inter, system-ui, sans-serif";
    context.textAlign = "right";
    context.fillText(options.title || "NURTURED WITH TIME", 1125, 796);
    context.textAlign = "left";
    cardTexture.needsUpdate = true;
  };

  let disposed = false;
  const photoReady = options.imageUrl
    ? new Promise<void>((resolve) => {
        const image = new Image();
        image.onload = () => { if (!disposed) drawCard(image); resolve(); };
        image.onerror = () => { if (!disposed) drawCard(); resolve(); };
        image.src = options.imageUrl!;
      })
    : Promise.resolve().then(() => drawCard());
  const modelPickTargets: Mesh[] = [];
  let modelWrapper: Group | null = null;
  const attachModel = (model: Object3D, center: Vector3, radius: number) => {
    if (disposed) return;
    const wrapper = new Group();
    wrapper.name = "NurtureGarden_AutoRotate_Model";
    wrapper.add(model);
    model.position.sub(center);
    wrapper.scale.setScalar(1.28 / Math.max(radius, 0.0001));
    wrapper.position.set(0, 0.14, 0.92);
    wrapper.rotation.x = -0.06;
    wrapper.traverse((object) => { if (object instanceof Mesh) modelPickTargets.push(object); });
    modelWrapper = wrapper;
    card.add(wrapper);
  };
  const modelReady = options.modelUrl
    ? loadPreparedModel(options.modelUrl).then((source) => {
        const model = source.clone(true);
        const { center, radius } = measureModel(source, options.modelUrl!);
        attachModel(model, center, radius);
      })
    : options.modelKind === "moonPollen"
      ? Promise.resolve().then(() => {
          const pollen = createMoonPollenObject();
          pollen.updateMatrixWorld(true);
          const bounds = new Box3().setFromObject(pollen, true);
          const center = bounds.getCenter(new Vector3());
          const radius = bounds.getBoundingSphere(new Sphere()).radius;
          attachModel(pollen, center, radius);
        })
      : Promise.resolve();
  const ready = Promise.all([photoReady, modelReady]);

  let frame = 0;
  let dragging: "model" | "card" | null = null;
  let lastX = 0;
  let lastY = 0;
  const cardAnimationStart = performance.now();
  const render = () => {
    if (disposed || !stage.isConnected) return;
    const now = performance.now();
    const introProgress = Math.min(1, (now - cardAnimationStart) / 850);
    const introEase = 1 - Math.pow(1 - introProgress, 3);
    card.scale.setScalar(0.94 + introEase * 0.06);
    card.position.y = (1 - introEase) * -0.2 + Math.sin(now * 0.0015) * 0.018;
    card.position.z = (1 - introEase) * -0.35;
    if (!dragging && modelWrapper) modelWrapper.rotation.y += 0.0035;
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };
  const resize = () => {
    if (disposed) return;
    const nextWidth = Math.max(300, stage.clientWidth || width);
    const nextHeight = Math.max(260, stage.clientHeight || height);
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(nextWidth, nextHeight, false);
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  const giftPointer = new Vector2();
  const giftRaycaster = new Raycaster();
  const pointerDown = (event: PointerEvent) => { const rect=stage.getBoundingClientRect();giftPointer.x=((event.clientX-rect.left)/rect.width)*2-1;giftPointer.y=-((event.clientY-rect.top)/rect.height)*2+1;giftRaycaster.setFromCamera(giftPointer,camera);dragging=modelPickTargets.length&&giftRaycaster.intersectObjects(modelPickTargets,false).length?"model":"card";lastX = event.clientX; lastY = event.clientY; stage.setPointerCapture(event.pointerId); };
  const pointerMove = (event: PointerEvent) => { if (!dragging) return;const dx=event.clientX-lastX,dy=event.clientY-lastY;if(dragging==="model"&&modelWrapper){modelWrapper.rotation.y+=dx*.014;modelWrapper.rotation.x=Math.max(-.75,Math.min(.75,modelWrapper.rotation.x+dy*.01))}else{const limit=Math.PI/18;card.rotation.y=Math.max(-limit,Math.min(limit,card.rotation.y+dx*.0045));card.rotation.x=Math.max(-limit,Math.min(limit,card.rotation.x+dy*.0045))}lastX=event.clientX;lastY=event.clientY; };
  const pointerUp = (event: PointerEvent) => { dragging = null; if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId); };
  stage.addEventListener("pointerdown", pointerDown);
  stage.addEventListener("pointermove", pointerMove);
  stage.addEventListener("pointerup", pointerUp);
  stage.addEventListener("pointercancel", pointerUp);
  render();

  stage.__giftCardExportGlb = async (mode = "compatible") => {
    await ready;
    const exportRoot = card.clone(true);
    exportRoot.name = "Nurture Garden Interactive Gift Card";
    exportRoot.rotation.set(0, 0, 0);
    exportRoot.userData = { recipient: options.recipient || "", sender: options.sender || "", date: options.giftDate || "", message: options.message || "", source: options.title || "Nurture Garden" };
    const animations = modelWrapper
      ? (() => {
          const axis = new Vector3(0, 1, 0);
          const base = modelWrapper.quaternion.clone();
          const times = [0, 2, 4, 6, 8];
          const values: number[] = [];
          times.forEach((_, index) => {
            const spin = new Quaternion().setFromAxisAngle(axis, index * Math.PI * 0.5);
            const frameQuaternion = base.clone().multiply(spin).normalize();
            values.push(frameQuaternion.x, frameQuaternion.y, frameQuaternion.z, frameQuaternion.w);
          });
          return [new AnimationClip("Auto Rotate", 8, [new QuaternionKeyframeTrack(`${modelWrapper.name}.quaternion`, times, values)])];
        })()
      : [];
    const result = await new GLTFExporter().parseAsync(exportRoot, { binary: true, onlyVisible: true, trs: true, animations, maxTextureSize: 1024 });
    if (!(result instanceof ArrayBuffer)) throw new Error("GLB exporter returned an unexpected result.");
    return new Blob([await optimizeGiftGlb(result, mode)], { type: "model/gltf-binary" });
  };
  stage.__giftCardCleanup = () => {
    disposed = true;
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    stage.removeEventListener("pointerdown", pointerDown);
    stage.removeEventListener("pointermove", pointerMove);
    stage.removeEventListener("pointerup", pointerUp);
    stage.removeEventListener("pointercancel", pointerUp);
    renderer.dispose();
    renderer.forceContextLoss();
    stage.__giftCardExportGlb = undefined;
    stage.__giftCardCleanup = undefined;
  };
  return ready;
}

export async function createReceivedGiftViewer(
  stage: ReceivedGiftStage,
  modelUrl: string,
  kind: "card" | "pot",
  language: string,
) {
  stage.__receivedGiftCleanup?.();
  stage.replaceChildren();
  stage.hidden = false;

  const renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(Math.max(window.devicePixelRatio || 1, 2.5), 4));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.domElement.setAttribute("aria-label", language === "en" ? "Interactive received GLB gift" : "可互動查看的收到禮物 GLB");
  stage.append(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(kind === "card" ? 28 : 30, 1, 0.01, 100);
  camera.position.set(0, 0, kind === "card" ? 5.1 : 4.5);
  scene.add(new HemisphereLight(0xfff1d5, 0x1e3048, 2.7));
  const key = new DirectionalLight(new Color(0xffdfaa), 3.4);
  key.position.set(4, 5, 6);
  scene.add(key);
  const rim = new DirectionalLight(new Color(0xbfd2ff), 2.1);
  rim.position.set(-4, 2, -3);
  scene.add(rim);

  const giftRoot = new Group();
  scene.add(giftRoot);
  const gltf = await modelLoader.loadAsync(modelUrl);
  const model = gltf.scene;
  model.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(model, true);
  const center = bounds.getCenter(new Vector3());
  const radius = Math.max(bounds.getBoundingSphere(new Sphere()).radius, 0.0001);
  model.position.sub(center);
  giftRoot.add(model);
  giftRoot.scale.setScalar((kind === "card" ? 1.78 : 1.62) / radius);
  giftRoot.rotation.set(kind === "card" ? -0.035 : -0.08, 0, 0);

  const mixer = gltf.animations.length ? new AnimationMixer(model) : null;
  gltf.animations.forEach((clip) => mixer?.clipAction(clip).play());
  const fallbackSpinner = kind === "card" && !gltf.animations.length
    ? model.getObjectByName("NurtureGarden_AutoRotate_Model")
    : null;
  let disposed = false;
  let frame = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let lastFrameTime = performance.now();

  const resize = () => {
    if (disposed) return;
    const width = Math.max(320, stage.clientWidth || 620);
    const height = Math.max(260, stage.clientHeight || 350);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  resize();

  const pointerDown = (event: PointerEvent) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    stage.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    if (kind === "card") {
      const limit = Math.PI / 18;
      giftRoot.rotation.y = Math.max(-limit, Math.min(limit, giftRoot.rotation.y + dx * 0.0045));
      giftRoot.rotation.x = Math.max(-limit, Math.min(limit, giftRoot.rotation.x + dy * 0.0045));
    } else {
      giftRoot.rotation.y += dx * 0.01;
      giftRoot.rotation.x = Math.max(-0.82, Math.min(0.68, giftRoot.rotation.x + dy * 0.008));
    }
    lastX = event.clientX;
    lastY = event.clientY;
  };
  const pointerUp = (event: PointerEvent) => {
    dragging = false;
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  };
  stage.addEventListener("pointerdown", pointerDown);
  stage.addEventListener("pointermove", pointerMove);
  stage.addEventListener("pointerup", pointerUp);
  stage.addEventListener("pointercancel", pointerUp);

  const render = (now: number) => {
    if (disposed || !stage.isConnected) return;
    const delta = Math.min(0.05, Math.max(0, (now - lastFrameTime) / 1000));
    lastFrameTime = now;
    mixer?.update(delta);
    if (fallbackSpinner) fallbackSpinner.rotation.y += delta * 0.55;
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };
  frame = requestAnimationFrame(render);

  stage.__receivedGiftCleanup = () => {
    disposed = true;
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    mixer?.stopAllAction();
    stage.removeEventListener("pointerdown", pointerDown);
    stage.removeEventListener("pointermove", pointerMove);
    stage.removeEventListener("pointerup", pointerUp);
    stage.removeEventListener("pointercancel", pointerUp);
    renderer.dispose();
    renderer.forceContextLoss();
    stage.__receivedGiftCleanup = undefined;
  };
}
