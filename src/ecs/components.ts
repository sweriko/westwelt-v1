import { Types, defineComponent } from 'bitecs';

/** World-space transform (quat-pos) */
export const Transform = defineComponent({
  x: Types.f32, y: Types.f32, z: Types.f32,
  qx: Types.f32, qy: Types.f32, qz: Types.f32, qw: Types.f32
});

/** Linear velocity – used for projectiles */
export const Velocity = defineComponent({ x: Types.f32, y: Types.f32, z: Types.f32 });

/** TTL in milliseconds (bullets) */
export const Lifespan = defineComponent({ ttl: Types.f32, born: Types.f32 });

/** Debug visualization flag - used to store current debug state */
export const DebugVis = defineComponent({ active: Types.ui8 });

/** First-person controller state */
export const FPController = defineComponent({
  pitch: Types.f32,        // Camera pitch angle
  vertVel: Types.f32,      // Vertical velocity
  moveState: Types.ui8,    // 0=Grounded, 1=Jumping, 2=Falling
  lastGrounded: Types.f32, // Time when last grounded
  lastJump: Types.f32,     // Time when last jumped
  lastShot: Types.f32,     // Time when last shot
  jumpRequested: Types.ui8,// Jump buffer flag
  lastJumpRequest: Types.f32 // Time when jump was requested
});

/** Debug visualization mesh references */
export const DebugMeshRef = defineComponent({ id: Types.ui32 });

/** Trajectory for debug visualization */
export const Trajectory = defineComponent({
  // No data needed, just a tag to indicate an entity has a trajectory
});

/** Collision event data */
export const CollisionEvent = defineComponent({
  entity1: Types.ui32,     // First entity in collision
  entity2: Types.ui32,     // Second entity in collision
  impulse: Types.f32,      // Collision impulse magnitude
  time: Types.f32          // When collision occurred
});

/** Tags */
export const Player   = defineComponent();
export const Projectile = defineComponent();
export const CubeTag  = defineComponent();

/** Foreign-object indirection – store handles in JS Maps */
export const RigidBodyRef = defineComponent({ id: Types.ui32 });
export const MeshRef      = defineComponent({ id: Types.ui32 });
