import './style.css';
import * as THREE from 'three';
import GUI from 'lil-gui';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FilmPass } from 'three/addons/postprocessing/FilmPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Flock } from './simulation/Flock';
import { Grid } from './simulation/Grid';
import { SpatialAnalyzer } from './simulation/SpatialAnalyzer';
import type { BoidConfig } from './simulation/Boid';
import { audioEngine } from './audio/Engine';
import { Scales, type ScaleName } from './audio/Scales';
import { SocketClient } from './network/SocketClient';
import { TrailManager } from './rendering/TrailManager';

// --- Configuration ---
const config: BoidConfig & { count: number } = {
  count: 200, // Initial number of birds
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
scene.background = new THREE.Color('#0a0e1a'); // Deep blue-purple dusk
scene.fog = new THREE.FogExp2('#0a0e1a', 0.006);

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
  metalness: 0.1,
  emissive: '#4a6fa5',
  emissiveIntensity: 0.0,
});

const MAX_BIRDS = 250;
const instancedMesh = new THREE.InstancedMesh(geometry, material, MAX_BIRDS);
instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(instancedMesh);

const flockLight = new THREE.PointLight('#6ea8d7', 0, 80);
scene.add(flockLight);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.4,  // strength
  0.3,  // radius
  0.6   // threshold
);
composer.addPass(bloomPass);

const filmPass = new FilmPass(0.15);
composer.addPass(filmPass);

