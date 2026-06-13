-- murmuration
-- boid flocking simulation
-- for norns + grid + arc
--
-- E1: number of boids
-- E2: separation weight
-- E3: cohesion weight
-- K2: trigger thunder
-- K3: toggle audio mode
--
-- grid: toggle obstacle cells
-- arc: control synth params

engine.name = "Murmuration"

local Boids = include("lib/boids")

-------------------------------------------------
-- scales (minor pentatonic, matching web version)
-------------------------------------------------

local function midi_to_freq(note)
  return 440 * math.pow(2, (note - 69) / 12)
end

local function generate_scale(root, intervals, octaves)
  local scale = {}
  local current = root
  for _ = 1, octaves do
    for _, int in ipairs(intervals) do
      table.insert(scale, midi_to_freq(current))
      current = current + int
    end
  end
  return scale
end

local scales = {
  { name = "Minor Pentatonic", freqs = generate_scale(48, {3, 2, 2, 3, 2}, 4) },
  { name = "Major Pentatonic", freqs = generate_scale(48, {2, 2, 3, 2, 3}, 4) },
  { name = "Harmonic Minor",   freqs = generate_scale(48, {2, 1, 2, 2, 1, 3, 1}, 3) },
  { name = "Whole Tone",       freqs = generate_scale(48, {2, 2, 2, 2, 2, 2}, 3) },
}

-------------------------------------------------
-- state
-------------------------------------------------

local flock
local grid_device
local arc_device
local sim_metro
local redraw_metro

local GRID_ROWS = 8
local GRID_COLS = 16
local CELL_SIZE = 5
local grid_cells = {}

local audio_mode = 1 -- 1=drone, 2=trigger
local active_drones = {}
local last_trigger_time = {}
local current_scale_idx = 1
local max_drones = 12
local voice_dedupe = 2 -- 1=off, 2=by exact pitch
local voice_gain_comp = 2 -- 1=off, 2=sqrt
local sound_test_scene = 1 -- 1=off, 2=fixed, 3=sweep, 4=dense
local sound_test_row = 4
local sound_test_col = 8
local sound_test_distance = 20
local sound_test_spread = 4
local sound_test_speed = 0.4
local sound_test_phase = 0
local sound_test_names = {"off", "fixed", "sweep", "dense"}

local SIM_BOUNDS = 40 -- simulation space radius

-- arc encoder param mappings
local arc_params = {
  { id = "attack_time",  label = "attack",    min = 0.01, max = 2.0, default = 0.3 },
  { id = "release_time", label = "release",   min = 0.1,  max = 5.0, default = 2.1 },
  { id = "filter_mul",   label = "filter",    min = 0.25, max = 4.0, default = 1.0 },
  { id = "resonance",    label = "resonance", min = 0.1,  max = 1.0, default = 0.7 },
}
local arc_values = {} -- normalised 0-1

-------------------------------------------------
-- config
-------------------------------------------------

local thunder_intensity = 0
local THUNDER_DECAY = 0.97
local base_separation_weight = 1.5
local base_cohesion_weight = 1.0
local DEFAULT_OUTPUT_LEVEL = 0.6
local DEFAULT_DRONE_LEVEL = 0.12
local DEFAULT_TRIGGER_LEVEL = 0.25
local DEFAULT_THUNDER_LEVEL = 0.2
local DEFAULT_DRONE_MOD_MIN = 1.0
local DEFAULT_DRONE_MOD_DEPTH = 5.0
local drone_mod_min = DEFAULT_DRONE_MOD_MIN
local drone_mod_depth = DEFAULT_DRONE_MOD_DEPTH

local midi_16n_devices = {}
local midi_16n_mode = 2 -- 1=off, 2=auto, 3=manual
local midi_16n_port = 1
local midi_16n_channel = 1

local overlay_label = nil
local overlay_value = nil
local overlay_until = 0
local OVERLAY_DURATION = 6

local config = {
  max_speed             = 0.8,
  max_force             = 0.05,
  separation_distance   = 5.0,
  alignment_distance    = 15.0,
  cohesion_distance     = 15.0,
  separation_weight     = 1.5,
  alignment_weight      = 1.0,
  cohesion_weight       = 1.0,
  containment_radius    = SIM_BOUNDS,
  containment_weight    = 2.0,
  obstacle_avoidance_weight = 5.0,
  obstacle_look_ahead       = 7.5,
  obstacle_radius           = 4.0,
}

