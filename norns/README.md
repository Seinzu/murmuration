# Murmuration for norns

This folder contains the norns version of Murmuration: a small 3D boids simulation with grid-controlled cells, arc-controlled synthesis parameters, and a Crone SuperCollider engine.

## Install

Copy the contents of this `norns` directory to:

```text
/home/we/dust/code/murmuration
```

The installed tree should look like:

```text
/home/we/dust/code/murmuration/murmuration.lua
/home/we/dust/code/murmuration/lib/boids.lua
/home/we/dust/code/murmuration/lib/Engine_Murmuration.sc
```

The Lua script uses `include("murmuration/lib/boids")`, so the containing folder must be named `murmuration`.

## Controls

- `E1`: boid count
- `E2`: separation weight
- `E3`: cohesion weight
- `K2`: thunder strike
- `K3`: toggle drone/trigger audio mode
- `grid`: toggle active cells
- `arc`: adjust attack, release, filter multiplier, and resonance
- `arc key`: reset the encoder's mapped parameter to its default

Active grid cells are both audio zones and obstacle points for the flock.

## Parameters

The script exposes params for flock weights, scale, audio mode, drone radius, trigger density, maximum drone count, and obstacle avoidance. `max drones` defaults to 24 to keep the engine load modest on norns.

## Smoke Test

1. Launch `MURMURATION` from the norns script selector.
2. Confirm the screen redraws without an error and moving boids appear.
3. Toggle a few grid cells and confirm LEDs match the selected cells.
4. In drone mode, confirm nearby active cells fade drones in and out.
5. Press `K3` to switch to trigger mode; any held drones should release.
6. Press `K2` and confirm the thunder sound plays and the flock scatters.
7. Turn each arc encoder and confirm sound changes and the arc ring redraws.

## Notes

The norns engine keeps a lighter FX chain than the desktop SuperCollider synthdefs. The desktop version's multitap delay is omitted here to reduce CPU pressure.
