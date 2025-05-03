import { createWorld, pipe } from 'bitecs';
import { initInputSystem, InputState } from './systems/input.ts';
import { initPlayerSystem }    from './systems/player';
import { initProjectileSystem }from './systems/projectile.ts';
import { initPhysicsSystem }   from './systems/physics.ts';
import { initRenderSyncSystem }from './systems/renderSync.ts';
import { initDebugVisSystem }  from './systems/debugVis.ts';
import { initCollisionSystem } from './systems/collision.ts';
import { initTimeStepSystem }  from './systems/timeStep.ts';
import { initGrassSystem }     from './systems/grass.ts';
import * as THREE from 'three';

// Import Rapier types - use a type-only import to avoid runtime loading
import type * as RAPIER from '@dimforge/rapier3d-compat';

/** Create ECS world + pipeline */
export function createECS(ctx: ECSContext) {
  const world = createWorld() as ECS;
  world.ctx  = ctx;
  world.time = { 
    dt: 0, 
    then: performance.now(),
    accumulator: 0
  };
  
  // Create a collision event queue for Rapier
  const eventQueue = new ctx.rapier.EventQueue(true);
  world.ctx.eventQueue = eventQueue;

  const pipeline = pipe(
    initTimeStepSystem(world),  // Run first to manage fixed timestep
    initInputSystem(world),
    initPlayerSystem(world),
    initPhysicsSystem(world),   // Physics runs before collision system to process contacts
    initCollisionSystem(world), // Now handles Rapier collision events instead of raycasting
    initProjectileSystem(world),
    initGrassSystem(world),     // Add grass system
    initDebugVisSystem(world),
    initRenderSyncSystem(world)
  );

  return { world, pipeline };
}

/* -------------------------------------------------- */
/* Types shared with scene & systems                  */
export interface ECSContext {
  rapier: typeof RAPIER;
  physics: RAPIER.World;
  three: {
    scene: THREE.Scene;
    camera: THREE.Camera;
    renderer: THREE.WebGLRenderer;
  };
  maps: {
    rb: Map<number, RAPIER.RigidBody>;
    mesh: Map<number, THREE.Object3D>;
  };
  eventQueue?: RAPIER.EventQueue; 
  kcc?: RAPIER.KinematicCharacterController; 
  playerCollider?: RAPIER.Collider;
  entityHandleMap?: Map<number, number>; // Map from RB handle to entity ID
}

export interface ECS {
  ctx: ECSContext;
  time: {
    dt: number;
    then: number;
    accumulator: number;
    fixedDt?: number;
    alpha?: number;
    physicsSteps?: number;
    shouldRunPhysics?: boolean;
    prevPlayerPos?: THREE.Vector3; // Store previous player position for animation
  };
  input?: InputState;
}
