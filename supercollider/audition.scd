/*
  audition.scd -- direct SuperCollider audition harness for Murmuration.

  This file is not loaded by the app or norns. Use it in the SuperCollider IDE
  while working on supercollider/synthdefs.scd:

    1. Evaluate the setup block below.
    2. Try the examples at the bottom.
    3. Edit synthdefs.scd and re-evaluate setup to reload the SynthDefs.
    4. When happy, run `npm run synthdefs:compile` for the desktop app.

  The helpers below simulate the same audio inputs used by the norns script:
  drone pitch comes from each boid's stable pitch index, drone presence is based
  on boid distance from active cells, trigger velocity is based on boid density
  around active cells, and flock speed drives the FX filter.
*/

(
s.waitForBoot({
  Routine({
  var defs, here, scriptPath;

  if (~mur.notNil and: { ~mur[\cleanup].notNil }) {
    ~mur[\cleanup].();
  };

  scriptPath = thisProcess.nowExecutingPath;
  if (scriptPath.isNil) {
    Error("Could not find audition.scd path. Open the file in the SuperCollider IDE and evaluate the setup block from there.").throw;
  };

  here = PathName(scriptPath).pathOnly;
  defs = thisProcess.interpreter.executeFile(here +/+ "synthdefs.scd");
  defs.do { |def| def.add };
  s.sync;

  ~mur = ();
  ~mur[\rows] = 8;
  ~mur[\cols] = 16;
  ~mur[\cellSize] = 5;
  ~mur[\maxDrones] = 12;
  ~mur[\droneLevel] = 0.12;
  ~mur[\triggerLevel] = 0.25;
  ~mur[\modMin] = 1.0;
  ~mur[\modDepth] = 5.0;
  ~mur[\filterMul] = 1.0;
  ~mur[\dedupePitches] = true;
  ~mur[\gainComp] = true;
  ~mur[\verbose] = false;
  ~mur[\drones] = Dictionary.new;
  ~mur[\scale] = [130.8128, 155.5635, 174.6141, 195.9977, 233.0819,
    261.6256, 311.1270, 349.2282, 391.9954, 466.1638,
    523.2511, 622.2540, 698.4565, 783.9909, 932.3275,
    1046.5023, 1244.5079, 1396.9129, 1567.9817, 1864.6550];

  ~mur[\fxBus] = Bus.audio(s, 2);
  ~mur[\thunderBus] = Bus.control(s, 1);
  ~mur[\srcGroup] = Group.head(s);
  ~mur[\fxGroup] = Group.after(~mur[\srcGroup]);
  ~mur[\fxSynth] = Synth(\murmurFX, [
    \in, ~mur[\fxBus],
    \out, 0,
    \filterFreq, 1000,
    \rq, 0.7,
    \reverbMix, 0.6,
    \reverbRoom, 0.8,
    \thunderBus, ~mur[\thunderBus],
    \thunderFilterAmt, 3000,
    \thunderReverbAmt, 0.3
  ], ~mur[\fxGroup]);

  ~mur[\cellPosition] = { |row = 4, col = 8|
    [
      (col - (~mur[\cols] / 2) - 0.5) * ~mur[\cellSize],
      (row - (~mur[\rows] / 2) - 0.5) * ~mur[\cellSize],
      0
    ];
  };

  ~mur[\freqForRow] = { |row = 4|
    ~mur[\scale].wrapAt(row - 1);
  };

  ~mur[\pitchIndexForBoid] = { |boidIndex = 0|
    boidIndex % ~mur[\scale].size;
  };

  ~mur[\freqForBoid] = { |boidIndex = 0|
    ~mur[\scale].wrapAt(~mur[\pitchIndexForBoid].(boidIndex));
  };

  ~mur[\distSq] = { |a, b|
    var dx, dy, dz;
    dx = a[0] - b[0];
    dy = a[1] - b[1];
    dz = a[2] - b[2];
    (dx * dx) + (dy * dy) + (dz * dz);
  };

  ~mur[\mag] = { |v|
    ((v[0] * v[0]) + (v[1] * v[1]) + (v[2] * v[2])).sqrt;
  };

  ~mur[\centroid] = { |positions|
    var sum;
    sum = [0, 0, 0];
    if (positions.size == 0) {
      [0, 0, 0];
    } {
      positions.do { |pos|
        sum = [sum[0] + pos[0], sum[1] + pos[1], sum[2] + pos[2]];
      };
      sum / positions.size;
    };
  };

  ~mur[\meanSpeed] = { |velocities|
    var sum;
    sum = 0;
    if (velocities.isNil or: { velocities.size == 0 }) {
      0.4;
    } {
      velocities.do { |vel| sum = sum + ~mur[\mag].(vel) };
      sum / velocities.size;
    };
  };

  ~mur[\releaseKey] = { |key|
    ~mur[\drones].at(key) !? { |synth|
      synth.set(\gate, 0);
      ~mur[\drones].removeAt(key);
    };
  };

  ~mur[\allDronesOff] = {
    ~mur[\drones].keys.copy.do { |key| ~mur[\releaseKey].(key) };
  };

  ~mur[\droneOn] = { |voiceId = 0, freq = 440, presence = 1, modIndex = 2|
    var key, synth;
    key = voiceId.asString;
    synth = ~mur[\drones].at(key);
    if (synth.isNil) {
      ~mur[\drones].put(key, Synth(\murmurDrone, [
        \out, ~mur[\fxBus],
        \freq, freq,
        \amp, (presence * ~mur[\droneLevel]).max(0),
        \modIndex, modIndex,
        \gate, 1,
        \thunderBus, ~mur[\thunderBus]
      ], ~mur[\srcGroup]));
    } {
      synth.set(
        \amp, (presence * ~mur[\droneLevel]).max(0),
        \modIndex, modIndex
      );
    };
  };

  ~mur[\trigger] = { |row = 4, velocity = 1|
    Synth(\murmurTrigger, [
      \out, ~mur[\fxBus],
      \freq, ~mur[\freqForRow].(row),
      \amp, velocity * ~mur[\triggerLevel]
    ], ~mur[\srcGroup]);
  };

  ~mur[\flockSpeed] = { |speed = 0.4|
    ~mur[\fxSynth].set(\filterFreq, (400 + (speed * 1000)) * ~mur[\filterMul]);
  };

  ~mur[\thunder] = {
    Synth(\murmurThunder, [
      \out, ~mur[\fxBus],
      \thunderBus, ~mur[\thunderBus],
      \modScale, 10
    ], ~mur[\srcGroup]);
  };

  ~mur[\applyBoidFrame] = { |positions, cells, mode = \drone, velocities = nil, droneRadius = 50, triggerThreshold = 3|
    var candidates, seen, speed, densityRadiusSq;
    candidates = List.new;
    seen = Set.new;
    speed = ~mur[\meanSpeed].(velocities);
    densityRadiusSq = 15 * 15;

    ~mur[\flockSpeed].(speed);

    if (mode == \drone) {
      positions.do { |pos, boidIndex|
        var nearest, nearestDistSq;
        nearest = nil;
        nearestDistSq = nil;

        cells.do { |cell|
          var cellPos, distSq;
          cellPos = ~mur[\cellPosition].(cell[0], cell[1]);
          distSq = ~mur[\distSq].(pos, cellPos);
          if (nearest.isNil or: { distSq < nearestDistSq }) {
            nearest = cell;
            nearestDistSq = distSq;
          };
        };

        if (nearest.notNil and: { nearestDistSq < (droneRadius * droneRadius) }) {
          var dist, presence, pitchIndex;
          dist = nearestDistSq.sqrt;
          presence = (1.0 - (dist / droneRadius)).clip(0, 1);
          pitchIndex = ~mur[\pitchIndexForBoid].(boidIndex);
          candidates.add((
            key: boidIndex.asString,
            voiceId: boidIndex,
            row: nearest[0],
            col: nearest[1],
            freq: ~mur[\freqForBoid].(boidIndex),
            pitchIndex: pitchIndex,
            dist: dist,
            presence: presence
          ));
        };
      };
    } {
      cells.do { |cell|
        var row, col, cellPos, density, velocity;
        row = cell[0];
        col = cell[1];
        cellPos = ~mur[\cellPosition].(row, col);
        density = 0;
        positions.do { |pos|
          if (~mur[\distSq].(pos, cellPos) < densityRadiusSq) {
            density = density + 1;
          };
        };
        if (density >= triggerThreshold) {
          velocity = (0.3 + ((density - triggerThreshold) * 0.1)).min(1.0);
          ~mur[\trigger].(row, velocity);
          if (~mur[\verbose]) {
            ("trigger row % density % velocity %".format(row, density, velocity.round(0.001))).postln;
          };
        };
      };
    };

    if (mode == \drone) {
      var activeCount, gainScale;
      candidates = candidates.sort({ |a, b| a[\presence] > b[\presence] });

      if (~mur[\dedupePitches]) {
        var usedPitches, deduped;
        usedPitches = Set.new;
        deduped = List.new;
        candidates.do { |candidate|
          if (usedPitches.includes(candidate[\pitchIndex]).not) {
            deduped.add(candidate);
            usedPitches.add(candidate[\pitchIndex]);
          };
        };
        candidates = deduped;
      };

      activeCount = ~mur[\maxDrones].min(candidates.size);
      gainScale = if (~mur[\gainComp] and: { activeCount > 1 }) {
        1 / activeCount.sqrt;
      } {
        1;
      };

      activeCount.do { |i|
        var candidate, rawPresence, voicePresence, modIndex;
        candidate = candidates[i];
        rawPresence = candidate[\presence];
        voicePresence = rawPresence * gainScale;
        modIndex = ~mur[\modMin] + (rawPresence * ~mur[\modDepth]);
        seen.add(candidate[\key]);
        ~mur[\droneOn].(candidate[\voiceId], candidate[\freq], voicePresence, modIndex);
        if (~mur[\verbose]) {
          ("drone row % col % distance % presence % mod %".format(
            candidate[\row],
            candidate[\col],
            candidate[\dist].round(0.01),
            rawPresence.round(0.001),
            modIndex.round(0.001)
          )).postln;
        };
      };

      ~mur[\drones].keys.copy.do { |key|
        if (seen.includes(key).not) {
          ~mur[\releaseKey].(key);
        };
      };
    } {
      ~mur[\allDronesOff].();
    };
  };

  ~mur[\positionsNear] = { |row = 4, col = 8, count = 35, distance = 20, spread = 4|
    var target, center;
    target = ~mur[\cellPosition].(row, col);
    center = [target[0] + distance, target[1], target[2]];
    Array.fill(count, { |i|
      var angle, radius;
      angle = (i + 1) * 2.399963229728653;
      radius = spread * ((i + 0.5) / count.max(1)).sqrt;
      [
        center[0] + (angle.cos * radius),
        center[1] + (angle.sin * radius),
        center[2] + (((i % 5) - 2) * spread * 0.15)
      ];
    });
  };

  ~mur[\fixed] = { |row = 4, col = 8, distance = 20, spread = 4, count = 35, droneRadius = 50, speed = 0.4|
    var positions, velocities;
    positions = ~mur[\positionsNear].(row, col, count, distance, spread);
    velocities = Array.fill(count, { [speed, 0, 0] });
    ~mur[\applyBoidFrame].(positions, [[row, col]], \drone, velocities, droneRadius, 3);
  };

  ~mur[\dense] = { |row = 4, col = 8, count = 12, spread = 3, threshold = 3|
    var positions, velocities;
    positions = ~mur[\positionsNear].(row, col, count, 0, spread);
    velocities = Array.fill(count, { [0.4, 0, 0] });
    ~mur[\applyBoidFrame].(positions, [[row, col]], \trigger, velocities, 50, threshold);
  };

  ~mur[\release] = {
    if (~mur[\sweepTask].notNil) {
      ~mur[\sweepTask].stop;
      ~mur[\sweepTask] = nil;
    };
    ~mur[\allDronesOff].();
  };

  ~mur[\sweepDistance] = { |row = 4, col = 8, near = 0, far = 80, seconds = 8, spread = 4, count = 35, droneRadius = 50|
    var period;
    period = seconds.max(0.1);
    ~mur[\release].();
    ~mur[\sweepTask] = Task({
      var phase, distance;
      phase = 0;
      loop {
        distance = near + (((phase.sin + 1) * 0.5) * (far - near));
        ~mur[\fixed].(row, col, distance, spread, count, droneRadius, 0.4);
        phase = phase + (0.1 / period * 2pi);
        0.1.wait;
      };
    }).play;
  };

  ~mur[\cleanup] = {
    ~mur[\release].();
    ~mur[\fxSynth].free;
    ~mur[\srcGroup].free;
    ~mur[\fxGroup].free;
    ~mur[\fxBus].free;
    ~mur[\thunderBus].free;
  };

  ~murFixed = { |row = 4, col = 8, distance = 20, spread = 4, count = 35, droneRadius = 50, speed = 0.4|
    ~mur[\fixed].(row, col, distance, spread, count, droneRadius, speed);
  };
  ~murSweepDistance = { |row = 4, col = 8, near = 0, far = 80, seconds = 8, spread = 4, count = 35, droneRadius = 50|
    ~mur[\sweepDistance].(row, col, near, far, seconds, spread, count, droneRadius);
  };
  ~murDense = { |row = 4, col = 8, count = 12, spread = 3, threshold = 3|
    ~mur[\dense].(row, col, count, spread, threshold);
  };
  ~murThunder = { ~mur[\thunder].() };
  ~murRelease = { ~mur[\release].() };
  ~murCleanup = { ~mur[\cleanup].() };
  ~murFrame = { |positions, cells, mode = \drone, velocities = nil, droneRadius = 50, triggerThreshold = 3|
    ~mur[\applyBoidFrame].(positions, cells, mode, velocities, droneRadius, triggerThreshold);
  };

  "Murmuration audition ready. Try ~murFixed.(), ~murSweepDistance.(), ~murDense.(), ~murThunder.(), ~murRelease.().".postln;
  }).play;
});
)

// Examples:
// ~murFixed.(4, 8, 0);          // flock centered on the audition cell
// ~murFixed.(4, 8, 25);         // medium drone presence
// ~murFixed.(4, 8, 70);         // edge/far distance, should fade out
// ~murSweepDistance.(4, 8);     // repeatedly sweep distance into/out of range
// ~murDense.(4, 8, 12);         // trigger-mode density test
// ~murThunder.();               // thunder through the same FX bus
// ~mur[\verbose] = true;        // print derived distance/presence/density values
// ~murRelease.();               // stop sweep and release drones
// ~murCleanup.();               // free all audition resources

// Fully explicit boid frame:
// (
// var positions = [[-2, -2, 0], [0, 0, 0], [2, 2, 0], [4, 0, 0]];
// var velocities = [[0.4, 0, 0], [0.3, 0, 0], [0.5, 0, 0], [0.4, 0, 0]];
// ~murFrame.(positions, [[4, 8]], \drone, velocities, 50, 3);
// )
