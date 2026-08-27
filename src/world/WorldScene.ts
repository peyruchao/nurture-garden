import * as THREE from "three";
import { emotionConfigs } from "../emotion/emotionConfig";
import { FirstPersonController } from "../player/FirstPersonController";
import type { PolygonStreamingAdapter } from "../polygonStreaming/PolygonStreamingAdapter";
import { PolygonStreamingMock } from "../polygonStreaming/PolygonStreamingMock";
import type { WorldDefinition, WorldObject } from "./worldTypes";

export class WorldScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.1, 500);
  readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  private readonly clock = new THREE.Clock();
  private readonly controller = new FirstPersonController();
  private readonly streaming: PolygonStreamingAdapter = new PolygonStreamingMock();
  private animationFrame = 0;
  private preview = true;
  private previewTime = 0;
  private disposed = false;
  private world: WorldDefinition | null = null;
  private readonly dynamicMeshes: THREE.Mesh[] = [];
  private worldTime = 0;
  private onLock: (() => void) | null = null;
  private onUnlock: (() => void) | null = null;
  private readonly resizeHandler = () => this.resize();
  private readonly lockHandler = () => this.onLock?.();
  private readonly unlockHandler = () => this.onUnlock?.();
  private readonly pointerLockErrorHandler = () => this.onUnlock?.();

  constructor(private readonly host: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.className = "world-canvas";
    this.host.replaceChildren(this.renderer.domElement);
    this.resize();
    window.addEventListener("resize", this.resizeHandler);
    document.addEventListener("pointerlockerror", this.pointerLockErrorHandler);
    this.controller.initialize(this.camera, this.renderer.domElement);
    this.controller.controls.addEventListener("lock", this.lockHandler);
    this.controller.controls.addEventListener("unlock", this.unlockHandler);
  }

  async loadWorld(world: WorldDefinition): Promise<void> {
    this.world = world;
    this.clearScene();
    this.scene.background = new THREE.Color(world.backgroundColor);
    this.scene.fog = new THREE.FogExp2(world.fogColor, world.fogDensity);
    await this.streaming.initialize(this.scene);

    const groundMaterial = new THREE.MeshStandardMaterial({ color: world.groundColor, roughness: 0.96, metalness: world.emotion === "intense" ? 0.18 : 0 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(110, 110, 1, 1), groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.userData.isGround = true;
    this.scene.add(ground);

    for (const object of world.objects.slice(0, 280)) this.scene.add(this.createMesh(object));
    for (const light of world.lights) {
      let instance: THREE.Light;
      if (light.type === "ambient") instance = new THREE.AmbientLight(light.color, light.intensity);
      else if (light.type === "directional") instance = new THREE.DirectionalLight(light.color, light.intensity);
      else instance = new THREE.PointLight(light.color, light.intensity, 45, 1.7);
      if (light.position) instance.position.set(light.position.x, light.position.y, light.position.z);
      this.scene.add(instance);
    }

    const signaturePositions = [new THREE.Vector3(-12, 2, -16), new THREE.Vector3(11, 1.8, -8), new THREE.Vector3(2, 2.5, -26)];
    for (let index = 0; index < signaturePositions.length; index += 1) {
      try {
        const asset = await this.streaming.loadAsset(`${world.emotion}-signature-${index}`, { position: signaturePositions[index], scale: new THREE.Vector3(1.5 + index * 0.35, 1.5 + index * 0.35, 1.5 + index * 0.35) });
        this.scene.add(asset);
      } catch {
        // The active adapter can fall back without exposing SDK errors to the user.
      }
    }
    this.camera.position.set(0, 9, 26);
    this.camera.lookAt(0, 2, -8);
    this.preview = true;
    this.start();
  }

  enter(onLock: () => void, onUnlock: () => void): void {
    if (!this.world) return;
    this.onLock = onLock;
    this.onUnlock = onUnlock;
    this.preview = false;
    const spawn = this.world.spawnPosition;
    this.camera.position.set(spawn.x, spawn.y, spawn.z);
    this.camera.rotation.set(0, 0, 0);
    this.controller.moveSpeed = emotionConfigs[this.world.emotion].movementSpeed;
    this.controller.lock();
  }

  continue(): void {
    this.controller.lock();
  }

  unlock(): void {
    if (this.controller.controls.isLocked) this.controller.unlock();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener("resize", this.resizeHandler);
    document.removeEventListener("pointerlockerror", this.pointerLockErrorHandler);
    this.controller.controls.removeEventListener("lock", this.lockHandler);
    this.controller.controls.removeEventListener("unlock", this.unlockHandler);
    this.controller.dispose();
    this.streaming.dispose();
    this.clearScene();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private start(): void {
    if (this.animationFrame) return;
    this.clock.start();
    const animate = () => {
      if (this.disposed) return;
      this.animationFrame = requestAnimationFrame(animate);
      const delta = Math.min(this.clock.getDelta(), 0.05);
      this.worldTime += delta;
      if (this.preview) {
        this.previewTime += delta * 0.1;
        this.camera.position.x = Math.sin(this.previewTime) * 22;
        this.camera.position.z = 25 + Math.cos(this.previewTime) * 5;
        this.camera.position.y = 8.5;
        this.camera.lookAt(0, 2, -8);
      } else {
        this.controller.update(delta);
      }
      this.updateLivingElements();
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }

  private createMesh(object: WorldObject): THREE.Mesh {
    let geometry: THREE.BufferGeometry;
    if (object.type === "sphere") geometry = new THREE.SphereGeometry(1, 20, 14);
    else if (object.type === "box") geometry = new THREE.BoxGeometry(1, 1, 1);
    else if (object.type === "cone") geometry = new THREE.ConeGeometry(1, 2, 7);
    else if (object.type === "torus") geometry = new THREE.TorusGeometry(0.8, 0.22, 10, 24);
    else geometry = new THREE.TetrahedronGeometry(0.8, 0);
    const material = new THREE.MeshStandardMaterial({
      color: object.color, transparent: object.opacity < 1, opacity: object.opacity,
      roughness: object.emissive ? 0.35 : 0.72, metalness: object.emissive ? 0.22 : 0.04,
      emissive: object.emissive ?? "#000000", emissiveIntensity: object.emissive ? 0.72 : 0,
      side: object.opacity < 0.7 ? THREE.DoubleSide : THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(object.position.x, object.position.y, object.position.z);
    mesh.scale.set(object.scale.x, object.scale.y, object.scale.z);
    mesh.rotation.set(object.rotation.x, object.rotation.y, object.rotation.z);
    mesh.userData.sourceArtworkId = object.sourceId;
    mesh.userData.elementMaterial = object.elementMaterial;
    mesh.userData.baseY = object.position.y;
    mesh.userData.phase = object.position.x * 0.17 + object.position.z * 0.09;
    if (object.elementMaterial) this.dynamicMeshes.push(mesh);
    return mesh;
  }

  private updateLivingElements(): void {
    for (const mesh of this.dynamicMeshes) {
      const material = mesh.userData.elementMaterial as string;
      const phase = Number(mesh.userData.phase) + this.worldTime;
      const baseY = Number(mesh.userData.baseY);
      if (material === "water") {
        mesh.position.y = baseY + Math.sin(phase * 1.4) * 0.12;
        mesh.rotation.y += 0.002;
      } else if (material === "fire") {
        const baseScaleY = Number(mesh.userData.baseScaleY ?? mesh.scale.y);
        mesh.userData.baseScaleY = baseScaleY;
        mesh.scale.y = baseScaleY * (1 + Math.sin(phase * 5) * 0.08);
        (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.65 + Math.sin(phase * 4) * 0.2;
      } else if (material === "wind") {
        mesh.position.x += 0.018;
        if (mesh.position.x > 34) mesh.position.x = -34;
        mesh.rotation.z += 0.006;
      } else if (material === "mist") {
        mesh.position.y = baseY + (this.worldTime * 0.18 + Number(mesh.userData.phase)) % 2.4;
      } else if (material === "plant" || material === "seed") {
        mesh.rotation.z = Math.sin(phase * 0.8) * 0.08;
      }
    }
  }

  private clearScene(): void {
    this.dynamicMeshes.length = 0;
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.userData.streamingAssetId) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
    this.scene.clear();
  }

  private resize(): void {
    const width = this.host.clientWidth || window.innerWidth;
    const height = this.host.clientHeight || window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }
}
