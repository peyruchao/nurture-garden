export interface ArrangementPublishMetadata {
  title: string;
  vessel: string;
  itemCount: number;
}

export interface ArrangementPublishResult {
  mode: "polygon" | "local";
  assetId: string;
  previewUrl: string;
  downloadUrl: string;
  cmsUrl: string;
}

type PolygonBridgeResponse = {
  assetId?: string;
  id?: string;
  previewUrl?: string;
  preview_url?: string;
  url?: string;
  downloadUrl?: string;
  download_url?: string;
  status?: string;
  provider?: string;
};

/** Publishes through a project-owned backend so credentials never reach the browser bundle. */
export class PolygonArrangementPublisher {
  private readonly endpoint = import.meta.env.VITE_POLYGON_UPLOAD_ENDPOINT?.trim()
    || "/api/polygon/upload";
  readonly cmsUrl = import.meta.env.VITE_POLYGON_CMS_URL?.trim()
    || "https://www.viverse.com/polygon-streaming";

  get isConfigured() {
    return Boolean(this.endpoint);
  }

  async publish(
    model: Blob,
    thumbnail: Blob | null,
    metadata: ArrangementPublishMetadata,
  ): Promise<ArrangementPublishResult> {
    const localUrl = URL.createObjectURL(model);
    const response = await fetch(this.endpoint, {
      method: "POST",
      body: model,
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "model/gltf-binary",
        "X-Nurture-Title": encodeURIComponent(metadata.title),
        "X-Nurture-Vessel": metadata.vessel,
        "X-Nurture-Item-Count": String(metadata.itemCount),
      },
    });
    void thumbnail;
    if (!response.ok) {
      const detail = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(detail.error || `pls-cli upload bridge returned ${response.status}.`);
    }
    const payload = await response.json() as PolygonBridgeResponse;
    if (!payload.assetId && !payload.id) throw new Error("pls-cli did not return an asset ID.");
    const assetId = payload.assetId || payload.id || `polygon-${Date.now()}`;
    const previewUrl = payload.previewUrl || payload.preview_url || payload.url
      || `https://stream.viverse.com/model/${encodeURIComponent(assetId)}`;
    return {
      mode: "polygon",
      assetId,
      previewUrl,
      downloadUrl: localUrl,
      cmsUrl: this.cmsUrl,
    };
  }
}
