/*
  murmuration.scd — SC IDE sandbox for SynthDef sketching.

  This file is NOT loaded at runtime. The Tauri app (src-tauri/src/audio.rs)
  spawns scsynth directly and loads compiled .scsyndef blobs produced by
  `npm run synthdefs:compile` (which runs supercollider/compile-synthdefs.scd).

  Workflow:
    1. Boot the server here (evaluate `s.boot` below).
    2. Edit a SynthDef in supercollider/synthdefs.scd.
    3. Re-evaluate the "load" block below — all SynthDefs are re-added to the
       server. New synth instances pick up the new defs.
    4. Audition with the Synth(...) snippets at the bottom.
    5. When happy, run `npm run synthdefs:compile` to regenerate the bundled
       .scsyndef. Restart the Tauri app to pick them up.

  Note: this sandbox routes synths straight to hardware out (bus 0). The
  production murmurFX chain (filter + multitap delay + reverb + thunder
  cross-mod) is only audible after promoting to the bundled path.
*/

s.boot;

// ─── Load canonical SynthDefs ──────────────────────────────────────────────
// Re-evaluate this block after editing synthdefs.scd to push changes to scsynth.

(
var defs = thisProcess.interpreter.executeFile(
  thisProcess.nowExecutingPath.dirname +/+ "synthdefs.scd"
);
defs.do { | def | def.add };
("Added " ++ defs.size ++ " synthdefs to " ++ s.name).postln;
)

// ─── Audition (select a line and Cmd+Return) ───────────────────────────────

// Single drone:
//   x = Synth(\murmurDrone, [\freq, 220, \amp, 0.2, \modIndex, 1.5]);
//   x.set(\modIndex, 4);
//   x.set(\gate, 0);   // release

// Pluck:
//   Synth(\murmurTrigger, [\freq, 440, \amp, 0.5]);

// Thunder (writes to a control bus — make one if you want to hear the cross-mod):
//   ~tb = Bus.control(s, 1);
//   Synth(\murmurThunder, [\thunderBus, ~tb, \modScale, 10]);
