import { createWorld, pipe, IWorld } from 'bitecs';
import { initInputSystem, InputState } from './systems/input';
import { initPlayerSystem }    from './systems/player';
import { initProjectileSystem }from './systems/projectile';
import { initPhysicsSystem }   from './systems/physics';
import { initRenderSyncSystem }from './systems/renderSync';
import { initDebugVisSystem }  from './systems/debugVis';
import { initCollisionSystem } from './systems/collision';
import { initTimeStepSystem }  from './systems/timeStep';
import { initGrassSystem }     from './systems/grass';
import { initNetworkSystem, NetworkState } from './systems/network/client'; // Import network system
import { initHealthSystem } from './systems/healthSystem'; // Import health system
import { createTerrainSystem } from './systems/terrain/TerrainSystem'; // Import terrain system
import * as THREE from 'three';
import type * as RAPIER from '@dimforge/rapier3d-compat';

export function createECS(ctx: ECSContext) {
  const world = createWorld() as ECS;
  world.ctx  = ctx;
  world.time = {
    dt: 0,
    then: performance.now(),
    accumulator: 0
  };
  world.network = { // Initialize network state
      connected: false,
      connecting: false,
      socket: null,
      messageQueue: [],
      pendingUpdates: new Map(),
      lastSentTime: 0,
      lastPingTime: 0
  };
  world.players = new Map(); // Map NetworkId -> EntityId

  // Create Rapier event queue if not already done in scene context creation
  if (!ctx.eventQueue) {
    ctx.eventQueue = new ctx.rapier.EventQueue(true);
  }

  const pipeline = pipe(
    initTimeStepSystem(world),
    initInputSystem(world),
    initNetworkSystem(world),   // Network system runs early to process incoming messages
    initPlayerSystem(world),
    initPhysicsSystem(world),
    initCollisionSystem(world), // Keep for non-player collisions (e.g., projectile-cube)
    initProjectileSystem(world),// Manages visual lifetime of local/remote projectiles
    initHealthSystem(world),    // Handles health updates and death/respawn events
    initGrassSystem(world),
    createTerrainSystem(ctx),   // Add terrain system
    initDebugVisSystem(world),
    initRenderSyncSystem(world) // Render sync runs last
  );

  return { world, pipeline };
}

/* Types shared with scene & systems */
export interface ECSContext {
  rapier: typeof RAPIER;
  physics: RAPIER.World;
  three: {
    scene: THREE.Scene;
    camera: THREE.Camera;
    renderer: THREE.WebGLRenderer;
  };
  maps: {
    rb: Map<number, RAPIER.RigidBody>; // EntityId -> RigidBody
    mesh: Map<number, THREE.Object3D>; // EntityId -> Mesh
  };
  eventQueue?: RAPIER.EventQueue;
  kcc?: RAPIER.KinematicCharacterController;
  playerCollider?: RAPIER.Collider;
  entityHandleMap?: Map<number, number>; // RB Handle -> EntityId
  localPlayerId: number | null; // Added to store the local player's network ID
}

// Extend IWorld with our custom properties
export interface ECS extends IWorld {
  ctx: ECSContext;
  time: {
    dt: number;
    then: number;
    accumulator: number;
    fixedDt?: number;
    alpha?: number;
    physicsSteps?: number;
    shouldRunPhysics?: boolean;
    prevPlayerPos?: THREE.Vector3;
  };
  input?: InputState;
  network: NetworkState; // Add network state object
  players: Map<number, number>; // Add map for NetworkId -> EntityId mapping
}