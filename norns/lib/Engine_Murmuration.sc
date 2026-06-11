// Engine_Murmuration
// CroneEngine for Norns — FM drone/trigger synthesis driven by boid simulation.
// Ported from supercollider/murmuration.scd

Engine_Murmuration : CroneEngine {

  var <fxBus, <thunderBus;
  var <srcGroup, <fxGroup;
  var <fxSynth;
  var <droneSynths;
  var <filterMul, <droneAttack, <droneRelease;

  *new { arg context, doneCallback;
    ^super.new(context, doneCallback);
  }

  alloc {

    fxBus      = Bus.audio(context.server, 2);
    thunderBus = Bus.control(context.server, 1);

    // ─── SynthDefs ───────────────────────────────────────────────────────

    SynthDef(\murmurDrone, {
      | out = 0, freq = 440, amp = 0.15, modIndex = 2.0, gate = 1, thunderBus = 0,
        attackTime = 0.3, releaseTime = 2.1 |
      var modFreq    = freq * 1.5;
      var thunderMod = In.kr(thunderBus);
      var modSig     = SinOsc.ar(modFreq) * ((modIndex + thunderMod) * freq);
      var carrier    = SinOsc.ar(freq + modSig);
      var env        = EnvGen.kr(
        Env.asr(attackTime: attackTime, sustainLevel: 1.4, releaseTime: releaseTime),
        gate,
        doneAction: Done.freeSelf
      );
      Out.ar(out, (carrier * env * amp).dup);
    }).add;

    SynthDef(\murmurTrigger, {
      | out = 0, freq = 440, amp = 0.4 |
      var modFreq = freq * 1.5;
      var modSig  = SinOsc.ar(modFreq) * (2 * freq);
      var carrier = SinOsc.ar(freq + modSig);
      var env     = EnvGen.kr(
        Env.perc(attackTime: 0.01, releaseTime: 0.5, level: 1, curve: -4),
        doneAction: Done.freeSelf
      );
      Out.ar(out, (carrier * env * amp).dup);
    }).add;

    SynthDef(\murmurThunder, {
      | out = 0, thunderBus = 0, modScale = 6 |
      var strike   = PinkNoise.ar * EnvGen.kr(Env.perc(0.001, 0.08), doneAction: Done.none);
      var rumble   = PinkNoise.ar * EnvGen.kr(Env.perc(0.05, 4.5, curve: -3), doneAction: Done.none);
      var tail     = BrownNoise.ar * EnvGen.kr(Env.perc(0.3, 8.0, curve: -4), doneAction: Done.none) * 0.3;
      var sub      = SinOsc.ar(XLine.kr(60, 15, 0.8, doneAction: Done.none))
                       * EnvGen.kr(Env.perc(0.01, 2.5), doneAction: Done.none);
      var sig      = (strike * 0.6) + (rumble * 0.7) + (tail * 0.5) + (sub * 0.4);
      var combs, diffused, stereo, amp;
      combs =
        CombC.ar(sig, 0.5, 0.1297 + SinOsc.kr(0.07, 0, 0.002), 5.2, 0.18) +
        CombC.ar(sig, 0.5, 0.1823 + SinOsc.kr(0.11, 0.5, 0.002), 6.1, 0.15) +
        CombL.ar(sig, 0.5, 0.2371 + SinOsc.kr(0.05, 1.0, 0.003), 7.0, 0.13) +
        CombL.ar(sig, 0.5, 0.3109 + SinOsc.kr(0.09, 1.5, 0.002), 5.8, 0.12) +
        CombC.ar(sig, 0.5, 0.3947 + SinOsc.kr(0.13, 2.0, 0.003), 4.5, 0.10) +
        CombL.ar(sig, 0.5, 0.4507 + SinOsc.kr(0.06, 0.3, 0.002), 3.5, 0.08);
      diffused = AllpassC.ar(combs, 0.1, 0.0473, 2.5);
      diffused = AllpassC.ar(diffused, 0.1, 0.0711, 3.2);
      diffused = AllpassC.ar(diffused, 0.1, 0.0891, 2.8);
      diffused = AllpassC.ar(diffused, 0.1, 0.0317, 3.6);
      sig = sig + (diffused * 0.45);
      sig = LPF.ar(sig, 1800);
      sig = LPF.ar(sig, 900 + EnvGen.kr(Env.perc(0.001, 3.0), doneAction: Done.none) * 800);
      stereo = sig.dup * 0.3;
      amp = Amplitude.kr(stereo[0], attackTime: 0.001, releaseTime: 1.0);
      Out.kr(thunderBus, amp * modScale);
      DetectSilence.ar(stereo[0], amp: 0.0005, time: 1.0, doneAction: Done.freeSelf);
      Out.ar(out, stereo);
    }).add;

    SynthDef(\murmurFX, {
      | in = 0, out = 0, filterFreq = 1000, rq = 0.7, reverbMix = 0.6, reverbRoom = 0.8,
        thunderBus = 0, thunderFilterAmt = 3000, thunderReverbAmt = 0.3 |
      var sig         = In.ar(in, 2);
      var thunderMod  = In.kr(thunderBus);
      var modFreq     = (filterFreq + (thunderMod * thunderFilterAmt)).clip(20, 18000);
      var modReverb   = (reverbMix + (thunderMod * thunderReverbAmt)).clip(0, 1);
      sig = RLPF.ar(sig, modFreq.lag(0.05), rq.lag(0.1));
      sig = FreeVerb2.ar(sig[0], sig[1], modReverb, reverbRoom, 0.5);
      sig = Limiter.ar(sig, 0.95);
      Out.ar(out, sig);
    }).add;

    context.server.sync;

    // ─── Node Order ──────────────────────────────────────────────────────
    srcGroup = Group.new(context.server, \addToHead);
    fxGroup  = Group.new(context.server, \addToTail);

    fxSynth = Synth(\murmurFX, [
      \in,               fxBus,
      \out,              context.out_b,
      \filterFreq,       1000,
      \reverbMix,        0.6,
      \reverbRoom,       0.8,
      \thunderBus,       thunderBus,
      \thunderFilterAmt, 3000,
      \thunderReverbAmt, 0.3
    ], fxGroup);

    droneSynths  = Dictionary.new;
    filterMul    = 1.0;
    droneAttack  = 0.3;
    droneRelease = 2.1;

    // ─── Commands ────────────────────────────────────────────────────────

    this.addCommand("drone_on", "iifff", { arg msg;
      var row      = msg[1];
      var col      = msg[2];
      var freq     = msg[3];
      var presence = msg[4];
      var modIndex = msg[5];
      var key      = "%,%".format(row, col);

      if (droneSynths[key].isNil) {
        droneSynths[key] = Synth(\murmurDrone, [
          \out,         fxBus,
          \freq,        freq,
          \amp,         (presence * 0.2).max(0.01),
          \modIndex,    modIndex,
          \gate,        1,
          \thunderBus,  thunderBus,
          \attackTime,  droneAttack,
          \releaseTime, droneRelease
        ], srcGroup);
      };
    });

    this.addCommand("drone_update", "iiff", { arg msg;
      var row      = msg[1];
      var col      = msg[2];
      var presence = msg[3];
      var modIndex = msg[4];
      var key      = "%,%".format(row, col);

      droneSynths[key] !? { | synth |
        synth.set(
          \amp,      (presence * 0.2).max(0),
          \modIndex, modIndex
        );
      };
    });

    this.addCommand("drone_off", "ii", { arg msg;
      var row = msg[1];
      var col = msg[2];
      var key = "%,%".format(row, col);

      droneSynths[key] !? { | synth |
        synth.set(\gate, 0);
        droneSynths.removeAt(key);
      };
    });

    this.addCommand("trigger", "iiff", { arg msg;
      var row      = msg[1];
      var col      = msg[2];
      var freq     = msg[3];
      var velocity = msg[4];

      Synth(\murmurTrigger, [
        \out,  fxBus,
        \freq, freq,
        \amp,  velocity * 0.4
      ], srcGroup);
    });

    this.addCommand("flock_speed", "f", { arg msg;
      var speed      = msg[1];
      var filterFreq = (400 + (speed * 1000)) * filterMul;
      fxSynth.set(\filterFreq, filterFreq);
    });

    this.addCommand("thunder", "", { arg msg;
      Synth(\murmurThunder, [
        \out,        fxBus,
        \thunderBus, thunderBus,
        \modScale,   10
      ], srcGroup);
    });

    this.addCommand("attack_time", "f", { arg msg;
      droneAttack = msg[1];
      droneSynths.do { | synth | synth.set(\attackTime, droneAttack) };
    });

    this.addCommand("release_time", "f", { arg msg;
      droneRelease = msg[1];
      droneSynths.do { | synth | synth.set(\releaseTime, droneRelease) };
    });

    this.addCommand("filter_mul", "f", { arg msg;
      filterMul = msg[1];
    });

    this.addCommand("resonance", "f", { arg msg;
      fxSynth.set(\rq, msg[1]);
    });

    this.addCommand("reverb_mix", "f", { arg msg;
      fxSynth.set(\reverbMix, msg[1]);
    });

    this.addCommand("reverb_room", "f", { arg msg;
      fxSynth.set(\reverbRoom, msg[1]);
    });

    this.addCommand("thunder_filter_amt", "f", { arg msg;
      fxSynth.set(\thunderFilterAmt, msg[1]);
    });

    this.addCommand("thunder_reverb_amt", "f", { arg msg;
      fxSynth.set(\thunderReverbAmt, msg[1]);
    });
  }

  free {
    droneSynths.do { | synth | synth.free };
    fxSynth.free;
    fxBus.free;
    thunderBus.free;
    srcGroup.free;
    fxGroup.free;
  }
}
