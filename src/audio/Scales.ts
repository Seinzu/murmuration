export type Scale = number[];

// Helper to calculate standard equal temperament frequencies given a starting MIDI note number
// A4 is MIDI note 69, 440Hz
function getFreq(midiNote: number): number {
  return 440 * Math.pow(2, (midiNote - 69) / 12);
}

function generateScale(rootMidi: number, intervals: number[], numOctaves: number = 3): Scale {
  const scale: number[] = [];
  let currentMidi = rootMidi;

  for (let oct = 0; oct < numOctaves; oct++) {
    for (let i = 0; i < intervals.length; i++) {
      scale.push(getFreq(currentMidi));
      currentMidi += intervals[i];
    }
  }
  return scale;
}

const ROOT = 48;

export const Scales = {
  'Minor Pentatonic': generateScale(ROOT, [3, 2, 2, 3, 2], 4),

  'Major Pentatonic': generateScale(ROOT, [2, 2, 3, 2, 3], 4),

  'Harmonic Minor': generateScale(ROOT, [2, 1, 2, 2, 1, 3, 1], 3),

  'Whole Tone': generateScale(ROOT, [2, 2, 2, 2, 2, 2], 3),

  // --- Microtonal / Non-Western Examples ---

  // Just Intonation (Based on pure harmonic ratios from a root of 261.63Hz - C4)
  // Ratios: 1/1, 9/8, 5/4, 4/3, 3/2, 5/3, 15/8, 2/1
  'Just Intonation': [
    130.81 * (1/1), 130.81 * (9/8), 130.81 * (5/4), 130.81 * (4/3), 130.81 * (3/2), 130.81 * (5/3), 130.81 * (15/8),
    261.63 * (1/1), 261.63 * (9/8), 261.63 * (5/4), 261.63 * (4/3), 261.63 * (3/2), 261.63 * (5/3), 261.63 * (15/8),
    523.25 * (1/1), 523.25 * (9/8), 523.25 * (5/4), 523.25 * (4/3), 523.25 * (3/2), 523.25 * (5/3), 523.25 * (15/8)
  ],

  // Bohlen-Pierce (Does not use octaves, uses the tritave ratio 3:1)
  // Highly alien and mathematical sounding
  'Bohlen-Pierce': [
    220.0, 239.3, 260.3, 283.1, 308.0, 335.0, 364.4, 396.4, 431.2, 469.1, 510.3, 555.1, 603.8, // Tritave 1
    660.0, 717.8, 780.8, 849.2, 923.8, 1004.9, 1093.1, 1189.1, 1293.6, 1407.2, 1530.9, 1665.4, 1811.4 // Tritave 2
  ]
};

export type ScaleName = keyof typeof Scales;
