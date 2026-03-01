import './style.css';
import * as THREE from 'three';
import GUI from 'lil-gui';
import { Flock } from './simulation/Flock';
import { Grid } from './simulation/Grid';
import type { BoidConfig } from './simulation/Boid';
import { audioEngine } from './audio/Engine';

// --- Configuration ---
const config: BoidConfig & { count: number } = {
  count: 500, // Initial number of birds
  maxSpeed: 0.8,
  maxForce: 0.05,
  separationDistance: 5.0,
  alignmentDistance: 15.0,
  cohesionDistance: 15.0,
  separationWeight: 1.5,
  alignmentWeight: 1.0,
  cohesionWeight: 1.0,
  containmentRadius: 60,
  containmentWeight: 2.0,
  obstacleAvoidanceWeight: 5.0,
  obstacleLookAhead: 15.0,
  obstacleRadius: 6.0, // Cell size is 10, so a radius of 6 covers it well
};

// --- Scene Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color('#111827'); // Dark slate background
scene.fog = new THREE.FogExp2('#111827', 0.005); // Add depth

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
// Position camera back so we can see the flock
camera.position.z = 120;
camera.position.y = 20;
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // optimize high dpi
document.getElementById('app')!.appendChild(renderer.domElement);

// --- Lighting ---
const ambientLight = new THREE.AmbientLight('#ffffff', 0.4);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight('#ffffff', 0.8);
directionalLight.position.set(50, 100, 50);
scene.add(directionalLight);

// --- Instanced Mesh (The Birds) ---
// Use a low-poly cone for the starling shape
const geometry = new THREE.ConeGeometry(0.5, 2, 4);
// Rotate geometry so default orientation is forward along Z-axis (easier logic)
geometry.rotateX(Math.PI / 2);

const material = new THREE.MeshStandardMaterial({
  color: '#cbd5e1',
  roughness: 0.7,
  metalness: 0.1
});

const MAX_BIRDS = 250;
const instancedMesh = new THREE.InstancedMesh(geometry, material, MAX_BIRDS);
instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(instancedMesh);

const flock = new Flock(config.count, config);

instancedMesh.count = config.count;

// --- Interactive Grid Setup ---
const gridRows = 10;
const gridCols = 10;
const cellSize = 10;
const interactiveGrid = new Grid(gridRows, gridCols, cellSize);

// The visible wireframe cubes
const cubeGeometry = new THREE.BoxGeometry(cellSize, cellSize, cellSize);
const cubeMaterial = new THREE.MeshBasicMaterial({
  color: 0x00ff00,
  wireframe: true,
  transparent: true,
  opacity: 0.5
});
const maxCubes = gridRows * gridCols;
const gridInstancedMesh = new THREE.InstancedMesh(cubeGeometry, cubeMaterial, maxCubes);
gridInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
gridInstancedMesh.count = 0; // Starts empty
scene.add(gridInstancedMesh);

const planeGeometry = new THREE.PlaneGeometry(gridCols * cellSize, gridRows * cellSize);
const planeMaterial = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
const raycastPlane = new THREE.Mesh(planeGeometry, planeMaterial);
scene.add(raycastPlane);

function syncGridTransforms(time: number = 0) {
  raycastPlane.position.copy(interactiveGrid.position);
  raycastPlane.rotation.copy(interactiveGrid.rotation);

  interactiveGrid.updateActivePositions(time);

  gridInstancedMesh.count = interactiveGrid.activePositions.length;
  const dummy = new THREE.Object3D();
  interactiveGrid.activePositions.forEach((pos, i) => {
    dummy.position.copy(pos);
    dummy.rotation.copy(interactiveGrid.rotation);
    dummy.updateMatrix();
    gridInstancedMesh.setMatrixAt(i, dummy.matrix);
  });
  gridInstancedMesh.instanceMatrix.needsUpdate = true;
}

syncGridTransforms();

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

window.addEventListener('click', (event) => {
  mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObject(raycastPlane);

  if (intersects.length > 0) {
    const hitPoint = intersects[0].point;

    const localHit = hitPoint.clone();
    raycastPlane.worldToLocal(localHit);

    const width = gridCols * cellSize;
    const height = gridRows * cellSize;

    const localX = localHit.x + width / 2;
    const localY = localHit.y + height / 2;

    const col = Math.floor(localX / cellSize);
    const row = Math.floor(localY / cellSize);

    // Toggle cell
    interactiveGrid.toggleCell(row, col);
    syncGridTransforms();
  }
});

