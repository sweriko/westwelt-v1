/**
 * Global configuration values
 */

export const PlayerConfig = {
  // Movement
  WALK_SPEED: 8,
  SPRINT_FACTOR: 1.8,
  AIR_CONTROL: 0.7,
  JUMP_VEL: 14,
  GRAVITY: 20,
  TERMINAL_FALL: -20,

  // Timing
  JUMP_CD_MS: 300,
  COYOTE_MS: 150,
  JUMP_BUFFER_MS: 200,

  // Look
  MOUSE_SENSITIVITY: 0.0035,

  // Health
  MAX_HEALTH: 100
};

export const WeaponConfig = {
  // SHOOT_CD_MS removed - server now controls this
  BULLET_SPEED: 40,
  BULLET_TTL_MS: 5000, // Used for visual effect lifetime
  BULLET_SPAWN_DISTANCE: 1.5,
  // Added example damage values (server should determine actual damage)
  DAMAGE_BODY: 30,
  DAMAGE_HEAD: 100,
  DAMAGE_LIMB: 15
};

export const PhysicsConfig = {
  IMPACT_FORCE: 20.0,
  SOLVER_ITERATIONS: 4,
  CCD_SUBSTEPS: 4,
  VELOCITY_THRESHOLD: 30.0
};

export const TimeStepConfig = {
  FIXED_DT: 1/60,
  MAX_STEPS: 5,
  MAX_FRAME_TIME: 0.25,
  MIN_DT: 1/240
};

export const SceneConfig = {
  GROUND_COLOR: 0x1a5f2a,
  GROUND_SIZE: 200,
  SKY_COLOR: 0x87CEEB,
  CUBE_STACK_SIZE: 6,
  EXTRA_CUBES: 20,
  CUBE_RESTITUTION: 0.4,
  CUBE_FRICTION: 0.5,
  AMBIENT_LIGHT_INTENSITY: 0.8,
  DIRECTIONAL_LIGHT_INTENSITY: 1.0
};

// Movement state enum values
export const MovementState = {
  GROUNDED: 0,
  JUMPING: 1,
  FALLING: 2
};

// Animation state enum values (Example)
export const PlayerAnimationState = {
  IDLE: 0,
  WALKING: 1,
  RUNNING: 2,
  JUMPING: 3,
  FALLING: 4,
  SHOOTING: 5, // Added
  AIMING: 6,   // Added
  DEATH: 7     // Added
};

// Network configuration
export const NetworkConfig = {
    SERVER_URL: `ws://${window.location.hostname}:8080`, // Adjust hostname/port if needed
    UPDATE_INTERVAL_MS: 50, // Send local player updates 20 times per second
    INTERPOLATION_DELAY_MS: 100, // Delay applied to remote player interpolation
    PING_INTERVAL_MS: 5000 // Send ping every 5 seconds
};