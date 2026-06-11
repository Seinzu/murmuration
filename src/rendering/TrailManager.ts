import * as THREE from 'three';
import type { Flock } from '../simulation/Flock';

const TRAIL_LENGTH = 8;

export class TrailManager {
  private maxBoids: number;
  private geometry: THREE.BufferGeometry;
  private positions: Float32Array;
  private alphas: Float32Array;
  private mesh: THREE.Points;
  private history: THREE.Vector3[][];
  private frameIndex: number = 0;

  constructor(maxBoids: number, scene: THREE.Scene) {
    this.maxBoids = maxBoids;
    const totalPoints = maxBoids * TRAIL_LENGTH;

    this.positions = new Float32Array(totalPoints * 3);
    this.alphas = new Float32Array(totalPoints);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1));

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {},
      vertexShader: `
        attribute float alpha;
        varying float vAlpha;
        void main() {
          vAlpha = alpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = 2.0 * (150.0 / -mvPosition.z);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          if (d > 0.5) discard;
          gl_FragColor = vec4(0.7, 0.8, 0.95, vAlpha * smoothstep(0.2, 0.0, d));
        }
      `,
    });

    this.mesh = new THREE.Points(this.geometry, material);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    this.history = [];
    for (let i = 0; i < maxBoids; i++) {
      this.history.push([]);
    }
  }

  update(flock: Flock) {
    const boidCount = flock.boids.length;
    this.frameIndex++;

    // Only record every other frame to space out trails
    const shouldRecord = this.frameIndex % 2 === 0;

    for (let i = 0; i < boidCount; i++) {
      const trail = this.history[i];

      if (shouldRecord) {
        trail.unshift(flock.boids[i].position.clone());
        if (trail.length > TRAIL_LENGTH) trail.pop();
      }

      for (let t = 0; t < TRAIL_LENGTH; t++) {
        const idx = (i * TRAIL_LENGTH + t) * 3;
        if (t < trail.length) {
          this.positions[idx] = trail[t].x;
          this.positions[idx + 1] = trail[t].y;
          this.positions[idx + 2] = trail[t].z;
          this.alphas[i * TRAIL_LENGTH + t] = 1.0 - t / TRAIL_LENGTH;
        } else {
          this.positions[idx] = 0;
          this.positions[idx + 1] = 0;
          this.positions[idx + 2] = 0;
          this.alphas[i * TRAIL_LENGTH + t] = 0;
        }
      }
    }

    // Zero out unused boid slots
    for (let i = boidCount; i < this.maxBoids; i++) {
      this.history[i].length = 0;
      for (let t = 0; t < TRAIL_LENGTH; t++) {
        const idx = (i * TRAIL_LENGTH + t) * 3;
        this.positions[idx] = 0;
        this.positions[idx + 1] = 0;
        this.positions[idx + 2] = 0;
        this.alphas[i * TRAIL_LENGTH + t] = 0;
      }
    }

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.alpha.needsUpdate = true;
  }
}
