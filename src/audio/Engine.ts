import * as Tone from 'tone';

export interface ADSREnvelopeSettings {
  attack?: number;
  decay?: number;
  sustain?: number;
  release?: number;
}

export class AudioEngine {
  isInitialized = false;

  constructor() {
    // We don't initialize audio immediately; we must wait for a user gesture.
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Must be called as a direct result of a user click/gesture
      await Tone.start();
      console.log('Tone.js Audio Context started successfully.');
      
      // Future setup: create synths, routing, and effects here.
      // e.g., this.synth = new Tone.PolySynth().toDestination();
      
      this.isInitialized = true;
    } catch (e) {
      console.error('Failed to start Tone.js audio context', e);
    }
  }

  // Placeholder for future use
  playNote(_note: string) {
    if (!this.isInitialized) return;
    // this.synth.triggerAttackRelease(_note, "8n");
  }
}

// Export a singleton instance
export const audioEngine = new AudioEngine();
