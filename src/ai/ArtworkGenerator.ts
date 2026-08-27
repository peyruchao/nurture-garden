export interface ArtworkGenerationInput {
  image: File;
  title: string;
  story: string;
  emotion?: string;
}

export interface GeneratedArtwork {
  imageUrl: string;
}

export interface ArtworkGenerator {
  generateArtwork(input: ArtworkGenerationInput): Promise<GeneratedArtwork>;
}
