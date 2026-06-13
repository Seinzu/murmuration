import * as THREE from 'three';
import { Boid, type BoidConfig } from './Boid';

export class Flock {
  boids: Boid[] = [];
  config: BoidConfig;

  private sepForce = new THREE.Vector3();
  private aliForce = new THREE.Vector3();
  private cohForce = new THREE.Vector3();
  private contForce = new THREE.Vector3();
  private avoidForce = new THREE.Vector3();

  constructor(count: number, config: BoidConfig) {
    this.config = config;
    this.setCount(count);
  }

  setCount(newCount: number) {
    if (newCount > this.boids.length) {
      const toAdd = newCount - this.boids.length;
      for (let i = 0; i < toAdd; i++) {
        const r = Math.random() * 50;
        const theta = Math.random() * 2 * Math.PI;
        const phi = Math.acos(2 * Math.random() - 1);

        const x = r * Math.sin(phi) * Math.cos(theta);
        const y = r * Math.sin(phi) * Math.sin(theta);
        const z = r * Math.cos(phi);

        this.boids.push(new Boid(x, y, z, this.boids.length));
      }
    } else if (newCount < this.boids.length) {
      this.boids.splice(newCount);
    }
  }

  update(delta: number, instancedMesh: THREE.InstancedMesh, obstacles: THREE.Vector3[] = []) {
    const dummy = new THREE.Object3D();

    for (let i = 0; i < this.boids.length; i++) {
      const boid = this.boids[i];

      this.sepForce.copy(boid.separate(this.boids, this.config));
      this.aliForce.copy(boid.align(this.boids, this.config));
      this.cohForce.copy(boid.cohere(this.boids, this.config));
      this.contForce.copy(boid.contain(this.config));
      this.avoidForce.copy(boid.avoidObstacles(obstacles, this.config));

      this.sepForce.multiplyScalar(this.config.separationWeight);
      this.aliForce.multiplyScalar(this.config.alignmentWeight);
      this.cohForce.multiplyScalar(this.config.cohesionWeight);
      this.contForce.multiplyScalar(this.config.containmentWeight);
      this.avoidForce.multiplyScalar(this.config.obstacleAvoidanceWeight);

      boid.applyForce(this.sepForce);
      boid.applyForce(this.aliForce);
      boid.applyForce(this.cohForce);
      boid.applyForce(this.contForce);
      boid.applyForce(this.avoidForce);

      boid.update(this.config, delta);

      dummy.position.copy(boid.position);

      const target = boid.position.clone().add(boid.velocity);
      dummy.lookAt(target);

      dummy.rotateX(Math.PI / 2);

      dummy.updateMatrix();

      instancedMesh.setMatrixAt(i, dummy.matrix);
    }

    instancedMesh.instanceMatrix.needsUpdate = true;
  }
}
