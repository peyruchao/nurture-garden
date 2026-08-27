import { createArtworkDataUrl, loadImage, readFileAsDataUrl } from "../utils/art";
import type { ArtworkGenerationInput, ArtworkGenerator, GeneratedArtwork } from "./ArtworkGenerator";

export class MockArtworkGenerator implements ArtworkGenerator {
  async generateArtwork(input: ArtworkGenerationInput): Promise<GeneratedArtwork> {
    await new Promise((resolve) => window.setTimeout(resolve, 1150));
    const photo = await readFileAsDataUrl(input.image);
    const image = await loadImage(photo);
    return {
      imageUrl: createArtworkDataUrl(`${input.title}:${input.story}`, input.emotion, image),
    };
  }
}
