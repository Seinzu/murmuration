import * as THREE from 'three';
import type { Flock } from './Flock';
import type { Grid } from './Grid';
import type { SpatialData } from '../audio/Engine';

export class SpatialAnalyzer {
  densityRadius: number = 15;

  analyze(flock: Flock, grid: Grid): SpatialData {
    const data: SpatialData = {
      cells: {},
      flockSpeed: 0
    };

    if (flock.boids.length === 0) return data;

    const centroid = new THREE.Vector3();
    let totalSpeed = 0;

    for (const boid of flock.boids) {
      centroid.add(boid.position);
      totalSpeed += boid.velocity.length();
    }

    centroid.divideScalar(flock.boids.length);
    data.flockSpeed = totalSpeed / flock.boids.length;

    const densityRadiusSq = this.densityRadius * this.densityRadius;

    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const isActive = grid.cells[r][c];

        // Find the 3D position of this specific cell.
        // We know that activePositions in the Grid class holds the 3D vectors,
        // but to map it back to (row, col) efficiently without reverse-transforming,
        // we can re-calculate the local->world position just like Grid.ts does.

        // We need a matrix to transform local grid coordinates to world coordinates
        const matrix = new THREE.Matrix4();
        const quaternion = new THREE.Quaternion().setFromEuler(grid.rotation);
        matrix.compose(grid.position, quaternion, new THREE.Vector3(1, 1, 1));

        const width = grid.cols * grid.cellSize;
        const height = grid.rows * grid.cellSize;
        const offsetX = -width / 2 + grid.cellSize / 2;
        const offsetY = -height / 2 + grid.cellSize / 2;

        const localX = c * grid.cellSize + offsetX;
        const localY = r * grid.cellSize + offsetY;

        const cellWorldPos = new THREE.Vector3(localX, localY, 0).applyMatrix4(matrix);

        const distanceToCentroid = cellWorldPos.distanceTo(centroid);

        let density = 0;
        if (isActive) {
          for (const boid of flock.boids) {
            if (boid.position.distanceToSquared(cellWorldPos) < densityRadiusSq) {
              density++;
            }
          }
        }

        data.cells[`${r},${c}`] = {
          active: isActive,
          distanceToCentroid,
          density
        };
      }
    }

    return data;
  }
}
