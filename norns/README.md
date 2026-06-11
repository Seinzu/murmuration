# Murmuration for norns

This folder contains the norns version of Murmuration: a small 3D boids simulation with grid-controlled cells, arc-controlled synthesis parameters, and a Crone SuperCollider engine.

## Install

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

## Maiden / Project Manager Install

Installing this whole repository with maiden's `;install <github-url>` command is not currently enough, because maiden installs the repository root into `/home/we/dust/code/<repo-name>`. In this monorepo, the norns entrypoint is nested at `norns/murmuration.lua`, while norns expects the runnable script and `lib` folder at the installed project root.

For direct maiden git install support, publish the contents of this folder as a norns-only repository. This source repository includes Copybara configuration intended to mirror this folder into a separate `murmuration-norns` repository whose root contains `murmuration.lua` and `lib/`.

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

The script exposes params for flock weights, scale, audio mode, drone radius, trigger density, maximum drone count, output level, and obstacle avoidance. `max drones` defaults to 24 to keep the engine load modest on norns. `output level` defaults to 0.6 to leave headroom on hardware.

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
