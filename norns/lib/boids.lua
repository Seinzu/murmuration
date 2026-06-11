-- boids.lua
-- 3D boids flocking simulation for Norns
-- Ported from the TypeScript implementation

local Boids = {}

-------------------------------------------------
-- vec3 helpers
-------------------------------------------------

local function vec3(x, y, z)
  return { x = x or 0, y = y or 0, z = z or 0 }
end

local function v_add(a, b)
  return vec3(a.x + b.x, a.y + b.y, a.z + b.z)
end

local function v_sub(a, b)
  return vec3(a.x - b.x, a.y - b.y, a.z - b.z)
end

local function v_mul(a, s)
  return vec3(a.x * s, a.y * s, a.z * s)
end

local function v_div(a, s)
  if s == 0 then return vec3(0, 0, 0) end
  return vec3(a.x / s, a.y / s, a.z / s)
end

local function v_len(a)
  return math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
end

local function v_len_sq(a)
  return a.x * a.x + a.y * a.y + a.z * a.z
end

local function v_dist_sq(a, b)
  local dx, dy, dz = a.x - b.x, a.y - b.y, a.z - b.z
  return dx * dx + dy * dy + dz * dz
end

local function v_normalize(a)
  local l = v_len(a)
  if l == 0 then return vec3(0, 0, 0) end
  return vec3(a.x / l, a.y / l, a.z / l)
end

local function v_limit(a, max)
  if v_len(a) > max then
    return v_mul(v_normalize(a), max)
  end
  return a
end

-- Mutating add (for accumulation)
local function v_acc(a, b)
  a.x = a.x + b.x
  a.y = a.y + b.y
  a.z = a.z + b.z
end

Boids.vec3 = vec3
Boids.v_add = v_add
Boids.v_sub = v_sub
Boids.v_mul = v_mul
Boids.v_len = v_len
Boids.v_dist_sq = v_dist_sq
Boids.v_normalize = v_normalize

-------------------------------------------------
-- Boid
-------------------------------------------------

local Boid = {}
Boid.__index = Boid

function Boid.new(x, y, z)
  local self = setmetatable({}, Boid)
  self.position = vec3(x, y, z)
  local vx = (math.random() - 0.5) * 2
  local vy = (math.random() - 0.5) * 2
  local vz = (math.random() - 0.5) * 2
  self.velocity = v_mul(v_normalize(vec3(vx, vy, vz)), math.random() * 2 + 1)
  self.acceleration = vec3(0, 0, 0)
  return self
end

function Boid:apply_force(force)
  v_acc(self.acceleration, force)
end

function Boid:update(config, delta)
  v_acc(self.velocity, self.acceleration)
  self.velocity = v_limit(self.velocity, config.max_speed)
  local dv = v_mul(self.velocity, delta * 60)
  v_acc(self.position, dv)
  self.acceleration = vec3(0, 0, 0)
end

function Boid:seek(target, config)
  local desired = v_sub(target, self.position)
  desired = v_mul(v_normalize(desired), config.max_speed)
  local steer = v_sub(desired, self.velocity)
  return v_limit(steer, config.max_force)
end

function Boid:separate(boids, config)
  local steer = vec3(0, 0, 0)
  local count = 0
  local sep_sq = config.separation_distance * config.separation_distance

  for _, other in ipairs(boids) do
    if other ~= self then
      local d = v_dist_sq(self.position, other.position)
      if d > 0 and d < sep_sq then
        local diff = v_sub(self.position, other.position)
        diff = v_normalize(diff)
        diff = v_div(diff, math.sqrt(d))
        v_acc(steer, diff)
        count = count + 1
      end
    end
  end

  if count > 0 then
    steer = v_div(steer, count)
  end

  if v_len(steer) > 0 then
    steer = v_mul(v_normalize(steer), config.max_speed)
    steer = v_sub(steer, self.velocity)
    steer = v_limit(steer, config.max_force)
  end

  return steer
end

