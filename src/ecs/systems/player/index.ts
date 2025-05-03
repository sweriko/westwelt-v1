import { addComponent, addEntity } from 'bitecs';
import * as THREE from 'three';
import {
  MeshRef, RigidBodyRef, Transform, FPController, LocalPlayer, NetworkId, Health, AnimationState // Added multiplayer components
} from '../../components';
import { ECS } from '../../world';
import { MovementState, PlayerAnimationState, PlayerConfig } from '../../config'; // Added PlayerAnimationState
import { initPlayerMovementSystem } from './movementSystem';
import { initPlayerLookSystem } from './lookSystem';
import { initPlayerShootSystem } from './shootSystem';
import { initPlayerAnimationSystem } from './animationSystem';

export function initPlayerSystem(world: ECS) {
  const { rapier, physics, three, maps } = world.ctx;

  // Create the *local* player entity
  const pid = addEntity(world);
  addComponent(world, LocalPlayer,    pid); // Tag as LocalPlayer
  addComponent(world, NetworkId,      pid); // Will be set by server init message
  addComponent(world, Transform,      pid);
  addComponent(world, MeshRef,        pid);
  addComponent(world, RigidBodyRef,   pid);
  addComponent(world, FPController,   pid);
  addComponent(world, Health,         pid); // Add Health component
  addComponent(world, AnimationState, pid); // Add AnimationState component

  NetworkId.id[pid] = 0; // Placeholder ID, server will assign correct one
  Health.current[pid] = PlayerConfig.MAX_HEALTH;
  Health.max[pid] = PlayerConfig.MAX_HEALTH;
  AnimationState.state[pid] = PlayerAnimationState.IDLE; // Start in Idle state

  // Initialize controller state (same as before)
  FPController.pitch[pid] = 0;
  FPController.vertVel[pid] = 0;
  FPController.moveState[pid] = MovementState.GROUNDED;
  FPController.lastGrounded[pid] = performance.now();
  FPController.lastJump[pid] = 0;
  // FPController.lastShot removed - handled by server/network
  FPController.jumpRequested[pid] = 0;
  FPController.lastJumpRequest[pid] = 0;

  // --- Mesh Holder ---
  const holder = new THREE.Object3D();
  // Start position might be overridden by server 'init' message
  holder.position.set(0, 20, 10); // Start much higher above the cube stack
  three.scene.add(holder);
  maps.mesh.set(pid, holder); // Associate entity ID with the holder mesh

  // Camera setup inside the holder
  const cameraOffset = new THREE.Object3D();
  cameraOffset.position.set(0, 0.7, 0); // Eye height relative to holder's base (adjust from 1.6)
  holder.add(cameraOffset);
  cameraOffset.add(three.camera);

  // --- Rapier Body ---
  const rb = physics.createRigidBody(
    rapier.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(holder.position.x, holder.position.y, holder.position.z)
          .setCcdEnabled(true) // Keep CCD enabled for player potentially
  );
  const collider = physics.createCollider(
    // Slightly thinner capsule collider
    rapier.ColliderDesc.capsule(0.8, 0.3) // Height 0.8, Radius 0.3
      .setFriction(0.1) // Lower friction
      .setDensity(1.0), // Set density for KCC interactions
    rb
  );

  // --- Kinematic Character Controller ---
  const kcc = physics.createCharacterController(0.02); // Slightly larger offset
  kcc.setApplyImpulsesToDynamicBodies(true);
  kcc.enableAutostep(0.4, 0.4, true); // Adjusted auto-step parameters
  kcc.enableSnapToGround(0.5); // Increased snap distance slightly
  kcc.setSlideEnabled(true); // Enable sliding

  maps.rb.set(pid, rb);
  RigidBodyRef.id[pid] = rb.handle;

  // Store KCC and collider in world context
  world.ctx.kcc = kcc;
  world.ctx.playerCollider = collider;

  // Update entity handle map
  if (world.ctx.entityHandleMap) {
      world.ctx.entityHandleMap.set(rb.handle, pid);
  } else {
      world.ctx.entityHandleMap = new Map<number, number>();
      world.ctx.entityHandleMap.set(rb.handle, pid);
  }


  // Initialize sub-systems
  const movementSystem = initPlayerMovementSystem(world);
  const lookSystem = initPlayerLookSystem(world);
  const shootSystem = initPlayerShootSystem(world);
  const animationSystem = initPlayerAnimationSystem(world);

  // Combined system - runs sub-systems *only* for the local player
  return (w: ECS) => {
    const localPlayers = world.players.get(w.ctx.localPlayerId!);
    if (localPlayers !== undefined) { // Check if the local player entity exists
        const localEid = localPlayers;
        // Run systems specifically for the local player entity
        lookSystem(w, localEid);
        movementSystem(w, localEid);
        shootSystem(w, localEid);
        animationSystem(w, localEid); // Animation system needs to run for local player
    }
     // Animation system might also need to run for remote players separately
     // Consider moving remote player animation updates to RenderSync or a dedicated system
    return w;
  };
}