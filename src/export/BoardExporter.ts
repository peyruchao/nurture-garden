import * as THREE from "three";

export class BoardExporter {
  constructor(private readonly renderer: THREE.WebGLRenderer) {}

  async exportPNG(scene: THREE.Scene, camera: THREE.Camera): Promise<Blob> {
    const originalSize = new THREE.Vector2();
    this.renderer.getSize(originalSize);
    const originalRatio = this.renderer.getPixelRatio();
    const perspectiveCamera = camera instanceof THREE.PerspectiveCamera ? camera : null;
    const originalAspect = perspectiveCamera?.aspect;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(2400, 1600, false);
    if (perspectiveCamera) {
      perspectiveCamera.aspect = 2400 / 1600;
      perspectiveCamera.updateProjectionMatrix();
    }
    this.renderer.render(scene, camera);
    const blob = await new Promise<Blob>((resolve, reject) => {
      this.renderer.domElement.toBlob((value) => value ? resolve(value) : reject(new Error("Export failed.")), "image/png");
    });
    this.renderer.setPixelRatio(originalRatio);
    this.renderer.setSize(originalSize.x, originalSize.y, false);
    if (perspectiveCamera && originalAspect) {
      perspectiveCamera.aspect = originalAspect;
      perspectiveCamera.updateProjectionMatrix();
    }
    return blob;
  }
}
