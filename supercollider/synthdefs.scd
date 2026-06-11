/*
  synthdefs.scd — canonical Murmuration SynthDef bodies.

  Evaluates to an Array of SynthDef objects. Consumers:
    - murmuration.scd        (sandbox)        → calls .add on each
    - compile-synthdefs.scd  (bundled blobs)  → calls .writeDefFile(dir) on each

  Edit SynthDefs here. Both consumers will pick up the change on their next run.
*/

(
[
  // FM Drone — sustained tone with ASR envelope and variable modulation index.
  // thunderBus: control bus added to modIndex each frame, so a thunder strike
  // causes a transient burst of extra FM complexity.
  SynthDef(\murmurDrone, {
    | out = 0, freq = 440, amp = 0.15, modIndex = 1, gate = 1, thunderBus = 0,
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
  }),

  // FM Pluck — short percussive note, frees itself after the decay.
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
  }),

  // Thunder — broadband impact with complex reverberation.
  // Four layers (crack, body rumble, sub pressure, diffuse tail) feed six prime-
  // ratio comb delays into an allpass diffusion chain. Amplitude envelope is
  // written (scaled) to thunderBus so drones/FX read it as cross-modulation.
  // NOTE: writes audio to `out` so it's audible in the sandbox; in the bundled
  // path you can route it through murmurFX's bus instead.
  SynthDef(\murmurThunder, {
    | out = 0, thunderBus = 0, modScale = 6 |
    var strike  = PinkNoise.ar * EnvGen.kr(Env.perc(0.001, 0.08), doneAction: Done.none);
    var rumble  = PinkNoise.ar * EnvGen.kr(Env.perc(0.05, 4.5, curve: -3), doneAction: Done.none);
    var tail    = BrownNoise.ar * EnvGen.kr(Env.perc(0.3, 8.0, curve: -4), doneAction: Done.none) * 0.3;
    var sub     = SinOsc.ar(XLine.kr(60, 15, 0.8, doneAction: Done.none))
                    * EnvGen.kr(Env.perc(0.01, 2.5), doneAction: Done.none);
    var sig     = (strike * 0.6) + (rumble * 0.7) + (tail * 0.5) + (sub * 0.4);
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
  }),

  // FX Chain — RLPF (animated by flock speed) → multitap delay → reverb → limiter.
  // Persistent, runs on the FX bus and writes to hardware out 0. Thunder
  // amplitude opens the filter and swells the reverb mix.
  SynthDef(\murmurFX, {
    | in = 0, out = 0, filterFreq = 1000, rq = 0.7, reverbMix = 0.6, reverbRoom = 0.8,
      thunderBus = 0, thunderFilterAmt = 3000, thunderReverbAmt = 0.3,
      delayMix = 0.3, delayFeedback = 0.4, delayTime = 0.375 |
    var sig         = In.ar(in, 2);
    var thunderMod  = In.kr(thunderBus);
    var modFreq     = (filterFreq + (thunderMod * thunderFilterAmt)).clip(20, 18000);
    var modReverb   = (reverbMix + (thunderMod * thunderReverbAmt)).clip(0, 1);
    var taps, fb;

    sig = RLPF.ar(sig, modFreq.lag(0.05), rq.lag(0.1));

    fb = LocalIn.ar(2) * delayFeedback;
    taps =
      DelayC.ar(sig + fb, 2.0, delayTime * 1)    * 0.8 +
      DelayC.ar(sig + fb, 2.0, delayTime * 0.75) * 0.5 +
      DelayC.ar(sig + fb, 2.0, delayTime * 0.5)  * 0.6 +
      DelayC.ar(sig + fb, 2.0, delayTime * 1.5)  * 0.3;
    taps = LPF.ar(taps, 3500);
    LocalOut.ar(taps);
    sig = (sig * (1 - delayMix)) + (taps * delayMix);

    sig = FreeVerb2.ar(sig[0], sig[1], modReverb, reverbRoom, 0.5);
    sig = Limiter.ar(sig, 0.95);
    Out.ar(out, sig);
  }),
]
)
