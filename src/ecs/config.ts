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
  MAX_HEALTH: 100,

  // Animation thresholds
  FALL_ANIMATION_VELOCITY_THRESHOLD: -5.0,  // Only trigger falling anim when falling fast
  FALL_ANIMATION_TIME_THRESHOLD: 300,       // Must be falling for 300ms before playing fall anim
  ANIMATION_STATE_DEBOUNCE_MS: 150          // Prevent rapid state switching
};

export const WeaponConfig = {
  // Add this back for the player system
  SHOOT_CD_MS: 200, 
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
  DIRECTIONAL_LIGHT_INTENSITY: 1.0,
  
  // Terrain configuration
  TERRAIN: {
    WIDTH: 500,
    HEIGHT: 80,
    DEPTH: 500,
    SEGMENTS_X: 256,
    SEGMENTS_Z: 256,
    HEIGHT_SCALE: 80,
    
    // Material heights (normalized 0-1)
    SNOW_HEIGHT: 0.8,
    ROCK_HEIGHT: 0.6, 
    GRASS_HEIGHT: 0.3,
    SAND_HEIGHT: 0.1,
    
    // Texture settings
    TEXTURE_SCALE: 0.05,
    DETAIL_SCALE: 0.2,
    NORMAL_SCALE: 1.0,
    
    // Rendering features
    ENABLE_TRIPLANAR: true,
    ENABLE_TEXTURE_BOMBING: true,
    
    // Physics settings
    COLLISION: {
      ENABLE_FALLBACK_GROUND: true,
      FRICTION: 1.0,
      RESTITUTION: 0.1,
      MAX_COLLISION_SEGMENTS: 128 // Increased from 64 for higher resolution collision
    }
  }
};

// Movement state enum values
export const MovementState = {
  GROUNDED: 0,
  JUMPING: 1,
  FALLING: 2
};

// Animation state enum values
export const PlayerAnimationState = {
  // Basic states
  IDLE: 0,
  WALKING: 1,
  RUNNING: 2,
  JUMPING: 3,
  FALLING: 4,
  
  // Combat states
  SHOOTING: 5, 
  AIMING: 6,   
  RELOAD: 7,
  
  // Movement states
  CROUCH_IDLE: 8,
  CROUCH_WALK: 9,
  CROUCH_RUN: 10,
  SPRINT: 11,
  
  // Special states
  DEATH: 12,
  HIT_REACTION: 13,
  INSPECT_WEAPON: 14
};

// Animation transition timing map (in seconds)
export const AnimationTransitions = {
  // Default transition time between states
  DEFAULT: 0.2,
  
  // Specific state transitions that need custom timing
  [PlayerAnimationState.IDLE + "_to_" + PlayerAnimationState.WALKING]: 0.3,
  [PlayerAnimationState.RUNNING + "_to_" + PlayerAnimationState.IDLE]: 0.5,
  [PlayerAnimationState.JUMPING + "_to_" + PlayerAnimationState.FALLING]: 0.1,
  [PlayerAnimationState.AIMING + "_to_" + PlayerAnimationState.SHOOTING]: 0.05
};

// Network configuration
export const NetworkConfig = {
    SERVER_URL: `ws://${window.location.hostname}:8080`, // Adjust hostname/port if needed
    UPDATE_INTERVAL_MS: 50, // Send local player updates 20 times per second
    INTERPOLATION_DELAY_MS: 100, // Delay applied to remote player interpolation
    PING_INTERVAL_MS: 5000 // Send ping every 5 seconds
};