-------------------------------------------------
-- 16n MIDI mapping
-------------------------------------------------

local fader_16n_mappings = {
  { label = "output level",        cc = 32, param = "output_level",       min = 0,    max = 1 },
  { label = "drone level",         cc = 33, param = "drone_level",        min = 0,    max = 0.25 },
  { label = "trigger level",       cc = 34, param = "trigger_level",      min = 0,    max = 0.5 },
  { label = "thunder level",       cc = 35, param = "thunder_level",      min = 0,    max = 0.4 },
  { label = "attack",              cc = 36, param = "attack_time",        min = 0.01, max = 2 },
  { label = "release",             cc = 37, param = "release_time",       min = 0.1,  max = 5 },
  { label = "filter",              cc = 38, param = "filter_mul",         min = 0.25, max = 4 },
  { label = "resonance",           cc = 39, param = "resonance",          min = 0.1,  max = 1 },
  { label = "reverb mix",          cc = 40, param = "reverb_mix",         min = 0,    max = 1 },
  { label = "reverb room",         cc = 41, param = "reverb_room",        min = 0,    max = 1 },
  { label = "thunder filter",      cc = 42, param = "thunder_filter_amt", min = 0,    max = 6000 },
  { label = "thunder reverb",      cc = 43, param = "thunder_reverb_amt", min = 0,    max = 0.5 },
  { label = "mod min",             cc = 44, param = "drone_mod_min",      min = 0.2,  max = 4 },
  { label = "mod depth",           cc = 45, param = "drone_mod_depth",    min = 0,    max = 10 },
  { label = "drone radius",        cc = 46, param = "drone_radius",       min = 10,   max = 150 },
  { label = "max drones",          cc = 47, param = "max_drones",         min = 1,    max = 48, integer = true },
}

local function show_param_overlay(label, value, integer)
  overlay_label = label
  if type(value) == "number" then
    if integer then
      overlay_value = string.format("%d", value)
    elseif math.abs(value) >= 100 then
      overlay_value = string.format("%.0f", value)
    elseif math.abs(value) >= 10 then
      overlay_value = string.format("%.1f", value)
    else
      overlay_value = string.format("%.2f", value)
    end
  else
    overlay_value = tostring(value)
  end
  overlay_until = util.time() + OVERLAY_DURATION
end

local function handle_16n_midi(data)
  if midi_16n_mode == 1 then return end

  local msg = midi.to_msg(data)
  if msg.type ~= "cc" or msg.ch ~= midi_16n_channel then return end

  for _, mapping in ipairs(fader_16n_mappings) do
    if msg.cc == mapping.cc then
      local normalized = util.clamp(msg.val / 127, 0, 1)
      local value = mapping.min + normalized * (mapping.max - mapping.min)
      if mapping.integer then
        value = math.floor(value + 0.5)
      end
      params:set(mapping.param, value)
      show_param_overlay(mapping.label, value, mapping.integer)
      return
    end
  end
end

local function connect_16n_midi()
  for _, device in ipairs(midi_16n_devices) do
    device.event = nil
  end
  midi_16n_devices = {}

  if midi_16n_mode == 1 then return end

  local first_port = midi_16n_mode == 2 and 1 or midi_16n_port
  local last_port = midi_16n_mode == 2 and 16 or midi_16n_port

  for port = first_port, last_port do
    local ok, device = pcall(midi.connect, port)
    if ok and device then
      device.event = handle_16n_midi
      table.insert(midi_16n_devices, device)
    end
  end
end

local function draw_param_overlay()
  if overlay_label == nil then return end

  if util.time() >= overlay_until then
    overlay_label = nil
    overlay_value = nil
    return
  end

  screen.level(0)
  screen.rect(62, 0, 66, 19)
  screen.fill()
  screen.level(15)
  screen.move(126, 8)
  screen.text_right(overlay_label)
  screen.level(10)
  screen.move(126, 17)
  screen.text_right(overlay_value)
end

-------------------------------------------------
-- grid spatial helpers
-------------------------------------------------

