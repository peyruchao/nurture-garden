import type { ArtworkGenerationInput, ArtworkGenerator, GeneratedArtwork } from "./ArtworkGenerator";

export class RealArtworkGenerator implements ArtworkGenerator {
  async generateArtwork(_input: ArtworkGenerationInput): Promise<GeneratedArtwork> {
    throw new Error("Connect this adapter to a server-side artwork generation endpoint.");
  }
}
