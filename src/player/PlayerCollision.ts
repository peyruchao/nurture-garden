import * as THREE from "three";

export const constrainPlayer = (position: THREE.Vector3, boundary = 50): void => {
  position.x = THREE.MathUtils.clamp(position.x, -boundary, boundary);
  position.z = THREE.MathUtils.clamp(position.z, -boundary, boundary);
  position.y = 1.65;
};