function Boid:align(boids, config)
  local sum = vec3(0, 0, 0)
  local count = 0
  local ali_sq = config.alignment_distance * config.alignment_distance

  for _, other in ipairs(boids) do
    if other ~= self then
      local d = v_dist_sq(self.position, other.position)
      if d > 0 and d < ali_sq then
        v_acc(sum, other.velocity)
        count = count + 1
      end
    end
  end

  if count > 0 then
    sum = v_div(sum, count)
    sum = v_mul(v_normalize(sum), config.max_speed)
    local steer = v_sub(sum, self.velocity)
    return v_limit(steer, config.max_force)
  end

  return vec3(0, 0, 0)
end

function Boid:cohere(boids, config)
  local sum = vec3(0, 0, 0)
  local count = 0
  local coh_sq = config.cohesion_distance * config.cohesion_distance

  for _, other in ipairs(boids) do
    if other ~= self then
      local d = v_dist_sq(self.position, other.position)
      if d > 0 and d < coh_sq then
        v_acc(sum, other.position)
        count = count + 1
      end
    end
  end

  if count > 0 then
    sum = v_div(sum, count)
    return self:seek(sum, config)
  end

  return vec3(0, 0, 0)
end

function Boid:contain(config)
  local dist = v_len(self.position)
  if dist > config.containment_radius then
    return self:seek(vec3(0, 0, 0), config)
  end
  return vec3(0, 0, 0)
end

function Boid:avoid_obstacles(obstacles, config)
  local steer = vec3(0, 0, 0)
  local count = 0

  local ahead = v_mul(v_normalize(self.velocity), config.obstacle_look_ahead)
  local feeler = v_add(self.position, ahead)
  local radius_sq = config.obstacle_radius * config.obstacle_radius

  for _, obstacle in ipairs(obstacles or {}) do
    local d = v_dist_sq(feeler, obstacle)
    if d < radius_sq then
      local diff = v_sub(self.position, obstacle)
      diff = v_normalize(diff)
      diff = v_div(diff, math.sqrt(d) + 0.1)
      v_acc(steer, diff)
      count = count + 1
    end
  end

  if count > 0 then
    steer = v_div(steer, count)
    steer = v_mul(v_normalize(steer), config.max_speed)
    steer = v_sub(steer, self.velocity)
    steer = v_limit(steer, config.max_force * 2)
  end

  return steer
end

Boids.Boid = Boid

-------------------------------------------------
-- Flock
-------------------------------------------------

local Flock = {}
Flock.__index = Flock

function Flock.new(count, config)
  local self = setmetatable({}, Flock)
  self.boids = {}
  self.config = config
  self:set_count(count)
  return self
end

function Flock:set_count(n)
  while #self.boids < n do
    local r = math.random() * 30
    local theta = math.random() * 2 * math.pi
    local phi = math.acos(2 * math.random() - 1)
    local x = r * math.sin(phi) * math.cos(theta)
    local y = r * math.sin(phi) * math.sin(theta)
    local z = r * math.cos(phi)
    table.insert(self.boids, Boid.new(x, y, z))
  end
  while #self.boids > n do
    table.remove(self.boids)
  end
end

function Flock:update(delta, obstacles)
  local cfg = self.config
  for _, boid in ipairs(self.boids) do
    local sep = v_mul(boid:separate(self.boids, cfg), cfg.separation_weight)
    local ali = v_mul(boid:align(self.boids, cfg), cfg.alignment_weight)
    local coh = v_mul(boid:cohere(self.boids, cfg), cfg.cohesion_weight)
    local cont = v_mul(boid:contain(cfg), cfg.containment_weight)
    local avoid = v_mul(boid:avoid_obstacles(obstacles, cfg), cfg.obstacle_avoidance_weight)

    boid:apply_force(sep)
    boid:apply_force(ali)
    boid:apply_force(coh)
    boid:apply_force(cont)
    boid:apply_force(avoid)

    boid:update(cfg, delta)
  end
end

function Flock:centroid()
  local cx, cy, cz = 0, 0, 0
  local n = #self.boids
  if n == 0 then return vec3(0, 0, 0) end
  for _, b in ipairs(self.boids) do
    cx = cx + b.position.x
    cy = cy + b.position.y
    cz = cz + b.position.z
  end
  return vec3(cx / n, cy / n, cz / n)
end

function Flock:avg_speed()
  local total = 0
  for _, b in ipairs(self.boids) do
    total = total + v_len(b.velocity)
  end
  if #self.boids == 0 then return 0 end
  return total / #self.boids
end

Boids.Flock = Flock

return Boids