const gui = new GUI({ title: 'Murmuration Settings' });

gui.add(config, 'count', 10, MAX_BIRDS, 1).name('Number of Birds').onChange((v: number) => {
  flock.setCount(v);
  instancedMesh.count = v; // Tell Three.js how many instances to actually render
});

const physicsFolder = gui.addFolder('Physics');
physicsFolder.add(config, 'maxSpeed', 0.1, 2.0, 0.1).name('Max Speed');
physicsFolder.add(config, 'maxForce', 0.01, 0.2, 0.01).name('Steering Force');

const rulesFolder = gui.addFolder('Boid Rules (Weights)');
rulesFolder.add(config, 'separationWeight', 0.0, 5.0, 0.1).name('Separation');
rulesFolder.add(config, 'alignmentWeight', 0.0, 5.0, 0.1).name('Alignment');
rulesFolder.add(config, 'cohesionWeight', 0.0, 5.0, 0.1).name('Cohesion');

const distancesFolder = gui.addFolder('Perception Radius');
distancesFolder.add(config, 'separationDistance', 1.0, 20.0, 0.5).name('Separation Radius');
distancesFolder.add(config, 'alignmentDistance', 5.0, 50.0, 0.5).name('Alignment Radius');
distancesFolder.add(config, 'cohesionDistance', 5.0, 50.0, 0.5).name('Cohesion Radius');

const containFolder = gui.addFolder('Containment Boundary');
containFolder.add(config, 'containmentRadius', 20, 150, 1).name('Boundary Radius');
containFolder.add(config, 'containmentWeight', 0.0, 5.0, 0.1).name('Boundary Pull');

const gridFolder = gui.addFolder('Interactive Grid');
gridFolder.add(interactiveGrid.rotation, 'x', -Math.PI / 2, Math.PI / 2, 0.01)
  .name('Grid Pitch')
  .onChange(() => syncGridTransforms(clock.getElapsedTime()));
gridFolder.add(interactiveGrid.rotation, 'y', -Math.PI, Math.PI, 0.01)
  .name('Grid Yaw')
  .onChange(() => syncGridTransforms(clock.getElapsedTime()));
gridFolder.add(config, 'obstacleAvoidanceWeight', 0.0, 15.0, 0.5).name('Avoidance Weight');
gridFolder.add(config, 'obstacleLookAhead', 5.0, 40.0, 1.0).name('Look Ahead Dist');
gridFolder.add({ clear: () => { interactiveGrid.clear(); syncGridTransforms(clock.getElapsedTime()); } }, 'clear').name('Clear Grid');

const waveFolder = gui.addFolder('Grid Tidal Waves');
waveFolder.add(interactiveGrid, 'waveAmplitude', 0.0, 20.0, 0.5).name('Wave Height');
waveFolder.add(interactiveGrid, 'waveFrequency', 0.01, 0.2, 0.01).name('Wave Frequency');
waveFolder.add(interactiveGrid, 'waveSpeed', 0.0, 2.0, 0.1).name('Wave Speed');

const appState = { cameraSpin: false };
gui.add(appState, 'cameraSpin').name('Spin Camera');

// --- Animation Loop ---
const clock = new THREE.Clock();
let simulationStarted = false;

function animate() {
  requestAnimationFrame(animate);

  if (!simulationStarted) return;

  const delta = clock.getDelta();
  const time = clock.getElapsedTime();

  syncGridTransforms(time);

  flock.update(delta, instancedMesh, interactiveGrid.activePositions);

  // Camera logic
  if (appState.cameraSpin) {
    camera.position.x = Math.sin(time * 0.1) * 120;
    camera.position.z = Math.cos(time * 0.1) * 120;
  } else {
    camera.position.x = 0;
    camera.position.z = 120;
  }
  camera.lookAt(0, 0, 0);

  renderer.render(scene, camera);
}

animate();

const overlay = document.getElementById('start-overlay');
const startBtn = document.getElementById('start-btn');

startBtn?.addEventListener('click', async () => {
  await audioEngine.initialize();

  if (overlay) {
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.style.display = 'none';
    }, 500);
  }

  simulationStarted = true;
  clock.start(); // Reset clock so animations don't jump
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
