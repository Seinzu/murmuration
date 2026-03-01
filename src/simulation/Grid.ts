import * as THREE from 'three';

export class Grid {
  rows: number;
  cols: number;
  cellSize: number;
  cells: boolean[][];

  // Transform properties
  position: THREE.Vector3;
  rotation: THREE.Euler; // We'll control x (pitch) and y (yaw)
  
  // Cache active positions for performance so we don't calculate them per boid per frame
  activePositions: THREE.Vector3[] = [];

  constructor(rows: number, cols: number, cellSize: number) {
    this.rows = rows;
    this.cols = cols;
    this.cellSize = cellSize;

    this.position = new THREE.Vector3(0, 0, 0);
    this.rotation = new THREE.Euler(Math.PI / 4, 0, 0); // 45 degrees pitch

    this.cells = Array(rows).fill(null).map(() => Array(cols).fill(false));
  }

  toggleCell(row: number, col: number) {
    if (row >= 0 && row < this.rows && col >= 0 && col < this.cols) {
      this.cells[row][col] = !this.cells[row][col];
      this.updateActivePositions();
    }
  }

  clear() {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this.cells[r][c] = false;
      }
    }
    this.updateActivePositions();
  }

  // Called whenever the grid changes or rotates
  updateActivePositions() {
    this.activePositions = [];

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion().setFromEuler(this.rotation);
    matrix.compose(this.position, quaternion, new THREE.Vector3(1, 1, 1));

    const width = this.cols * this.cellSize;
    const height = this.rows * this.cellSize;
    const offsetX = -width / 2 + this.cellSize / 2;
    const offsetY = -height / 2 + this.cellSize / 2;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.cells[r][c]) {
          const localX = c * this.cellSize + offsetX;
          const localY = r * this.cellSize + offsetY;
          
          // The grid is on the XY plane locally.
          const localPos = new THREE.Vector3(localX, localY, 0);
          
          // Transform to world position based on grid rotation/position
          localPos.applyMatrix4(matrix);

          this.activePositions.push(localPos);
        }
      }
    }
  }
}
