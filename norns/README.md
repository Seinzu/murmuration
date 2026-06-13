# Murmuration for norns

This repo contains the norns version of Murmuration: a small 3D boids simulation with grid-controlled cells, arc-controlled synthesis parameters, and a Crone SuperCollider engine.

Grid is essential, arc is supported.

## Maiden / Project Manager Install

Installing this whole repository with maiden's `;install <github-url>` is possible.

## Manual Install

Copy the contents of this `norns` directory to:

```text
/home/we/dust/code/murmuration-norns
```

The installed tree should look like:

```text
/home/we/dust/code/murmuration-norns/murmuration.lua
/home/we/dust/code/murmuration-norns/lib/boids.lua
/home/we/dust/code/murmuration-norns/lib/Engine_Murmuration.sc
```

The Lua script uses project-relative includes.

## Controls

- `E1`: boid count
- `E2`: separation weight
- `E3`: cohesion weight
- `K2`: thunder strike
- `K3`: toggle drone/trigger audio mode
- `grid`: toggle active cells
- `arc`: adjust attack, release, filter multiplier, and resonance
- `arc key`: reset the encoder's mapped parameter to its default
- `16n`: optional USB MIDI control over CC32-47

Active grid cells are both audio zones and obstacle points for the flock. In drone mode, selected nearby boids excite voices using stable per-boid scale pitches; distance still controls level and modulation depth.

## Parameters

The script exposes params for flock weights, scale, audio mode, drone radius, trigger density, maximum drone count, output level, synth levels, envelope, FX, and obstacle avoidance. `max drones` defaults to 12 to keep the boid-pitched voice load modest on norns. `voice dedupe` defaults to `by pitch`, and `voice gain` defaults to `sqrt` compensation so larger voice counts do not jump as sharply in level. `output level` defaults to 0.6 to leave headroom on hardware.

## Sound Test

The `sound test` params are opt-in and default to `off`. They replace the live flock with deterministic boid positions and add a temporary audition cell at `test row` / `test col` without changing the saved grid state.

- `fixed`: places a compact flock at `test distance` from the audition cell, useful for checking drone presence and distance response.
- `sweep`: moves the flock around the audition cell at `test distance`, useful for hearing transitions.
- `dense`: packs the flock onto the audition cell, useful for trigger-mode density testing.

Set `test scene` back to `off` to return to normal flocking.

## 16n

16n support is optional and uses USB MIDI. `16n midi` defaults to `auto`, which listens across norns MIDI ports and should work as soon as the 16n is connected. If you need to avoid another controller or troubleshoot a setup, set `16n midi` to `manual`, set `16n port` to the MIDI device number shown by norns, and leave `16n channel` at 1 for the default 16n configuration.

Default 16n firmware sends faders 1-16 as MIDI CC32-47 on channel 1. Murmuration maps them as:

```text
1  output level        9  reverb mix
2  drone level         10 reverb room
3  trigger level       11 thunder filter
4  thunder level       12 thunder reverb
5  attack              13 modulation minimum
6  release             14 modulation depth
7  filter              15 drone radius
8  resonance           16 max drones
```

The most recently changed 16n or arc parameter is shown in the top-right of the norns screen for a few seconds, with its current value.

## Smoke Test

1. Launch `MURMURATION` from the norns script selector.
2. Confirm the screen redraws without an error and moving boids appear.
3. Toggle a few grid cells and confirm LEDs match the selected cells.
4. In drone mode, confirm nearby active cells fade drones in and out.
5. Press `K3` to switch to trigger mode; any held drones should release.
6. Press `K2` and confirm the thunder sound plays and the flock scatters.
7. Turn each arc encoder and confirm sound changes and the arc ring redraws.
8. Set `test scene` to `fixed`, `sweep`, and `dense`, then back to `off`; normal flocking should resume.
9. If using 16n, connect it over USB and confirm faders update params. If not, set `16n midi` to `manual` and choose the `16n port`.

## Notes

The norns engine keeps a lighter FX chain than the desktop SuperCollider synthdefs. The desktop version's multitap delay is omitted here to reduce CPU pressure.
