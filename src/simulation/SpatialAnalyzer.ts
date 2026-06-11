import * as THREE from 'three';
import type { Flock } from './Flock';
import type { Grid } from './Grid';
import type { SpatialData } from '../audio/Engine';

export class SpatialAnalyzer {
  densityRadius: number = 15;
  boidRange: number = 60;

  analyze(flock: Flock, grid: Grid): SpatialData {
    const data: SpatialData = {
      cells: {},
      flockSpeed: 0,
      boids: []
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

    // Pre-compute the grid transform matrix once
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion().setFromEuler(grid.rotation);
    matrix.compose(grid.position, quaternion, new THREE.Vector3(1, 1, 1));

    const width = grid.cols * grid.cellSize;
    const height = grid.rows * grid.cellSize;
    const offsetX = -width / 2 + grid.cellSize / 2;
    const offsetY = -height / 2 + grid.cellSize / 2;

    // Pre-compute active cell world positions for per-boid analysis
    const activeCells: { row: number; col: number; worldPos: THREE.Vector3 }[] = [];

    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const isActive = grid.cells[r][c];

        const localX = c * grid.cellSize + offsetX;
        const localY = r * grid.cellSize + offsetY;
        const cellWorldPos = new THREE.Vector3(localX, localY, 0).applyMatrix4(matrix);

        const distanceToCentroid = cellWorldPos.distanceTo(centroid);

        let density = 0;
        if (isActive) {
          activeCells.push({ row: r, col: c, worldPos: cellWorldPos });
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

    // Per-boid analysis: find closest active cell for each boid
    const boidRangeSq = this.boidRange * this.boidRange;
    const tiebreakTolerance = 3.0;

    for (const boid of flock.boids) {
      let minDistSq = Infinity;
      let candidates: { row: number; col: number }[] = [];

      for (const cell of activeCells) {
        const distSq = boid.position.distanceToSquared(cell.worldPos);
        if (distSq > boidRangeSq) continue;

        if (distSq < minDistSq - tiebreakTolerance * tiebreakTolerance) {
          // Clear winner — new minimum
          minDistSq = distSq;
          candidates = [{ row: cell.row, col: cell.col }];
        } else if (distSq < minDistSq + tiebreakTolerance * tiebreakTolerance) {
          // Within tolerance — add as tiebreaker candidate
          candidates.push({ row: cell.row, col: cell.col });
          if (distSq < minDistSq) minDistSq = distSq;
        }
      }

      if (candidates.length === 0) {
        data.boids.push({ closestCell: null, distanceToCell: Infinity });
      } else {
        const chosen = candidates[Math.floor(Math.random() * candidates.length)];
        data.boids.push({ closestCell: chosen, distanceToCell: Math.sqrt(minDistSq) });
      }
    }

    return data;
  }
}
