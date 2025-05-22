/**
 * Main player system that initializes and combines movement, look and shoot sub-systems
 */
import { addComponent, addEntity } from 'bitecs';
import * as THREE from 'three';
import {
  MeshRef, Player, LocalPlayer, RigidBodyRef, Transform, FPController, NetworkId, Health, AnimationState
} from '../../components';
import { ECS } from '../../world';
import { MovementState, PlayerAnimationState, PlayerConfig } from '../../config';
import { initPlayerMovementSystem } from './movementSystem';
import { initPlayerLookSystem } from './lookSystem';
import { initPlayerShootSystem } from './shootSystem';
import { initPlayerAnimationSystem } from './animationSystem';
import { initFPSBodySystem } from './fpsBodySystem.js';
import { createControlPanel } from './controlPanel.js';

// Configuration for the player system
export const PlayerSystemConfig = {
  // Flag to enable the full-body FPS camera
  // When false, uses the traditional separate camera/model approach
  USE_FULLBODY_FPS: true,
  
  // Control panel configuration
  SHOW_CONTROL_PANEL: true
};

export function initPlayerSystem(world: ECS) {
  const { rapier, physics, three, maps } = world.ctx;

  /* entity + mesh holder ------------------------------------------- */
  const pid = addEntity(world);
  addComponent(world, Player,       pid);
  addComponent(world, LocalPlayer,  pid); // Local player for network compatibility
  addComponent(world, NetworkId,    pid); // NetworkId for multiplayer
  addComponent(world, Transform,    pid);
  addComponent(world, MeshRef,      pid);
  addComponent(world, RigidBodyRef, pid);
  addComponent(world, FPController, pid);
  addComponent(world, Health,       pid);
  addComponent(world, AnimationState, pid);
  
  // Initialize network components
  NetworkId.id[pid] = 0; // Will be set by server
  Health.current[pid] = PlayerConfig.MAX_HEALTH;
  Health.max[pid] = PlayerConfig.MAX_HEALTH;
  AnimationState.state[pid] = PlayerAnimationState.IDLE;
  
  // Initialize controller state
  FPController.pitch[pid] = 0;
  FPController.vertVel[pid] = 0;
  FPController.moveState[pid] = MovementState.GROUNDED;
  FPController.lastGrounded[pid] = performance.now();
  FPController.lastJump[pid] = 0;
  FPController.lastShot[pid] = 0;
  FPController.jumpRequested[pid] = 0;
  FPController.lastJumpRequest[pid] = 0;
  FPController.fallStartTime[pid] = 0;
  FPController.lastAnimationChange[pid] = 0;

  // Create mesh holder
  const holder = new THREE.Object3D();
  holder.position.set(0, 100, 6); // Lower the player spawn height
  three.scene.add(holder);
  maps.mesh.set(pid, holder);

  // Set up camera - different setup depending on camera mode
  if (!PlayerSystemConfig.USE_FULLBODY_FPS) {
    // Traditional setup: camera directly parented to holder
    const cameraOffset = new THREE.Object3D();
    cameraOffset.position.set(0, 1.6, 0); // Eye height of ~1.6m
    holder.add(cameraOffset);
    cameraOffset.add(three.camera);
  } else {
    // For full-body FPS, just add a temporary reference
    // The actual camera setup happens in the FPS body system
    const tempCameraHolder = new THREE.Object3D();
    tempCameraHolder.position.set(0, 1.6, 0);
    holder.add(tempCameraHolder);
    tempCameraHolder.add(three.camera);
  }

  // Initialize Quaternion in Transform component
  const quaternion = new THREE.Quaternion();
  holder.getWorldQuaternion(quaternion);
  Transform.qx[pid] = quaternion.x;
  Transform.qy[pid] = quaternion.y;
  Transform.qz[pid] = quaternion.z;
  Transform.qw[pid] = quaternion.w;

  /* Rapier kinematic capsule --------------------------------------- */
  const rb = physics.createRigidBody(
    rapier.RigidBodyDesc.kinematicPositionBased()
          .setTranslation(holder.position.x, holder.position.y, holder.position.z)
          .setCcdEnabled(true)
  );
  const collider = physics.createCollider(
    rapier.ColliderDesc.capsule(0.9, 0.3).setFriction(0.2), rb
  );

  const kcc = physics.createCharacterController(0.01);
  kcc.setApplyImpulsesToDynamicBodies(true);
  kcc.setUp({ x: 0, y: 1, z: 0 });
  kcc.enableAutostep(0.5, 0.3, true);
  kcc.enableSnapToGround(0.3);

  maps.rb.set(pid, rb);
  RigidBodyRef.id[pid] = rb.handle;
  
  // Store KCC and collider for use in movement system
  world.ctx.kcc = kcc;
  world.ctx.playerCollider = collider;
  
  // Add to entity handle map for collision detection
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
  
  // Initialize FPS body system if enabled
  const fpsBodySystem = PlayerSystemConfig.USE_FULLBODY_FPS ? 
    initFPSBodySystem(world) : null;
  
  // Create control panel for camera settings if enabled
  if (PlayerSystemConfig.SHOW_CONTROL_PANEL) {
    createControlPanel();
  }

  /* Combined system ------------------------------------------------- */
  return (w: ECS) => {
    // Ensure the correct order of system evaluation:
    // 1. Look system (camera rotation)
    // 2. Movement system (uses rotation for movement direction)
    // 3. Shoot system (uses camera direction)
    // 4. Animation system (based on movement state)
    // 5. FPS body system (if enabled, updates camera position/rotation)
    
    lookSystem(w);     // Handle camera rotation first
    movementSystem(w); // Apply movement based on new rotation
    shootSystem(w);    // Handle shooting based on camera direction
    animationSystem(w); // Update animations
    
    // Apply FPS body system if enabled
    if (PlayerSystemConfig.USE_FULLBODY_FPS && fpsBodySystem) {
      fpsBodySystem(w);
    }
    
    return w;
  };
}