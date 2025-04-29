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
  MOUSE_SENSITIVITY: 0.0035
};

export const WeaponConfig = {
  SHOOT_CD_MS: 200,
  BULLET_SPEED: 40,
  BULLET_TTL_MS: 5000,
  BULLET_SPAWN_DISTANCE: 1.5
};

export const PhysicsConfig = {
  IMPACT_FORCE: 20.0,
  SOLVER_ITERATIONS: 4,     // More iterations for better stability
  CCD_SUBSTEPS: 4,          // Increase CCD substeps for better bullet collisions
  VELOCITY_THRESHOLD: 30.0  // Velocity magnitude threshold for enabling CCD
};

export const TimeStepConfig = {
  FIXED_DT: 1/60,          // 60Hz physics update
  MAX_STEPS: 5,            // Max physics steps per frame to prevent spiral of death
  MAX_FRAME_TIME: 0.25,    // Maximum time to spend catching up
  MIN_DT: 1/240            // Minimum sensible delta (240Hz)
};

export const SceneConfig = {
  // Ground
  GROUND_COLOR: 0x1a5f2a,
  GROUND_SIZE: 200,
  
  // Sky
  SKY_COLOR: 0x87CEEB,
  
  // Cubes
  CUBE_STACK_SIZE: 6,
  EXTRA_CUBES: 20,
  CUBE_RESTITUTION: 0.4,
  CUBE_FRICTION: 0.5,
  
  // Lighting
  AMBIENT_LIGHT_INTENSITY: 0.8,
  DIRECTIONAL_LIGHT_INTENSITY: 1.0
};

// Movement state enum values
export const MovementState = {
  GROUNDED: 0,
  JUMPING: 1,
  FALLING: 2
}; 