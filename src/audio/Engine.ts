import * as Tone from 'tone';
import { Scales, type ScaleName } from './Scales';

export type AudioMode = 'drone' | 'trigger';

export interface SpatialData {
  // Key: "row,col", Value: The data for that grid cell
  cells: Record<string, {
    active: boolean;
    distanceToCentroid: number; // For drone mode
    density: number;            // For trigger mode
  }>;
  flockSpeed: number;
}

export interface ADSREnvelopeSettings {
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
}

export class AudioEngine {
  isInitialized = false;
  mode: AudioMode = 'drone';
  currentScaleName: ScaleName = 'Minor Pentatonic';

  // Tone.js Nodes
  // Map to hold an individual FMSynth for each grid cell
  private synths: Map<string, Tone.FMSynth> = new Map();
  private masterChannel!: Tone.Channel;
  private filter!: Tone.Filter;
  private reverb!: Tone.Reverb;
  private limiter!: Tone.Limiter;

  // Track which notes are currently droning so we don't re-trigger them
  private activeDroneNotes: Set<string> = new Set();

  // Track last played time for triggers to prevent machine-gunning
  private lastTriggerTime: Record<string, number> = {};

  // Configurable parameters
  masterVolume: number = -12; // dB
  reverbAmount: number = 0.6;
  triggerDensityThreshold: number = 3; // How many boids needed to pluck a note
  droneRadius: number = 50; // How close centroid needs to be to reach max volume
  
  // Envelope params bound to lil-gui
  private _attack: number = 0.1;
  private _release: number = 1.0;

  get attack() { return this._attack; }
  set attack(val: number) { this._attack = val; this.setEnvelope({ attack: val }); }

  get release() { return this._release; }
  set release(val: number) { this._release = val; this.setEnvelope({ release: val }); }
  
  private currentEnvelope: ADSREnvelopeSettings = {
    attack: 0.1,
    decay: 0.2,
    sustain: 0.5,
    release: 1.0
  };

  constructor() {}

  async initialize() {
    if (this.isInitialized) return;

    try {
      await Tone.start();
      console.log('Tone.js Audio Context started successfully.');

      // 1. Create the Master Chain
      this.limiter = new Tone.Limiter(-2).toDestination();

      this.reverb = new Tone.Reverb({
        decay: 4.5,
        wet: this.reverbAmount
      });
      this.reverb.connect(this.limiter);

      this.filter = new Tone.Filter({
        type: 'lowpass',
        frequency: 2000,
        rolloff: -24,
        Q: 1.5 // Resonance
      });
      this.filter.connect(this.reverb);

      // 2. Create the Master Channel
      this.masterChannel = new Tone.Channel({
        volume: this.masterVolume
      });
      this.masterChannel.connect(this.filter);

      this.isInitialized = true;
    } catch (e) {
      console.error('Failed to start Tone.js audio context', e);
    }
  }

  setVolume(db: number) {
    if (!this.isInitialized) return;
    this.masterChannel.volume.rampTo(db, 0.1);
  }

  setReverb(wet: number) {
    if (!this.isInitialized) return;
    this.reverb.wet.value = wet;
  }

  // Get frequency based on row index and current scale
  private getFreqForGrid(row: number, _col: number): number {
    const scale = Scales[this.currentScaleName];
    // Map the row (0-9) to the scale array, wrapping around if needed
    const index = row % scale.length;
    return scale[index];
  }

  setEnvelope(envelopeSettings: ADSREnvelopeSettings) {
    this.currentEnvelope = { ...this.currentEnvelope, ...envelopeSettings };
    if (!this.isInitialized) return;
    for (const synth of this.synths.values()) {
      synth.set({ envelope: this.currentEnvelope });
    }
  }

  private getOrCreateSynth(key: string): Tone.FMSynth {
    if (this.synths.has(key)) {
      return this.synths.get(key)!;
    }

    const synth = new Tone.FMSynth({
      oscillator: { type: 'sine' },
      envelope: this.currentEnvelope as Tone.EnvelopeOptions,
      modulation: { type: 'square' },
      modulationEnvelope: {
        attack: 0.1,
        decay: 0.2,
        sustain: 0.2,
        release: 0.5
      },
      harmonicity: 1.5,
      modulationIndex: 2
    });
    synth.connect(this.masterChannel);
    this.synths.set(key, synth);
    return synth;
  }

