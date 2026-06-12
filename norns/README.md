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

Active grid cells are both audio zones and obstacle points for the flock.

## Parameters

The script exposes params for flock weights, scale, audio mode, drone radius, trigger density, maximum drone count, output level, synth levels, envelope, FX, and obstacle avoidance. `max drones` defaults to 24 to keep the engine load modest on norns. `output level` defaults to 0.6 to leave headroom on hardware.

## 16n

16n support is optional and uses USB MIDI. Enable `16n midi` in params, set `16n port` to the MIDI device number shown by norns, and leave `16n channel` at 1 for the default 16n configuration.

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
8. If using 16n, enable `16n midi`, set `16n port`, and confirm faders update params.

## Notes

The norns engine keeps a lighter FX chain than the desktop SuperCollider synthdefs. The desktop version's multitap delay is omitted here to reduce CPU pressure.
