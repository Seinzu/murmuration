import * as THREE from 'three';

export interface BoidConfig {
  maxSpeed: number;
  maxForce: number;
  separationDistance: number;
  alignmentDistance: number;
  cohesionDistance: number;
  separationWeight: number;
  alignmentWeight: number;
  cohesionWeight: number;
  containmentRadius: number;
  containmentWeight: number;
  obstacleAvoidanceWeight: number;
  obstacleLookAhead: number;
  obstacleRadius: number;
}

export class Boid {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  acceleration: THREE.Vector3;

  constructor(x: number, y: number, z: number) {
    this.position = new THREE.Vector3(x, y, z);
    this.velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2
    );
    this.velocity.normalize();
    this.velocity.multiplyScalar(Math.random() * 2 + 1);
    this.acceleration = new THREE.Vector3(0, 0, 0);
  }

  applyForce(force: THREE.Vector3) {
    this.acceleration.add(force);
  }

  update(config: BoidConfig, delta: number) {
    this.velocity.add(this.acceleration);

    if (this.velocity.length() > config.maxSpeed) {
      this.velocity.normalize();
      this.velocity.multiplyScalar(config.maxSpeed);
    }

    const deltaVelocity = this.velocity.clone().multiplyScalar(delta * 60);
    this.position.add(deltaVelocity);

    this.acceleration.set(0, 0, 0);
  }

  separate(boids: Boid[], config: BoidConfig): THREE.Vector3 {
    const steer = new THREE.Vector3();
    let count = 0;

    for (let i = 0; i < boids.length; i++) {
      const other = boids[i];
      if (other === this) continue;

      const d = this.position.distanceToSquared(other.position);
      if (d > 0 && d < config.separationDistance * config.separationDistance) {
        const diff = new THREE.Vector3().subVectors(this.position, other.position);
        diff.normalize();
        diff.divideScalar(Math.sqrt(d));
        steer.add(diff);
        count++;
      }
    }

    if (count > 0) {
      steer.divideScalar(count);
    }

    if (steer.length() > 0) {
      steer.normalize();
      steer.multiplyScalar(config.maxSpeed);
      steer.sub(this.velocity);
      if (steer.length() > config.maxForce) {
          steer.normalize().multiplyScalar(config.maxForce);
      }
    }

    return steer;
  }

  align(boids: Boid[], config: BoidConfig): THREE.Vector3 {
    const sum = new THREE.Vector3();
    let count = 0;

    for (let i = 0; i < boids.length; i++) {
      const other = boids[i];
      if (other === this) continue;

      const d = this.position.distanceToSquared(other.position);
      if (d > 0 && d < config.alignmentDistance * config.alignmentDistance) {
        sum.add(other.velocity);
        count++;
      }
    }

    if (count > 0) {
      sum.divideScalar(count);
      sum.normalize();
      sum.multiplyScalar(config.maxSpeed);

      const steer = new THREE.Vector3().subVectors(sum, this.velocity);
      if (steer.length() > config.maxForce) {
          steer.normalize().multiplyScalar(config.maxForce);
      }
      return steer;
    }

    return new THREE.Vector3();
  }

  cohere(boids: Boid[], config: BoidConfig): THREE.Vector3 {
    const sum = new THREE.Vector3();
    let count = 0;

    for (let i = 0; i < boids.length; i++) {
      const other = boids[i];
      if (other === this) continue;

      const d = this.position.distanceToSquared(other.position);
      if (d > 0 && d < config.cohesionDistance * config.cohesionDistance) {
        sum.add(other.position);
        count++;
      }
    }

    if (count > 0) {
      sum.divideScalar(count);
      return this.seek(sum, config);
    }
    return new THREE.Vector3();
  }

  contain(config: BoidConfig): THREE.Vector3 {
    const distanceFromCenter = this.position.length();

    if (distanceFromCenter > config.containmentRadius) {
      const center = new THREE.Vector3(0, 0, 0);
      return this.seek(center, config);
    }

    return new THREE.Vector3();
  }

  avoidObstacles(obstacles: THREE.Vector3[], config: BoidConfig): THREE.Vector3 {
    const steer = new THREE.Vector3();
    let count = 0;

    const ahead = this.velocity.clone().normalize().multiplyScalar(config.obstacleLookAhead);
    const feeler = new THREE.Vector3().addVectors(this.position, ahead);

    for (let i = 0; i < obstacles.length; i++) {
      const obstacle = obstacles[i];

      const d = feeler.distanceToSquared(obstacle);
      const radiusSq = config.obstacleRadius * config.obstacleRadius;

      if (d < radiusSq) {
        const diff = new THREE.Vector3().subVectors(this.position, obstacle);
        diff.normalize();

        diff.divideScalar(Math.sqrt(d) || 0.1);
        steer.add(diff);
        count++;
      }
    }

    if (count > 0) {
      steer.divideScalar(count);

      steer.normalize();
      steer.multiplyScalar(config.maxSpeed);
      steer.sub(this.velocity);
      if (steer.length() > config.maxForce * 2) {
          steer.normalize().multiplyScalar(config.maxForce * 2);
      }
    }

    return steer;
  }

  seek(target: THREE.Vector3, config: BoidConfig): THREE.Vector3 {
    const desired = new THREE.Vector3().subVectors(target, this.position); // A vector pointing from the location to the target

    desired.normalize();
    desired.multiplyScalar(config.maxSpeed);

    const steer = new THREE.Vector3().subVectors(desired, this.velocity);
    if (steer.length() > config.maxForce) {
        steer.normalize().multiplyScalar(config.maxForce);
    }
    return steer;
  }
}