  // Called every frame with data from the SpatialAnalyzer
  update(spatialData: SpatialData) {
    if (!this.isInitialized) return;

    // Modulate global filter based on flock speed
    // Faster flock = brighter sound
    const targetCutoff = Tone.Frequency(400 + (spatialData.flockSpeed * 1000)).toFrequency();
    // Smooth the filter change
    this.filter.frequency.rampTo(targetCutoff as number, 0.1);

    const now = Tone.now();
    const activeCells = new Set<string>();
    const cellsToDrone = new Set<string>();

    // Process each grid cell's relationship to the flock
    for (const [key, data] of Object.entries(spatialData.cells)) {
      if (data.active) {
        activeCells.add(key);
      }

      const [rStr, cStr] = key.split(',');
      const row = parseInt(rStr);
      const col = parseInt(cStr);
      const freq = this.getFreqForGrid(row, col);

      if (this.mode === 'trigger') {
        this.handleTriggerMode(key, data, freq, now);
      } else if (this.mode === 'drone') {
        if (data.active && data.distanceToCentroid < this.droneRadius * 1.5) {
          cellsToDrone.add(key);
          this.handleDroneMode(key, freq, data, now);
        }
      }
    }

    if (this.mode === 'drone') {
      this.cleanupDrones(cellsToDrone, now);
    }

    // Cleanup synths for cells that are no longer active to save memory
    this.cleanupInactiveSynths(activeCells, now);
  }

  private handleTriggerMode(key: string, data: { active: boolean, density: number }, freq: number, now: number) {
    if (!data.active) return;

    if (data.density >= this.triggerDensityThreshold) {
      const lastTrigger = this.lastTriggerTime[key] || 0;

      // Prevent triggering the exact same cell faster than 250ms
      if (now - lastTrigger > 0.25) {
        // Calculate velocity (0.0 to 1.0) based on how far past the threshold the density is
        const excess = data.density - this.triggerDensityThreshold;
        const velocity = Math.min(0.3 + (excess * 0.1), 1.0);

        // Pluck the note
        const synth = this.getOrCreateSynth(key);
        synth.triggerAttackRelease(freq, "8n", now, velocity);
        this.lastTriggerTime[key] = now;
      }
    }
  }

  private handleDroneMode(key: string, freq: number, data: { distanceToCentroid: number }, now: number) {
    const synth = this.getOrCreateSynth(key);

    // Start note if it's not already droning
    if (!this.activeDroneNotes.has(key)) {
      // Start quietly, we'll modulate it using presence
      synth.volume.value = -Infinity;
      synth.triggerAttack(freq, now);
      this.activeDroneNotes.add(key);
    }

    // Map distance to a "velocity" or presence value (0.0 to 1.0)
    let presence = 1.0 - (data.distanceToCentroid / this.droneRadius);
    presence = Math.max(0, Math.min(1, presence));

    // Modulate the specific synth
    synth.modulationIndex.value = 1 + (presence * 5);
    
    // Also modulate volume for distance effect. 0 presence = -60dB, 1 presence = 0dB (relative to synth)
    const db = presence > 0.01 ? 20 * Math.log10(presence) : -60;
    synth.volume.rampTo(db, 0.1);
  }

  private cleanupDrones(cellsToDrone: Set<string>, now: number) {
    // Release any notes that are no longer close enough to the centroid
    for (const key of Array.from(this.activeDroneNotes)) {
      if (!cellsToDrone.has(key)) {
        const synth = this.synths.get(key);
        if (synth) {
          synth.triggerRelease(now);
        }
        this.activeDroneNotes.delete(key);
      }
    }
  }

  private cleanupInactiveSynths(activeCells: Set<string>, now: number) {
    for (const [key, synth] of Array.from(this.synths.entries())) {
      if (!activeCells.has(key)) {
        // Only dispose if it's not currently droning, just to be safe
        if (!this.activeDroneNotes.has(key)) {
          synth.triggerRelease(now);
          // Give it some time to release before disposing
          setTimeout(() => {
            synth.dispose();
          }, (this.currentEnvelope.release || 1.0) * 1000 + 500);
          this.synths.delete(key);
        }
      }
    }
  }
}

export const audioEngine = new AudioEngine();
