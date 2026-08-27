import * as THREE from "three";

export interface PolygonStreamingAdapter {
  initialize(scene: THREE.Scene): Promise<void>;
  loadAsset(assetId: string, options?: {
    position?: THREE.Vector3;
    rotation?: THREE.Euler;
    scale?: THREE.Vector3;
  }): Promise<THREE.Object3D>;
  unloadAsset(assetId: string): void;
  dispose(): void;
}

/**
 * Production integration point.
 * TODO: Import and initialize the official VIVERSE Polygon Streaming Three.js SDK
 * here once its package and API contract are available. No SDK API is guessed.
 */
export class PolygonStreamingSdkAdapter implements PolygonStreamingAdapter {
  async initialize(_scene: THREE.Scene): Promise<void> {
    throw new Error("Polygon Streaming SDK is not configured");
  }
  async loadAsset(_assetId: string): Promise<THREE.Object3D> {
    throw new Error("Polygon Streaming SDK is not configured");
  }
  unloadAsset(_assetId: string): void {}
  dispose(): void {}
}