local function cell_position(r, c)
  local x = (c - GRID_COLS / 2 - 0.5) * CELL_SIZE
  local y = (r - GRID_ROWS / 2 - 0.5) * CELL_SIZE
  return Boids.vec3(x, y, 0)
end

local function active_cell_positions()
  local positions = {}
  for r = 1, GRID_ROWS do
    for c = 1, GRID_COLS do
      if grid_cells[r][c] then
        table.insert(positions, cell_position(r, c))
      end
    end
  end
  return positions
end

local function sound_test_active()
  return sound_test_scene ~= 1
end

local function is_audio_cell_active(r, c)
  return grid_cells[r][c] or
    (sound_test_active() and r == sound_test_row and c == sound_test_col)
end

local function all_drones_off()
  for key, voice in pairs(active_drones) do
    engine.drone_off(voice.engine_row, voice.engine_col)
    active_drones[key] = nil
  end
end

local function apply_sound_test_scene(delta)
  if not sound_test_active() then return end

  sound_test_phase = sound_test_phase + delta * math.max(sound_test_speed, 0.01)

  local target = cell_position(sound_test_row, sound_test_col)
  local distance = sound_test_distance
  local spread = sound_test_spread
  local center = Boids.vec3(target.x + distance, target.y, target.z)

  if sound_test_scene == 3 then -- sweep
    local angle = sound_test_phase * math.pi * 2
    center = Boids.vec3(
      target.x + math.cos(angle) * distance,
      target.y + math.sin(angle) * distance,
      target.z
    )
  elseif sound_test_scene == 4 then -- dense
    center = target
    spread = math.min(spread, 3)
  end

  for i, boid in ipairs(flock.boids) do
    local angle = i * 2.399963229728653
    local radius = spread * math.sqrt((i - 0.5) / math.max(#flock.boids, 1))
    boid.position = Boids.vec3(
      center.x + math.cos(angle) * radius,
      center.y + math.sin(angle) * radius,
      center.z + ((i % 5) - 2) * spread * 0.15
    )
    boid.velocity = Boids.vec3(sound_test_speed, 0, 0)
    boid.acceleration = Boids.vec3(0, 0, 0)
  end
end

-------------------------------------------------
-- projection: 3D -> screen (128x64)
-------------------------------------------------

local SCREEN_W = 128
local SCREEN_H = 64
local CAM_DIST = 100 -- camera distance from origin

local function project(pos)
  -- simple perspective projection along Z axis
  local d = CAM_DIST - pos.z
  if d < 1 then d = 1 end
  local scale = CAM_DIST / d
  local sx = SCREEN_W / 2 + pos.x * scale
  local sy = SCREEN_H / 2 - pos.y * scale
  -- brightness based on depth: closer = brighter
  local depth_norm = util.clamp((pos.z + SIM_BOUNDS) / (2 * SIM_BOUNDS), 0, 1)
  local brightness = math.floor(2 + depth_norm * 13) -- range 2-15
  return sx, sy, brightness
end

-------------------------------------------------
-- audio helpers
-------------------------------------------------

local function get_freq(row)
  local s = scales[current_scale_idx].freqs
  return s[((row - 1) % #s) + 1]
end

local function get_boid_pitch_index(boid)
  local s = scales[current_scale_idx].freqs
  return ((boid.pitch_index or 1) - 1) % #s + 1
end

local function get_boid_freq(boid)
  local s = scales[current_scale_idx].freqs
  return s[get_boid_pitch_index(boid)]
end

local function drone_key(r, c)
  return r .. "," .. c
end

local function update_audio()
  local avg_speed = flock:avg_speed()

  engine.flock_speed(avg_speed)

  local drone_radius = params:get("drone_radius")
  local trigger_threshold = params:get("trigger_threshold")
  local density_radius_sq = 15 * 15

  local candidates = {}
  local active_voice_keys = {}
  local active_voice_count = 0
  local active_cells = {}

  for r = 1, GRID_ROWS do
    for c = 1, GRID_COLS do
      local key = drone_key(r, c)
      local is_active = is_audio_cell_active(r, c)

      if is_active then
        local cell_pos = cell_position(r, c)
        table.insert(active_cells, { r = r, c = c, pos = cell_pos })

        local freq = get_freq(r)

        if audio_mode == 2 then -- trigger
          local density = 0
          for _, boid in ipairs(flock.boids) do
            if Boids.v_dist_sq(boid.position, cell_pos) < density_radius_sq then
              density = density + 1
            end
          end
          if density >= trigger_threshold then
            local now = util.time()
            local last = last_trigger_time[key] or 0
            if now - last >= 0.25 then
              local velocity = math.min(0.3 + (density - trigger_threshold) * 0.1, 1.0)
              engine.trigger(r, c, freq, velocity)
              last_trigger_time[key] = now
            end
          end
        end
      end
    end
  end

  if audio_mode == 1 then
    for boid_index, boid in ipairs(flock.boids) do
      local nearest = nil
      local nearest_dist_sq = nil

      for _, cell in ipairs(active_cells) do
        local dist_sq = Boids.v_dist_sq(boid.position, cell.pos)
        if nearest == nil or dist_sq < nearest_dist_sq then
          nearest = cell
          nearest_dist_sq = dist_sq
        end
      end

      if nearest and nearest_dist_sq < drone_radius * drone_radius then
        local dist = math.sqrt(nearest_dist_sq)
        local presence = math.max(0, math.min(1, 1.0 - dist / drone_radius))
        local pitch_index = get_boid_pitch_index(boid)
        table.insert(candidates, {
          key = tostring(boid_index),
          boid_index = boid_index,
          engine_row = boid_index,
          engine_col = 0,
          r = nearest.r,
          c = nearest.c,
          freq = get_boid_freq(boid),
          pitch_index = pitch_index,
          dist = dist,
          presence = presence,
        })
      end
    end

    table.sort(candidates, function(a, b) return a.presence > b.presence end)

    if voice_dedupe == 2 then
      local used_pitches = {}
      local deduped = {}
      for _, candidate in ipairs(candidates) do
        if not used_pitches[candidate.pitch_index] then
          table.insert(deduped, candidate)
          used_pitches[candidate.pitch_index] = true
        end
      end
      candidates = deduped
    end

    active_voice_count = math.min(#candidates, max_drones)
    local gain_scale = 1
    if voice_gain_comp == 2 and active_voice_count > 1 then
      gain_scale = 1 / math.sqrt(active_voice_count)
    end

    for i = 1, active_voice_count do
      local candidate = candidates[i]
      local raw_presence = candidate.presence
      local voice_presence = raw_presence * gain_scale
      local mod_index = drone_mod_min + raw_presence * drone_mod_depth
      active_voice_keys[candidate.key] = true

      if not active_drones[candidate.key] then
        engine.drone_on(candidate.engine_row, candidate.engine_col, candidate.freq, voice_presence, mod_index)
        active_drones[candidate.key] = {
          engine_row = candidate.engine_row,
          engine_col = candidate.engine_col,
          freq = candidate.freq,
          presence = voice_presence,
        }
      elseif active_drones[candidate.key].freq ~= candidate.freq then
        engine.drone_off(candidate.engine_row, candidate.engine_col)
        engine.drone_on(candidate.engine_row, candidate.engine_col, candidate.freq, voice_presence, mod_index)
        active_drones[candidate.key].freq = candidate.freq
        active_drones[candidate.key].presence = voice_presence
      else
        engine.drone_update(candidate.engine_row, candidate.engine_col, voice_presence, mod_index)
        active_drones[candidate.key].presence = voice_presence
      end
    end
  else
    all_drones_off()
  end

  -- cleanup drones not in active set
  if audio_mode == 1 then
    for key, voice in pairs(active_drones) do
      if not active_voice_keys[key] then
        engine.drone_off(voice.engine_row, voice.engine_col)
        active_drones[key] = nil
      end
    end
  end
end

-------------------------------------------------
-- grid
-------------------------------------------------

local function grid_redraw()
  if grid_device == nil then return end
  for r = 1, GRID_ROWS do
    for c = 1, GRID_COLS do
      grid_device:led(c, r, grid_cells[r][c] and 7 or 0)
    end
  end
  grid_device:refresh()
end

local function grid_key(x, y, z)
  if z == 1 then
    grid_cells[y][x] = not grid_cells[y][x]
    grid_redraw()
  end
end

-------------------------------------------------
-- arc
-------------------------------------------------

local function arc_redraw()
  if arc_device == nil then return end
  for n = 1, 4 do
    local leds = {}
    local lit = math.floor(arc_values[n] * 63)
    for i = 1, 64 do
      if i <= lit + 1 then
        leds[i] = (i == lit + 1) and 12 or 8
      else
        leds[i] = 0
      end
    end
    arc_device:segment(n, 0, arc_values[n] * math.pi * 2, 10)
    -- Use led-based approach
    for i = 1, 64 do
      arc_device:led(n, i, leds[i])
    end
  end
  arc_device:refresh()
end

local function arc_delta(n, d)
  if n < 1 or n > 4 then return end
  arc_values[n] = util.clamp(arc_values[n] + d / 800, 0, 1)
  local p = arc_params[n]
  local mapped = p.min + arc_values[n] * (p.max - p.min)
  engine[p.id](mapped)
  show_param_overlay(p.label, mapped)
  arc_redraw()
end

local function arc_key(n, z)
  if z == 1 and n >= 1 and n <= 4 then
    local p = arc_params[n]
    arc_values[n] = (p.default - p.min) / (p.max - p.min)
    engine[p.id](p.default)
    show_param_overlay(p.label, p.default)
    arc_redraw()
  end
end

-------------------------------------------------
-- norns callbacks
-------------------------------------------------

function init()
  -- init grid state
  for r = 1, GRID_ROWS do
    grid_cells[r] = {}
    for c = 1, GRID_COLS do
      grid_cells[r][c] = false
    end
  end

  -- init arc values
  for i = 1, 4 do
    local p = arc_params[i]
    arc_values[i] = (p.default - p.min) / (p.max - p.min)
  end

  -- params
  params:add_separator("murmuration")

  params:add_number("boid_count", "boid count", 5, 50, 35)
  params:set_action("boid_count", function(v)
    if flock then flock:set_count(v) end
  end)

  params:add_control("separation_weight", "separation", controlspec.new(0, 5, "lin", 0.1, 1.5))
  params:set_action("separation_weight", function(v) base_separation_weight = v; config.separation_weight = v end)

  params:add_control("alignment_weight", "alignment", controlspec.new(0, 5, "lin", 0.1, 1.0))
  params:set_action("alignment_weight", function(v) config.alignment_weight = v end)

  params:add_control("cohesion_weight", "cohesion", controlspec.new(0, 5, "lin", 0.1, 1.0))
  params:set_action("cohesion_weight", function(v) base_cohesion_weight = v; config.cohesion_weight = v end)

  params:add_control("containment_weight", "containment", controlspec.new(0, 5, "lin", 0.1, 2.0))
  params:set_action("containment_weight", function(v) config.containment_weight = v end)

  params:add_option("audio_mode", "audio mode", {"drone", "trigger"}, 1)
  params:set_action("audio_mode", function(v)
    if audio_mode == 1 and v ~= 1 then
      all_drones_off()
    end
    audio_mode = v
  end)

  params:add_option("scale", "scale", {"Minor Pent", "Major Pent", "Harm Minor", "Whole Tone"}, 1)
  params:set_action("scale", function(v)
    current_scale_idx = v
    all_drones_off()
  end)

  params:add_number("drone_radius", "drone radius", 10, 150, 50)
  params:add_number("trigger_threshold", "trigger density", 1, 10, 3)
  params:add_number("max_drones", "max drones", 1, 48, max_drones)
  params:set_action("max_drones", function(v) max_drones = v end)

  params:add_option("voice_dedupe", "voice dedupe", {"off", "by pitch"}, voice_dedupe)
  params:set_action("voice_dedupe", function(v)
    voice_dedupe = v
    all_drones_off()
  end)

  params:add_option("voice_gain_comp", "voice gain", {"off", "sqrt"}, voice_gain_comp)
  params:set_action("voice_gain_comp", function(v) voice_gain_comp = v end)

  params:add_control("output_level", "output level", controlspec.new(0, 1, "lin", 0.01, DEFAULT_OUTPUT_LEVEL))
  params:set_action("output_level", function(v) engine.output_level(v) end)

  params:add_control("drone_level", "drone level", controlspec.new(0, 0.25, "lin", 0.001, DEFAULT_DRONE_LEVEL))
  params:set_action("drone_level", function(v) engine.drone_level(v) end)

  params:add_control("trigger_level", "trigger level", controlspec.new(0, 0.5, "lin", 0.001, DEFAULT_TRIGGER_LEVEL))
  params:set_action("trigger_level", function(v) engine.trigger_level(v) end)

  params:add_control("thunder_level", "thunder level", controlspec.new(0, 0.4, "lin", 0.001, DEFAULT_THUNDER_LEVEL))
  params:set_action("thunder_level", function(v) engine.thunder_level(v) end)

  params:add_control("attack_time", "attack", controlspec.new(0.01, 2, "lin", 0.01, 0.3))
  params:set_action("attack_time", function(v) engine.attack_time(v) end)

  params:add_control("release_time", "release", controlspec.new(0.1, 5, "lin", 0.01, 2.1))
  params:set_action("release_time", function(v) engine.release_time(v) end)

  params:add_control("filter_mul", "filter", controlspec.new(0.25, 4, "lin", 0.01, 1.0))
  params:set_action("filter_mul", function(v) engine.filter_mul(v) end)

  params:add_control("resonance", "resonance", controlspec.new(0.1, 1, "lin", 0.01, 0.7))
  params:set_action("resonance", function(v) engine.resonance(v) end)

  params:add_control("reverb_mix", "reverb mix", controlspec.new(0, 1, "lin", 0.01, 0.6))
  params:set_action("reverb_mix", function(v) engine.reverb_mix(v) end)

  params:add_control("reverb_room", "reverb room", controlspec.new(0, 1, "lin", 0.01, 0.8))
  params:set_action("reverb_room", function(v) engine.reverb_room(v) end)

  params:add_control("thunder_filter_amt", "thunder filter", controlspec.new(0, 6000, "lin", 10, 3000))
  params:set_action("thunder_filter_amt", function(v) engine.thunder_filter_amt(v) end)

  params:add_control("thunder_reverb_amt", "thunder reverb", controlspec.new(0, 0.5, "lin", 0.01, 0.3))
  params:set_action("thunder_reverb_amt", function(v) engine.thunder_reverb_amt(v) end)

  params:add_control("drone_mod_min", "mod min", controlspec.new(0.2, 4, "lin", 0.01, DEFAULT_DRONE_MOD_MIN))
  params:set_action("drone_mod_min", function(v) drone_mod_min = v end)

  params:add_control("drone_mod_depth", "mod depth", controlspec.new(0, 10, "lin", 0.01, DEFAULT_DRONE_MOD_DEPTH))
  params:set_action("drone_mod_depth", function(v) drone_mod_depth = v end)

  params:add_control("obstacle_avoidance_weight", "avoidance", controlspec.new(0, 15, "lin", 0.5, 5.0))
  params:set_action("obstacle_avoidance_weight", function(v) config.obstacle_avoidance_weight = v end)

  params:add_control("obstacle_look_ahead", "look ahead", controlspec.new(2, 20, "lin", 0.5, 7.5))
  params:set_action("obstacle_look_ahead", function(v) config.obstacle_look_ahead = v end)

  params:add_separator("sound test")
  params:add_option("sound_test_scene", "test scene", {"off", "fixed", "sweep", "dense"}, sound_test_scene)
  params:set_action("sound_test_scene", function(v)
    if sound_test_scene ~= v then
      all_drones_off()
    end
    sound_test_scene = v
  end)

  params:add_number("sound_test_row", "test row", 1, GRID_ROWS, sound_test_row)
  params:set_action("sound_test_row", function(v)
    if sound_test_active() and sound_test_row ~= v then all_drones_off() end
    sound_test_row = v
  end)

  params:add_number("sound_test_col", "test col", 1, GRID_COLS, sound_test_col)
  params:set_action("sound_test_col", function(v)
    if sound_test_active() and sound_test_col ~= v then all_drones_off() end
    sound_test_col = v
  end)

  params:add_control("sound_test_distance", "test distance", controlspec.new(0, 120, "lin", 1, sound_test_distance))
  params:set_action("sound_test_distance", function(v) sound_test_distance = v end)

  params:add_control("sound_test_spread", "test spread", controlspec.new(0, 30, "lin", 1, sound_test_spread))
  params:set_action("sound_test_spread", function(v) sound_test_spread = v end)

  params:add_control("sound_test_speed", "test speed", controlspec.new(0, 2, "lin", 0.01, sound_test_speed))
  params:set_action("sound_test_speed", function(v) sound_test_speed = v end)

  params:add_separator("16n")
  params:add_option("16n_mode", "16n midi", {"off", "auto", "manual"}, midi_16n_mode)
  params:set_action("16n_mode", function(v)
    midi_16n_mode = v
    connect_16n_midi()
  end)

  params:add_number("16n_port", "16n port", 1, 16, midi_16n_port)
  params:set_action("16n_port", function(v)
    midi_16n_port = v
    connect_16n_midi()
  end)

  params:add_number("16n_channel", "16n channel", 1, 16, midi_16n_channel)
  params:set_action("16n_channel", function(v) midi_16n_channel = v end)

  -- create flock
  flock = Boids.Flock.new(params:get("boid_count"), config)

  connect_16n_midi()

  -- connect devices
  grid_device = grid.connect()
  grid_device.key = grid_key
  grid_redraw()

  arc_device = arc.connect()
  arc_device.delta = arc_delta
  arc_device.key = arc_key
  arc_redraw()

  -- simulation at 15fps
  sim_metro = metro.init()
  sim_metro.time = 1 / 15
  sim_metro.event = function()
    -- thunder decay and boid scatter
    thunder_intensity = thunder_intensity * THUNDER_DECAY
    if thunder_intensity < 0.001 then thunder_intensity = 0 end
    config.separation_weight = base_separation_weight + thunder_intensity * 8
    config.cohesion_weight = base_cohesion_weight * (1 - thunder_intensity * 0.8)

    if sound_test_active() then
      apply_sound_test_scene(1 / 15)
    else
      flock:update(1 / 15, active_cell_positions())
    end
    update_audio()
  end
  sim_metro:start()

  -- screen at 15fps
  redraw_metro = metro.init()
  redraw_metro.time = 1 / 15
  redraw_metro.event = function()
    redraw()
  end
  redraw_metro:start()
end

function cleanup()
  if sim_metro then sim_metro:stop() end
  if redraw_metro then redraw_metro:stop() end
  all_drones_off()
end

function redraw()
  screen.clear()

  -- draw grid obstacles
  screen.level(3)
  for r = 1, GRID_ROWS do
    for c = 1, GRID_COLS do
      if grid_cells[r][c] or (sound_test_active() and r == sound_test_row and c == sound_test_col) then
        local sx, sy = project(cell_position(r, c))
        screen.level(grid_cells[r][c] and 3 or 8)
        screen.rect(sx - 2, sy - 2, 4, 4)
        screen.fill()
      end
    end
  end

  -- draw boids: pixel with brightness from Z-depth
  for _, boid in ipairs(flock.boids) do
    local sx, sy, brightness = project(boid.position)
    if sx >= 0 and sx < SCREEN_W and sy >= 0 and sy < SCREEN_H then
      screen.level(brightness)
      -- draw a tiny line in velocity direction for orientation
      local vn = Boids.v_mul(Boids.v_normalize(boid.velocity), 1.5)
      local ex, ey = project(Boids.v_add(boid.position, vn))
      screen.move(sx, sy)
      screen.line(ex, ey)
      screen.stroke()
    end
  end

  -- draw centroid
  local cent = flock:centroid()
  local cx, cy, cb = project(cent)
  screen.level(math.floor(cb * 0.5))
  screen.circle(cx, cy, 2)
  screen.stroke()

  -- info text
  screen.level(15)
  screen.move(2, 8)
  screen.text("boids: " .. #flock.boids)
  screen.move(2, 62)
  screen.text(audio_mode == 1 and "drone" or "trigger")
  if sound_test_active() then
    screen.move(2, 18)
    screen.text("test: " .. sound_test_names[sound_test_scene])
  end

  draw_param_overlay()

  screen.update()
end

function enc(n, d)
  if n == 1 then
    params:delta("boid_count", d)
  elseif n == 2 then
    params:delta("separation_weight", d)
  elseif n == 3 then
    params:delta("cohesion_weight", d)
  end
end

function key(n, z)
  if z == 1 then
    if n == 2 then
      engine.thunder()
      thunder_intensity = 1.0
    elseif n == 3 then
      local mode = params:get("audio_mode")
      params:set("audio_mode", mode == 1 and 2 or 1)
    end
  end
end
