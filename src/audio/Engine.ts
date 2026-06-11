import { Scales, type ScaleName } from './Scales';
import type { SocketClient } from '../network/SocketClient';

export type AudioMode = 'drone' | 'trigger';

export interface BoidSpatialData {
  closestCell: { row: number; col: number } | null;
  distanceToCell: number;
}

export interface SpatialData {
  cells: Record<string, {
    active: boolean;
    distanceToCentroid: number;
    density: number;
  }>;
  flockSpeed: number;
  boids: BoidSpatialData[];
}

export class AudioEngine {
  isInitialized = false;
  mode: AudioMode = 'drone';
  currentScaleName: ScaleName = 'Minor Pentatonic';

  // Configurable parameters (still exposed for lil-gui)
  droneRadius: number = 50;
  triggerDensityThreshold: number = 3;
  boidRange: number = 60;
  maxBoidDrones: number = 100;

  // Thunder intensity envelope (0-1), decays each frame
  thunderIntensity: number = 0;
  private static readonly THUNDER_DECAY = 0.97;

  private socketClient: SocketClient | null = null;
  private activeBoidDrones: Map<number, { row: number; col: number; presence: number }> = new Map();
  private lastTriggerTime: Record<string, number> = {};
  private frameCount: number = 0;

  async initialize(socketClient: SocketClient) {
    if (this.isInitialized) return;
    this.socketClient = socketClient;
    this.isInitialized = true;
    console.log('AudioEngine initialised — forwarding events to SuperCollider via server OSC bridge.');
  }

  private getFreqForGrid(row: number, _col: number): number {
    const scale = Scales[this.currentScaleName];
    return scale[row % scale.length];
  }

  private send(event: Record<string, unknown>) {
    this.socketClient?.sendAudioEvent(event);
  }

  update(spatialData: SpatialData) {
    if (!this.isInitialized) return;

    // Decay thunder intensity each frame
    this.thunderIntensity *= AudioEngine.THUNDER_DECAY;
    if (this.thunderIntensity < 0.001) this.thunderIntensity = 0;

    // Global filter modulation: flock speed → filter cutoff in SC
    this.send({ event: 'flock_speed', speed: spatialData.flockSpeed });

    if (this.mode === 'trigger') {
      for (const [key, data] of Object.entries(spatialData.cells)) {
        const [rStr, cStr] = key.split(',');
        const row = parseInt(rStr);
        const col = parseInt(cStr);
        const freq = this.getFreqForGrid(row, col);
        this.handleTriggerMode(key, row, col, data, freq);
      }
    } else if (this.mode === 'drone') {
      this.frameCount++;
      if (this.frameCount % 3 === 0) {
        this.handleBoidDroneMode(spatialData);
      }
    }
  }

  private handleTriggerMode(
    key: string,
    row: number,
    col: number,
    data: { active: boolean; density: number },
    freq: number
  ) {
    if (!data.active) return;
    if (data.density < this.triggerDensityThreshold) return;

    const now = performance.now() / 1000; // seconds
    const lastTrigger = this.lastTriggerTime[key] ?? 0;
    if (now - lastTrigger < 0.25) return;

    const excess = data.density - this.triggerDensityThreshold;
    const velocity = Math.min(0.3 + excess * 0.1, 1.0);
    this.send({ event: 'trigger', row, col, freq, velocity });
    this.lastTriggerTime[key] = now;
  }

  private handleBoidDroneMode(spatialData: SpatialData) {
    // Build list of boids with their closest cell and distance, sorted by distance
    const candidates: { boidIndex: number; row: number; col: number; distance: number }[] = [];

    for (let i = 0; i < spatialData.boids.length; i++) {
      const boidData = spatialData.boids[i];
      if (boidData.closestCell && boidData.distanceToCell < this.boidRange) {
        candidates.push({
          boidIndex: i,
          row: boidData.closestCell.row,
          col: boidData.closestCell.col,
          distance: boidData.distanceToCell
        });
      }
    }

    // Sort by distance (closest first) and cap at maxBoidDrones
    candidates.sort((a, b) => a.distance - b.distance);
    const activeCandidates = candidates.slice(0, this.maxBoidDrones);
    const activeSet = new Set(activeCandidates.map(c => c.boidIndex));

    // Process each candidate
    for (const candidate of activeCandidates) {
      const presence = Math.max(0, Math.min(1, 1.0 - candidate.distance / this.boidRange));
      const modIndex = 1 + presence * 5;
      const freq = this.getFreqForGrid(candidate.row, candidate.col);
      const existing = this.activeBoidDrones.get(candidate.boidIndex);

      if (!existing) {
        // New drone
        this.send({ event: 'drone_on', boidIndex: candidate.boidIndex, freq, presence, modIndex });
        this.activeBoidDrones.set(candidate.boidIndex, {
          row: candidate.row,
          col: candidate.col,
          presence
        });
      } else if (existing.row !== candidate.row || existing.col !== candidate.col) {
        // Cell changed — re-trigger with new frequency
        this.send({ event: 'drone_off', boidIndex: candidate.boidIndex });
        this.send({ event: 'drone_on', boidIndex: candidate.boidIndex, freq, presence, modIndex });
        this.activeBoidDrones.set(candidate.boidIndex, {
          row: candidate.row,
          col: candidate.col,
          presence
        });
      } else if (Math.abs(existing.presence - presence) > 0.02) {
        // Same cell, presence changed enough to update
        this.send({ event: 'drone_update', boidIndex: candidate.boidIndex, presence, modIndex });
        existing.presence = presence;
      }
    }

    // Cleanup: remove drones for boids no longer in range or beyond cap
    for (const [boidIndex] of this.activeBoidDrones) {
      if (!activeSet.has(boidIndex)) {
        this.send({ event: 'drone_off', boidIndex });
        this.activeBoidDrones.delete(boidIndex);
      }
    }
  }

  triggerThunder() {
    this.send({ event: 'thunder' });
    this.thunderIntensity = 1.0;
  }
}

export const audioEngine = new AudioEngine();
