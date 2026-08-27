import * as THREE from "three";
import type { PolygonStreamingAdapter } from "./PolygonStreamingAdapter";

export class PolygonStreamingMock implements PolygonStreamingAdapter {
  private readonly assets = new Map<string, THREE.Object3D>();

  async initialize(_scene: THREE.Scene): Promise<void> {
    await Promise.resolve();
  }

  async loadAsset(assetId: string, options: { position?: THREE.Vector3; rotation?: THREE.Euler; scale?: THREE.Vector3 } = {}): Promise<THREE.Object3D> {
    const geometry = assetId.includes("heavy")
      ? new THREE.DodecahedronGeometry(1, 1)
      : assetId.includes("quiet")
        ? new THREE.IcosahedronGeometry(1, 2)
        : assetId.includes("intense")
          ? new THREE.OctahedronGeometry(1.2, 0)
          : assetId.includes("unclear")
            ? new THREE.TorusKnotGeometry(0.7, 0.18, 70, 9)
            : new THREE.TetrahedronGeometry(1, 1);
    const colors: Record<string, string> = { chaotic: "#bc3fb2", heavy: "#3f4655", quiet: "#a4bdb2", intense: "#ff542d", unclear: "#8d859d" };
    const emotion = Object.keys(colors).find((key) => assetId.includes(key)) ?? "unclear";
    const material = new THREE.MeshStandardMaterial({
      color: colors[emotion], roughness: emotion === "heavy" ? 0.95 : 0.55, metalness: emotion === "intense" ? 0.45 : 0.08,
      transparent: emotion === "unclear", opacity: emotion === "unclear" ? 0.48 : 1,
      emissive: emotion === "intense" ? colors[emotion] : "#000000", emissiveIntensity: emotion === "intense" ? 0.8 : 0,
    });
    const object = new THREE.Mesh(geometry, material);
    if (options.position) object.position.copy(options.position);
    if (options.rotation) object.rotation.copy(options.rotation);
    if (options.scale) object.scale.copy(options.scale);
    object.userData.streamingAssetId = assetId;
    this.assets.set(assetId, object);
    return object;
  }

  unloadAsset(assetId: string): void {
    const object = this.assets.get(assetId);
    if (!object) return;
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => material.dispose());
    });
    object.removeFromParent();
    this.assets.delete(assetId);
  }

  dispose(): void {
    [...this.assets.keys()].forEach((assetId) => this.unloadAsset(assetId));
  }
}
