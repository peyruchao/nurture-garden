import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { constrainPlayer } from "./PlayerCollision";

export class FirstPersonController {
  controls!: PointerLockControls;
  readonly velocity = new THREE.Vector3();
  moveSpeed = 4;
  private readonly keys = new Set<string>();
  private initialized = false;
  private readonly keyDown = (event: KeyboardEvent) => this.keys.add(event.code);
  private readonly keyUp = (event: KeyboardEvent) => this.keys.delete(event.code);

  initialize(camera: THREE.PerspectiveCamera, domElement: HTMLElement): void {
    if (this.initialized) return;
    this.controls = new PointerLockControls(camera, domElement);
    this.controls.minPolarAngle = 0.08;
    this.controls.maxPolarAngle = Math.PI - 0.08;
    window.addEventListener("keydown", this.keyDown);
    window.addEventListener("keyup", this.keyUp);
    this.initialized = true;
  }

  update(delta: number): void {
    if (!this.initialized || !this.controls.isLocked) return;
    const forward = Number(this.keys.has("KeyW")) - Number(this.keys.has("KeyS"));
    const right = Number(this.keys.has("KeyD")) - Number(this.keys.has("KeyA"));
    const length = Math.hypot(forward, right) || 1;
    this.velocity.set(right / length, 0, forward / length).multiplyScalar(this.moveSpeed);
    this.controls.moveRight(this.velocity.x * delta);
    this.controls.moveForward(this.velocity.z * delta);
    constrainPlayer(this.controls.object.position);
  }

  lock(): void { this.controls.lock(); }
  unlock(): void { this.controls.unlock(); }

  dispose(): void {
    if (!this.initialized) return;
    this.controls.disconnect();
    window.removeEventListener("keydown", this.keyDown);
    window.removeEventListener("keyup", this.keyUp);
    this.keys.clear();
    this.initialized = false;
  }
}