const vignettePass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    darkness: { value: 1.2 },
    offset: { value: 1.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float darkness;
    uniform float offset;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float dist = distance(vUv, vec2(0.5));
      color.rgb *= smoothstep(0.8, offset * 0.5, dist * (darkness + offset));
      gl_FragColor = color;
    }
  `,
});
composer.addPass(vignettePass);

composer.addPass(new OutputPass());

const trailManager = new TrailManager(MAX_BIRDS, scene);

const flock = new Flock(config.count, config);
const spatialAnalyzer = new SpatialAnalyzer();

instancedMesh.count = config.count;


const gridRows = 8;
const gridCols = 16;
const cellSize = 10;
const interactiveGrid = new Grid(gridRows, gridCols, cellSize);

const socketClient = new SocketClient('ws://localhost:8080');

socketClient.onToggleCommand((row, col) => {
  interactiveGrid.toggleCell(row, col);
  syncGridTransforms();
  // Note: We don't send the state back here to prevent echo loops
  socketClient.sendGridState(interactiveGrid.cells);
});

const cubeGeometry = new THREE.BoxGeometry(cellSize, cellSize, cellSize);
const cubeMaterial = new THREE.MeshStandardMaterial({
  color: 0x3a3a4a,
  roughness: 0.2,
  metalness: 0.8,
  emissive: 0x8b2500,
  emissiveIntensity: 0.15,
});
const maxCubes = gridRows * gridCols;
const gridInstancedMesh = new THREE.InstancedMesh(cubeGeometry, cubeMaterial, maxCubes);
gridInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
gridInstancedMesh.count = 0;
scene.add(gridInstancedMesh);

const edgeCubeGeometry = new THREE.BoxGeometry(cellSize * 1.01, cellSize * 1.01, cellSize * 1.01);
const edgeMaterial = new THREE.MeshBasicMaterial({
  color: 0xb5451b,
  wireframe: true,
  transparent: true,
  opacity: 0.7,
});
const gridEdgesMesh = new THREE.InstancedMesh(edgeCubeGeometry, edgeMaterial, maxCubes);
gridEdgesMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
gridEdgesMesh.count = 0;
scene.add(gridEdgesMesh);

const planeGeometry = new THREE.PlaneGeometry(gridCols * cellSize, gridRows * cellSize);
const planeMaterial = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
const raycastPlane = new THREE.Mesh(planeGeometry, planeMaterial);
scene.add(raycastPlane);

function syncGridTransforms(time: number = 0) {
  raycastPlane.position.copy(interactiveGrid.position);
  raycastPlane.rotation.copy(interactiveGrid.rotation);

  interactiveGrid.updateActivePositions(time);

  gridInstancedMesh.count = interactiveGrid.activePositions.length;
  gridEdgesMesh.count = interactiveGrid.activePositions.length;
  const dummy = new THREE.Object3D();
  interactiveGrid.activePositions.forEach((pos, i) => {
    dummy.position.copy(pos);
    dummy.rotation.copy(interactiveGrid.rotation);
    dummy.updateMatrix();
    gridInstancedMesh.setMatrixAt(i, dummy.matrix);
    gridEdgesMesh.setMatrixAt(i, dummy.matrix);
  });
  gridInstancedMesh.instanceMatrix.needsUpdate = true;
  gridEdgesMesh.instanceMatrix.needsUpdate = true;
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

    interactiveGrid.toggleCell(row, col);
    syncGridTransforms();

    socketClient.sendGridState(interactiveGrid.cells);
  }
});

const gui = new GUI({ title: 'Murmuration Settings' });

gui.add(config, 'count', 10, MAX_BIRDS, 1).name('Number of Birds').onChange((v: number) => {
  flock.setCount(v);
  instancedMesh.count = v;
});

const physicsFolder = gui.addFolder('Physics');
physicsFolder.add(config, 'maxSpeed', 0.1, 2.0, 0.1).name('Max Speed');
physicsFolder.add(config, 'maxForce', 0.01, 0.2, 0.01).name('Steering Force');

let baseSeparationWeight = config.separationWeight;
let baseCohesionWeight = config.cohesionWeight;

const rulesFolder = gui.addFolder('Boid Rules (Weights)');
rulesFolder.add(config, 'separationWeight', 0.0, 5.0, 0.1).name('Separation').onChange((v: number) => { baseSeparationWeight = v; });
rulesFolder.add(config, 'alignmentWeight', 0.0, 5.0, 0.1).name('Alignment');
rulesFolder.add(config, 'cohesionWeight', 0.0, 5.0, 0.1).name('Cohesion').onChange((v: number) => { baseCohesionWeight = v; });

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
  .onChange(() => {
    clock.update();
    syncGridTransforms(clock.getElapsed())
  });
gridFolder.add(interactiveGrid.rotation, 'y', -Math.PI, Math.PI, 0.01)
  .name('Grid Yaw')
  .onChange(() => {
    clock.update();
    syncGridTransforms(clock.getElapsed())
  });
gridFolder.add(config, 'obstacleAvoidanceWeight', 0.0, 15.0, 0.5).name('Avoidance Weight');
gridFolder.add(config, 'obstacleLookAhead', 5.0, 40.0, 1.0).name('Look Ahead Dist');
gridFolder.add({ clear: () => {
  interactiveGrid.clear();
  clock.update();
  syncGridTransforms(clock.getElapsed());
  socketClient.sendGridState(interactiveGrid.cells);
} }, 'clear').name('Clear Grid');

const waveFolder = gui.addFolder('Grid Tidal Waves');
waveFolder.add(interactiveGrid, 'waveAmplitude', 0.0, 20.0, 0.5).name('Wave Height');
waveFolder.add(interactiveGrid, 'waveFrequency', 0.01, 0.2, 0.01).name('Wave Frequency');
waveFolder.add(interactiveGrid, 'waveSpeed', 0.0, 1.0, 0.01).name('Wave Speed');

const appState = { cameraSpin: false };
gui.add(appState, 'cameraSpin').name('Spin Camera');

const fxFolder = gui.addFolder('Post-Processing');
fxFolder.add(bloomPass, 'strength', 0.0, 1.5, 0.05).name('Bloom Strength');
fxFolder.add(bloomPass, 'threshold', 0.0, 1.0, 0.05).name('Bloom Threshold');
const filmGrainState = { intensity: 0.15 };
fxFolder.add(filmGrainState, 'intensity', 0.0, 1.0, 0.05).name('Film Grain').onChange((v: number) => {
  (filmPass.uniforms as Record<string, { value: unknown }>).intensity.value = v;
});

const audioFolder = gui.addFolder('Audio (SuperCollider)');
audioFolder.add(audioEngine, 'mode', ['drone', 'trigger']).name('Audio Mode');
const scaleNames = Object.keys(Scales) as ScaleName[];
audioFolder.add(audioEngine, 'currentScaleName', scaleNames).name('Musical Scale');
audioFolder.add(audioEngine, 'droneRadius', 10, 150, 5).name('Drone Proximity');
audioFolder.add(audioEngine, 'triggerDensityThreshold', 1, 10, 1).name('Trigger Density');
audioFolder.add(spatialAnalyzer, 'densityRadius', 5, 50, 1).name('Density Search Radius');
audioFolder.add({ trigger: () => audioEngine.triggerThunder() }, 'trigger').name('Trigger Thunder');

const arcFolder = gui.addFolder('Arc Mappings');
const arcState = { enc0: '', enc1: '', enc2: '', enc3: '' };
const arcControllers: ReturnType<typeof arcFolder.add>[] = [];

socketClient.onArcMappingsUpdate((data) => {
  const paramNames = data.availableParams.map(p => p.name);
  arcState.enc0 = data.encoders[0]?.name ?? '';
  arcState.enc1 = data.encoders[1]?.name ?? '';
  arcState.enc2 = data.encoders[2]?.name ?? '';
  arcState.enc3 = data.encoders[3]?.name ?? '';

  arcControllers.forEach(c => c.destroy());
  arcControllers.length = 0;

  (['enc0', 'enc1', 'enc2', 'enc3'] as const).forEach((key, i) => {
    const ctrl = arcFolder.add(arcState, key, paramNames).name(`Encoder ${i}`).onChange((name: string) => {
      const paramIndex = data.availableParams.findIndex(p => p.name === name);
      if (paramIndex !== -1) socketClient.sendArcMapping(i, paramIndex);
    });
    arcControllers.push(ctrl);
  });
});

// Request initial mappings once connected
const requestMappingsOnConnect = setInterval(() => {
  if (socketClient.isConnected) {
    socketClient.requestArcMappings();
    clearInterval(requestMappingsOnConnect);
  }
}, 1000);

const clock = new THREE.Timer();
let simulationStarted = false;

function animate() {
  requestAnimationFrame(animate);

  if (!simulationStarted) return;

  clock.update();

  const delta = clock.getDelta();
  const time = clock.getElapsed();

  syncGridTransforms(time);

  flock.update(delta, instancedMesh, interactiveGrid.activePositions);
  trailManager.update(flock);

  const spatialData = spatialAnalyzer.analyze(flock, interactiveGrid);
  audioEngine.update(spatialData);

  // Thunder modulation: bloom, emissive, light, and boid scatter
  const thunder = audioEngine.thunderIntensity;

  bloomPass.strength = 0.4 + thunder * 0.8;
  material.emissiveIntensity = spatialData.flockSpeed * 0.3 + thunder * 0.5;

  // Boid scatter: thunder startles the flock, then they regroup
  config.separationWeight = baseSeparationWeight + thunder * 8;
  config.cohesionWeight = baseCohesionWeight * (1 - thunder * 0.8);

  if (flock.boids.length > 0) {
    const centroid = new THREE.Vector3();
    for (const boid of flock.boids) centroid.add(boid.position);
    centroid.divideScalar(flock.boids.length);
    flockLight.position.lerp(centroid, 0.1);
    flockLight.intensity = 0.5 + spatialData.flockSpeed * 0.5 + thunder * 2.0;
  }

  if (appState.cameraSpin) {
    camera.position.x = Math.sin(time * 0.1) * 120;
    camera.position.z = Math.cos(time * 0.1) * 120;
  } else {
    camera.position.x = 0;
    camera.position.z = 120;
  }
  camera.lookAt(0, 0, 0);

  composer.render();
}

animate();

const overlay = document.getElementById('start-overlay');
const startBtn = document.getElementById('start-btn');

startBtn?.addEventListener('click', async () => {
  await audioEngine.initialize(socketClient);

  if (overlay) {
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.style.display = 'none';
    }, 500);
  }

  simulationStarted = true;
  clock.reset()// Reset clock so animations don't jump
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});
