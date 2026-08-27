const palettes: Record<string, string[]> = {
  Joy: ["#ffcf70", "#fa7c82", "#764ba2", "#171025"],
  Love: ["#f5a1ad", "#c05273", "#503252", "#171025"],
  Excitement: ["#ff995d", "#f05e78", "#5956a8", "#111126"],
  Nostalgia: ["#d8a777", "#86728d", "#344455", "#16131b"],
  Hope: ["#edda8b", "#7dc4ae", "#496e8b", "#111927"],
  Peace: ["#b8d8cf", "#6ca6a8", "#475a78", "#101722"],
  Sadness: ["#899ab7", "#485c79", "#252d46", "#10121d"],
  Fear: ["#a9737d", "#4e3f60", "#20243c", "#0d0e16"],
};

function hash(text: string): number {
  return [...text].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 2166136261);
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function createIllustrationDataUrl(seed: string, emotion: string, source: HTMLImageElement): string {
  const width = 540;
  const height = 675;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const colors = palettes[emotion] ?? palettes.Nostalgia;
  const tint = hexToRgb(colors[0]);
  let state = hash(`${seed}:${emotion}:illustration`);
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };

  const scale = Math.max(width / source.width, height / source.height);
  const drawWidth = source.width * scale;
  const drawHeight = source.height * scale;
  const drawX = (width - drawWidth) / 2;
  const drawY = (height - drawHeight) / 2;
  context.filter = "saturate(118%) contrast(108%) brightness(108%)";
  context.drawImage(source, drawX, drawY, drawWidth, drawHeight);
  context.filter = "none";

  const pixels = context.getImageData(0, 0, width, height);
  const sourcePixels = new Uint8ClampedArray(pixels.data);
  const gray = new Float32Array(width * height);
  for (let index = 0; index < sourcePixels.length; index += 4) {
    gray[index / 4] = sourcePixels[index] * 0.299 + sourcePixels[index + 1] * 0.587 + sourcePixels[index + 2] * 0.114;
  }

  const levels = 7;
  const step = 255 / (levels - 1);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const pixelIndex = (y * width + x) * 4;
      const grayIndex = y * width + x;
      const gx = -gray[grayIndex - width - 1] + gray[grayIndex - width + 1]
        - 2 * gray[grayIndex - 1] + 2 * gray[grayIndex + 1]
        - gray[grayIndex + width - 1] + gray[grayIndex + width + 1];
      const gy = -gray[grayIndex - width - 1] - 2 * gray[grayIndex - width] - gray[grayIndex - width + 1]
        + gray[grayIndex + width - 1] + 2 * gray[grayIndex + width] + gray[grayIndex + width + 1];
      const edge = Math.min(1, Math.hypot(gx, gy) / 310);
      for (let channel = 0; channel < 3; channel += 1) {
        const original = sourcePixels[pixelIndex + channel];
        const colored = original * 0.86 + tint[channel] * 0.14;
        const posterized = Math.round(colored / step) * step;
        pixels.data[pixelIndex + channel] = posterized * (1 - edge * 0.72) + 25 * edge;
      }
    }
  }
  context.putImageData(pixels, 0, 0);

  context.globalCompositeOperation = "soft-light";
  for (let wash = 0; wash < 13; wash += 1) {
    const x = random() * width;
    const y = random() * height;
    const radius = 55 + random() * 170;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `${colors[wash % 3]}48`);
    gradient.addColorStop(1, "transparent");
    context.fillStyle = gradient;
    context.beginPath();
    context.ellipse(x, y, radius, radius * (0.45 + random() * 0.7), random() * Math.PI, 0, Math.PI * 2);
    context.fill();
  }

  context.globalCompositeOperation = "multiply";
  context.fillStyle = "rgba(124,91,57,.055)";
  for (let fleck = 0; fleck < 4200; fleck += 1) {
    const size = random() < 0.9 ? 1 : 2;
    context.fillRect(random() * width, random() * height, size, size);
  }
  context.globalCompositeOperation = "screen";
  context.fillStyle = "rgba(255,248,224,.18)";
  for (let stroke = 0; stroke < 36; stroke += 1) {
    context.save();
    context.translate(random() * width, random() * height);
    context.rotate((random() - 0.5) * 0.5);
    context.fillRect(-35, -1, 70 + random() * 120, 1 + random() * 3);
    context.restore();
  }
  context.globalCompositeOperation = "screen";
  context.fillStyle = "rgba(250,235,203,.13)";
  context.fillRect(0, 0, width, height);
  context.globalCompositeOperation = "source-over";
  return canvas.toDataURL("image/jpeg", 0.84);
}

export function createArtworkDataUrl(seed: string, emotion = "Nostalgia", source?: HTMLImageElement): string {
  if (source) return createIllustrationDataUrl(seed, emotion, source);
  const canvas = document.createElement("canvas");
  canvas.width = 540;
  canvas.height = 675;
  const ctx = canvas.getContext("2d")!;
  const colors = palettes[emotion] ?? palettes.Nostalgia;
  const randomSeed = hash(seed);
  let state = randomSeed;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };

  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, colors[3]);
  gradient.addColorStop(0.5, colors[2]);
  gradient.addColorStop(1, colors[0]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.globalCompositeOperation = "screen";
  for (let index = 0; index < 18; index += 1) {
    const x = random() * canvas.width;
    const y = random() * canvas.height;
    const radius = 90 + random() * 310;
    const radial = ctx.createRadialGradient(x, y, 0, x, y, radius);
    radial.addColorStop(0, `${colors[index % 3]}b8`);
    radial.addColorStop(0.5, `${colors[(index + 1) % 3]}45`);
    radial.addColorStop(1, "transparent");
    ctx.fillStyle = radial;
    ctx.beginPath();
    ctx.ellipse(x, y, radius, radius * (0.35 + random()), random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalCompositeOperation = "soft-light";
  ctx.strokeStyle = "rgba(255,255,255,.28)";
  ctx.lineWidth = 3;
  for (let line = 0; line < 7; line += 1) {
    ctx.beginPath();
    ctx.moveTo(-80, random() * canvas.height);
    for (let x = 0; x <= canvas.width + 80; x += 90) {
      ctx.lineTo(x, canvas.height * (0.2 + random() * 0.65));
    }
    ctx.stroke();
  }

  ctx.globalCompositeOperation = "source-over";
  const grainCanvas = document.createElement("canvas");
  grainCanvas.width = canvas.width;
  grainCanvas.height = canvas.height;
  const grainContext = grainCanvas.getContext("2d")!;
  const grain = grainContext.createImageData(canvas.width, canvas.height);
  for (let i = 0; i < grain.data.length; i += 4) {
    const value = random() * 255;
    grain.data[i] = value;
    grain.data[i + 1] = value;
    grain.data[i + 2] = value;
    grain.data[i + 3] = 255;
  }
  grainContext.putImageData(grain, 0, 0);
  ctx.globalAlpha = 0.025;
  ctx.drawImage(grainCanvas, 0, 0);
  ctx.globalAlpha = 1;
  return canvas.toDataURL("image/jpeg", 0.8);
}

export async function readFileAsDataUrl(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Photo upload failed. Please try another image."));
    reader.readAsDataURL(file);
  });
  const image = await loadImage(raw);
  const max = 1400;
  const scale = Math.min(1, max / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.76);
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read this image."));
    image.src = url;
  });
}
