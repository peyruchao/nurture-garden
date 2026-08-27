import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type { VRM } from "@pixiv/three-vrm";
import type { AvatarData, Memory } from "../models/types";

type ViewMode = "home" | "board" | "ambient";

interface FloatingObject extends THREE.Object3D {
  userData: {
    baseY?: number;
    phase?: number;
    memory?: Memory;
    targetScale?: number;
  };
}

export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2(2, 2);
  private readonly clock = new THREE.Clock();
  private readonly floating: FloatingObject[] = [];
  private readonly interactives: THREE.Object3D[] = [];
  private readonly vrms: VRM[] = [];
  private hovered: THREE.Object3D | null = null;
  private frame = 0;
  private viewMode: ViewMode = "ambient";
  private cameraTarget = new THREE.Vector3();
  private boardSpan = 11;
  onMemorySelect?: (memory: Memory) => void;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.84;
    this.renderer.domElement.className = "world-canvas";
    this.host.append(this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.35, 0.86));
    this.scene.fog = new THREE.FogExp2(0xe7e3dc, 0.018);
    this.scene.background = new THREE.Color(0xe7e3dc);
    this.addLights();
    this.addParticles();
    this.resize();
    addEventListener("resize", this.resize);
    this.renderer.domElement.addEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.addEventListener("pointerleave", this.handlePointerLeave);
    this.renderer.domElement.addEventListener("click", this.handleClick);
    this.animate();
  }

  private addLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xfffcf2, 0x8f7b70, 1.15));
    const key = new THREE.PointLight(0xffd8ae, 7, 30);
    key.position.set(-5, 7, 7);
    this.scene.add(key);
    const fill = new THREE.PointLight(0xb8b1ff, 4, 25);
    fill.position.set(7, 3, -6);
    this.scene.add(fill);
  }

  private addParticles(): void {
    const positions = new Float32Array(540 * 3);
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = (Math.random() - 0.5) * 38;
      positions[i + 1] = (Math.random() - 0.5) * 21;
      positions[i + 2] = (Math.random() - 0.5) * 25;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0x695e6d, size: 0.025, transparent: true, opacity: 0.18 });
    const particles = new THREE.Points(geometry, material);
    particles.name = "persistent-particles";
    this.scene.add(particles);
  }

  private clearView(): void {
    [...this.scene.children].forEach((child) => {
      if (child.name !== "persistent-particles" && !(child instanceof THREE.Light)) {
        this.scene.remove(child);
      }
    });
    this.floating.length = 0;
    this.interactives.length = 0;
    this.vrms.length = 0;
    this.hovered = null;
  }

  showAmbient(): void {
    this.clearView();
    this.viewMode = "ambient";
    this.camera.position.set(0, 1.6, 12);
    this.cameraTarget.set(0, 0.5, 0);
    this.addAurora();
    this.boardSpan = 11;
    this.createMemoryWall();
  }

  showHome(avatar: AvatarData): void {
    this.clearView();
    this.viewMode = "home";
    this.camera.position.set(0, 1.4, 11.5);
    this.cameraTarget.set(0, 1.25, 0);
    this.addAurora();
    this.boardSpan = 11;
    this.createMemoryWall();
    const avatarGroup = this.createAvatar(avatar, 1.15);
    avatarGroup.position.set(0, -0.8, 0.4);
    avatarGroup.userData.baseY = avatarGroup.position.y;
    this.scene.add(avatarGroup);
    this.floating.push(avatarGroup as FloatingObject);

    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(2.1, 0.018, 8, 160),
      new THREE.MeshBasicMaterial({ color: 0xffd5aa, transparent: true, opacity: 0.62 }),
    );
    halo.rotation.x = Math.PI / 2.35;
    halo.position.set(0, 0.9, -0.3);
    this.scene.add(halo);
    this.floating.push(halo as FloatingObject);
  }

  showBoard(memories: Memory[], avatars: AvatarData[]): void {
    this.clearView();
    this.viewMode = "board";
    this.boardSpan = Math.max(11, memories.length * 3.2);
    this.camera.position.set(0, 1.7, 15.8 + Math.max(0, memories.length - 4) * 0.5);
    this.cameraTarget.set(0, 0.6, 0);
    this.addAurora();
    this.createMemoryWall();
    this.createRibbon(memories);
    this.createBoardAvatars(avatars);
  }

  private createMemoryWall(): void {
    const width = this.boardSpan + 3.4;
    const pageWidth = width / 2;
    const cover = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.72, 9.75, 0.24),
      new THREE.MeshStandardMaterial({ color: 0xbab1a8, roughness: 0.86 }),
    );
    cover.position.set(0, 0.32, -3.43);
    this.scene.add(cover);

    const leftPage = new THREE.Mesh(
      new THREE.BoxGeometry(pageWidth, 9.18, 0.18),
      new THREE.MeshStandardMaterial({ map: this.createJournalPageTexture("left"), color: 0xfffdf7, roughness: 0.96 }),
    );
    const rightPage = new THREE.Mesh(
      new THREE.BoxGeometry(pageWidth, 9.18, 0.18),
      new THREE.MeshStandardMaterial({ map: this.createJournalPageTexture("right"), color: 0xfffdf7, roughness: 0.96 }),
    );
    leftPage.position.set(-pageWidth / 2 - 0.03, 0.42, -3.23);
    rightPage.position.set(pageWidth / 2 + 0.03, 0.42, -3.23);
    leftPage.rotation.y = -0.018;
    rightPage.rotation.y = 0.018;
    this.scene.add(leftPage, rightPage);

    const seam = new THREE.Mesh(
      new THREE.BoxGeometry(0.075, 9.08, 0.08),
      new THREE.MeshBasicMaterial({ color: 0x807777, transparent: true, opacity: 0.22 }),
    );
    seam.position.set(0, 0.42, -3.05);
    this.scene.add(seam);

    const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0xe1ddd3, roughness: 0.9 });
    [-1, 1].forEach((side) => {
      const pageEdge = new THREE.Mesh(new THREE.BoxGeometry(0.22, 8.95, 0.12), edgeMaterial);
      pageEdge.position.set(side * (width / 2 + 0.13), 0.37, -3.28);
      this.scene.add(pageEdge);
    });
    this.createDeskTools(width);
  }

  private createJournalPageTexture(side: "left" | "right"): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const context = canvas.getContext("2d")!;
    context.fillStyle = side === "left" ? "#faf8f0" : "#fdfbf4";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(89,81,91,.34)";
    for (let x = 28; x < canvas.width; x += 30) {
      for (let y = 28; y < canvas.height; y += 30) {
        context.beginPath();
        context.arc(x, y, 2.1, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.lineCap = "round";
    context.globalAlpha = 0.38;
    context.lineWidth = 25;
    context.strokeStyle = side === "left" ? "#bea7d8" : "#f2c75c";
    context.beginPath();
    context.moveTo(side === "left" ? 90 : 620, 150);
    context.lineTo(side === "left" ? 390 : 910, 150);
    context.stroke();
    context.globalAlpha = 1;

    if (side === "right") {
      const flowers = [[760, 86, "#e99cae"], [835, 90, "#9ac585"], [905, 82, "#8f80bd"]] as const;
      flowers.forEach(([x, y, color]) => {
        context.strokeStyle = "#39323e";
        context.lineWidth = 5;
        context.beginPath();
        context.moveTo(x, y + 28);
        context.lineTo(x + 7, y + 68);
        context.stroke();
        context.fillStyle = color;
        for (let petal = 0; petal < 5; petal += 1) {
          const angle = (petal / 5) * Math.PI * 2;
          context.beginPath();
          context.arc(x + Math.cos(angle) * 13, y + Math.sin(angle) * 13, 10, 0, Math.PI * 2);
          context.fill();
        }
        context.fillStyle = "#f5ce58";
        context.beginPath();
        context.arc(x, y, 7, 0, Math.PI * 2);
        context.fill();
      });
    } else {
      context.fillStyle = "#39323e";
      context.font = "italic 54px Georgia";
      context.fillText("little moments", 82, 125);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return texture;
  }

  private createDeskTools(bookWidth: number): void {
    const addMarker = (x: number, y: number, rotation: number, color: number) => {
      const marker = new THREE.Group();
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.105, 0.105, 2.5, 14),
        new THREE.MeshStandardMaterial({ color: 0xf7f6ef, roughness: 0.56 }),
      );
      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 0.48, 14),
        new THREE.MeshStandardMaterial({ color, roughness: 0.52 }),
      );
      cap.position.y = 1.18;
      marker.add(body, cap);
      marker.position.set(x, y, -2.82);
      marker.rotation.z = rotation;
      this.scene.add(marker);
    };
    addMarker(-bookWidth / 2 + 1.3, 5.45, Math.PI / 2.7, 0x9fc858);
    addMarker(-bookWidth / 2 + 3.1, 5.65, Math.PI / 2.25, 0xe99aaf);
    const pen = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.07, 3.15, 12),
      new THREE.MeshStandardMaterial({ color: 0x292932, roughness: 0.35, metalness: 0.18 }),
    );
    pen.position.set(bookWidth / 2 - 0.45, -4.5, -2.75);
    pen.rotation.z = -0.34;
    this.scene.add(pen);
  }

  private addAurora(): void {
    const geometry = new THREE.PlaneGeometry(32, 20, 1, 1);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `
        varying vec2 vUv; uniform float uTime;
        float glow(vec2 p, vec2 c, float s){ return s/(length(p-c)+.08); }
        void main(){
          vec2 p=vUv; float wave=sin(p.x*7.+uTime*.13)*.035;
          vec3 plum=vec3(.85,.61,.76); vec3 blue=vec3(.57,.74,.86); vec3 amber=vec3(.95,.74,.42);
          float a=glow(p,vec2(.18,.67+wave),.035); float b=glow(p,vec2(.82,.35-wave),.03);
          vec3 color=plum*a+blue*b+amber*glow(p,vec2(.52,.85),.016);
          gl_FragColor=vec4(color,min(.28,(a+b)*.24));
        }`,
    });
    const aurora = new THREE.Mesh(geometry, material);
    aurora.position.set(0, 1, -7);
    aurora.name = "aurora";
    this.scene.add(aurora);
  }

  private createRibbon(memories: Memory[]): void {
    const count = Math.max(memories.length, 2);
    const points: THREE.Vector3[] = [];
    for (let index = 0; index < Math.max(count + 2, 7); index += 1) {
      const t = index / (Math.max(count + 2, 7) - 1);
      points.push(new THREE.Vector3(
        (t - 0.5) * this.boardSpan,
        Math.sin(t * Math.PI * 3.1) * 0.68 - 0.45,
        -2.68,
      ));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 180, 0.028, 7, false),
      new THREE.MeshStandardMaterial({ color: 0x4b4551, roughness: 0.9, transparent: true, opacity: 0.76 }),
    );
    this.scene.add(tube);

    memories.forEach((memory, index) => {
      const t = memories.length === 1 ? 0.5 : 0.08 + (index / (memories.length - 1)) * 0.84;
      const point = curve.getPointAt(t);
      point.y += 1.35 + (index % 2) * 0.74;
      point.z += 0.48 + (index % 2) * 0.08;
      this.createMemoryNode(memory, point, index);
    });
  }

  private createMemoryNode(memory: Memory, point: THREE.Vector3, index: number): void {
    const group = new THREE.Group() as FloatingObject;
    const texture = new THREE.TextureLoader().load(memory.artworkUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    const artwork = new THREE.Mesh(
      new THREE.PlaneGeometry(1.78, 2.12),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 0.78, metalness: 0.01 }),
    );
    artwork.position.set(0, 0.14, 0.09);
    artwork.userData.memory = memory;
    group.add(artwork);

    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(2.08, 2.68, 0.1),
      new THREE.MeshStandardMaterial({ color: 0xfffdf7, roughness: 0.96, metalness: 0.01 }),
    );
    group.add(frame);
    group.add(artwork);
    const tapeColors = [0xe3aed1, 0xa8d5c1, 0xf2d36d, 0xb8addd];
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.72, 0.22, 0.035),
      new THREE.MeshStandardMaterial({ color: tapeColors[index % tapeColors.length], roughness: 0.92, transparent: true, opacity: 0.82 }),
    );
    marker.position.set(0, 1.28, 0.18);
    marker.rotation.z = (index % 2 ? -1 : 1) * 0.09;
    group.add(marker);
    const label = this.createMemoryLabel(memory);
    label.position.set(0, -1.2, 0.12);
    group.add(label);
    group.position.copy(point);
    group.rotation.z = (index % 2 ? -1 : 1) * (0.018 + (index % 3) * 0.012);
    group.rotation.y = (index % 2 ? -1 : 1) * 0.025;
    group.userData.baseY = point.y;
    group.userData.phase = index * 1.7;
    group.userData.memory = memory;
    group.userData.targetScale = 1;
    this.scene.add(group);
    this.floating.push(group);
    this.interactives.push(artwork);
  }

  private createMemoryLabel(memory: Memory): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 128;
    const context = canvas.getContext("2d")!;
    context.textAlign = "center";
    context.fillStyle = "rgba(242,204,92,.48)";
    context.fillRect(88, 43, 464, 42);
    context.fillStyle = "#6d6372";
    context.font = "600 18px Arial";
    context.fillText(memory.date.slice(0, 4), 320, 29);
    context.fillStyle = "#302b35";
    context.font = "italic 31px Georgia";
    const title = memory.title.length > 28 ? `${memory.title.slice(0, 27)}…` : memory.title;
    context.fillText(title, 320, 79);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    label.scale.set(2.18, 0.44, 1);
    label.renderOrder = 5;
    return label;
  }

  private createAvatar(data: AvatarData, scale = 1): FloatingObject {
    const group = new THREE.Group() as FloatingObject;
    const skin = new THREE.MeshStandardMaterial({ color: data.palette[0], roughness: 0.65 });
    const cloth = new THREE.MeshStandardMaterial({ color: data.palette[1], roughness: 0.48, metalness: 0.12 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.39, 30, 30), skin);
    head.position.y = 2.05;
    group.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.405, 30, 18, 0, Math.PI * 2, 0, Math.PI * 0.56), cloth);
    hair.position.y = 2.14;
    group.add(hair);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.54, 0.9, 8, 20), cloth);
    torso.position.y = 1.12;
    group.add(torso);
    const legs = [-0.25, 0.25].map((x) => {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.78, 6, 14), cloth);
      leg.position.set(x, 0.15, 0);
      return leg;
    });
    group.add(...legs);
    const halo = new THREE.PointLight(data.palette[0], 0.7, 4);
    halo.position.set(0, 1.5, 1.1);
    group.add(halo);
    group.scale.setScalar(scale);
    group.userData.baseY = group.position.y;
    group.userData.phase = data.userId.length;
    if (data.avatarUrl) void this.loadVrmAvatar(data.avatarUrl, group);
    return group;
  }

  private async loadVrmAvatar(url: string, target: FloatingObject): Promise<void> {
    const { VRMLoaderPlugin, VRMUtils } = await import("@pixiv/three-vrm");
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    try {
      const gltf = await loader.loadAsync(url);
      const vrm = gltf.userData.vrm as VRM | undefined;
      if (!vrm || !target.parent) return;
      VRMUtils.removeUnnecessaryVertices(vrm.scene);
      VRMUtils.combineSkeletons(vrm.scene);
      VRMUtils.rotateVRM0(vrm);
      const model = vrm.scene;
      model.updateMatrixWorld(true);
      const initialBounds = new THREE.Box3().setFromObject(model);
      const modelHeight = Math.max(0.1, initialBounds.max.y - initialBounds.min.y);
      model.scale.setScalar(2.65 / modelHeight);
      model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model);
      model.position.x = -(bounds.min.x + bounds.max.x) / 2;
      model.position.y = -bounds.min.y;
      model.position.z = -(bounds.min.z + bounds.max.z) / 2;
      target.clear();
      target.add(model);
      this.vrms.push(vrm);
    } catch (error) {
      console.warn("VIVERSE avatar model could not be rendered; using the artistic silhouette.", error);
    }
  }

  private createBoardAvatars(avatars: AvatarData[]): void {
    const positions = [
      new THREE.Vector3(-this.boardSpan * 0.39, -2.55, 2.1),
      new THREE.Vector3(this.boardSpan * 0.38, -2.55, 1.4),
      new THREE.Vector3(0, -2.35, -3.2),
      new THREE.Vector3(this.boardSpan * 0.18, -2.5, 2.4),
    ];
    avatars.slice(0, 4).forEach((avatar, index) => {
      const model = this.createAvatar(avatar, 0.58);
      model.position.copy(positions[index]);
      model.userData.baseY = model.position.y;
      this.scene.add(model);
      this.floating.push(model as FloatingObject);
    });
  }

  private resize = (): void => {
    const width = this.host.clientWidth || innerWidth;
    const height = this.host.clientHeight || innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
  };

  private handlePointerMove = (event: PointerEvent): void => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  };

  private handlePointerLeave = (): void => {
    this.pointer.set(2, 2);
  };

  private handleClick = (): void => {
    if (this.hovered?.userData.memory) this.onMemorySelect?.(this.hovered.userData.memory as Memory);
  };

  private updateHover(): void {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.interactives, false)[0]?.object ?? null;
    if (hit !== this.hovered) {
      if (this.hovered?.parent) this.hovered.parent.userData.targetScale = 1;
      this.hovered = hit;
      if (hit?.parent) hit.parent.userData.targetScale = 1.06;
      this.renderer.domElement.style.cursor = hit ? "pointer" : "default";
      this.renderer.domElement.dispatchEvent(new CustomEvent("memoryhover", { detail: hit?.userData.memory ?? null }));
    }
  }

  private animate = (): void => {
    this.frame = requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.1);
    const time = this.clock.elapsedTime;
    this.vrms.forEach((vrm) => vrm.update(delta));
    const particles = this.scene.getObjectByName("persistent-particles");
    if (particles) particles.rotation.y = time * 0.007;
    const aurora = this.scene.getObjectByName("aurora") as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | undefined;
    if (aurora) aurora.material.uniforms.uTime.value = time;
    this.floating.forEach((object) => {
      if (object.userData.baseY !== undefined) {
        object.position.y = object.userData.baseY + Math.sin(time * 0.72 + (object.userData.phase ?? 0)) * 0.055;
      }
      const target = object.userData.targetScale ?? object.scale.x;
      if (object.userData.memory) object.scale.lerp(new THREE.Vector3(target, target, target), 0.08);
    });
    if (this.viewMode === "board") this.updateHover();
    this.camera.position.x += (this.pointer.x * 0.32 - this.camera.position.x) * 0.008;
    this.camera.position.y += ((this.viewMode === "board" ? 2.6 : 1.4) + this.pointer.y * 0.2 - this.camera.position.y) * 0.008;
    this.camera.lookAt(this.cameraTarget);
    this.composer.render();
  };

  destroy(): void {
    cancelAnimationFrame(this.frame);
    removeEventListener("resize", this.resize);
    this.renderer.domElement.remove();
    this.renderer.dispose();
  }
}
