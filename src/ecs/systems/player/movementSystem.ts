/**
 * Player movement system - handles movement, jumping, and physics integration
 */
import { defineQuery } from 'bitecs';
import { Player, LocalPlayer, RigidBodyRef, FPController, Transform } from '../../components';
import { ECS } from '../../world';
import { InputState } from '../input';
import { vec2Pool, vec3Pool } from '../../utils/mathUtils';
import { PlayerConfig, MovementState } from '../../config';
import * as THREE from 'three';

export function initPlayerMovementSystem(_world: ECS) {
  // Query for either Player or LocalPlayer entities with required components
  const playerQuery = defineQuery([Player, RigidBodyRef, FPController]);
  const localPlayerQuery = defineQuery([LocalPlayer, RigidBodyRef, FPController]);
  
  // Reused vector objects to avoid allocations
  const dir = vec3Pool.get();
  const horiz = vec2Pool.get();
  
  // Track the previous jump state to require releasing space before jumping again
  let prevJump = false;

  return (w: ECS) => {
    const input = w.input as InputState;
    // Input check removed - initInputSystem is guaranteed to run first
    
    const now = performance.now();
    
    // Process both player and localPlayer entities
    // In most cases, entities will have both components
    const entities = new Set([...playerQuery(w), ...localPlayerQuery(w)]);
    
    for (const eid of entities) {
      const rb = w.ctx.maps.rb.get(eid);
      const kcc = w.ctx.kcc; // Character controller from player init
      const playerCollider = w.ctx.playerCollider;
      
      // Skip if we don't have all required components
      if (!rb || !kcc || !playerCollider) continue;
      
      // Get the player mesh holder
      const holder = w.ctx.maps.mesh.get(eid);
      if (!holder) continue;
      
      /* movement state + gravity ------------------------------------- */
      const grounded = kcc.computedGrounded();
      if (grounded) {
        FPController.lastGrounded[eid] = now;
        FPController.fallStartTime[eid] = 0; // Reset fall tracking when grounded
      }

      if (grounded) {
        FPController.moveState[eid] = MovementState.GROUNDED;
      } else {
        if (FPController.vertVel[eid] > 0) {
          FPController.moveState[eid] = MovementState.JUMPING;
          FPController.fallStartTime[eid] = 0; // Reset fall tracking when jumping
        } else {
          // Only start fall tracking when velocity crosses the threshold
          if (FPController.vertVel[eid] <= PlayerConfig.FALL_ANIMATION_VELOCITY_THRESHOLD) {
            if (FPController.fallStartTime[eid] === 0) {
              FPController.fallStartTime[eid] = now; // Start tracking fall time
            }
          } else {
            FPController.fallStartTime[eid] = 0; // Reset if not falling fast enough
          }
          FPController.moveState[eid] = MovementState.FALLING;
        }
      }
      
      // Handle jump buffering - store jump request timing
      // Only allow a new jump request if space was released since last jump
      const jumpPressed = input.jump && !prevJump;
      if (jumpPressed && FPController.jumpRequested[eid] === 0) {
        FPController.jumpRequested[eid] = 1;
        FPController.lastJumpRequest[eid] = now;
      } else if (!input.jump) {
        FPController.jumpRequested[eid] = 0;
      }

      // Check if we can jump with either direct input or buffered input
      const canJump = (grounded || now - FPController.lastGrounded[eid] < PlayerConfig.COYOTE_MS) && 
                      now - FPController.lastJump[eid] > PlayerConfig.JUMP_CD_MS;
      
      // Execute jump if conditions met, including buffered jumps
      if (canJump && (jumpPressed || (now - FPController.lastJumpRequest[eid] < PlayerConfig.JUMP_BUFFER_MS))) {
        FPController.vertVel[eid] = PlayerConfig.JUMP_VEL;
        FPController.lastJump[eid] = now;
        FPController.jumpRequested[eid] = 0;
      }

      // Store previous jump state for next frame
      prevJump = input.jump;

      if (FPController.moveState[eid] !== MovementState.GROUNDED) {
        // Apply gravity with framerate-independent scaling
        FPController.vertVel[eid] = Math.max(
          FPController.vertVel[eid] - PlayerConfig.GRAVITY * w.time.dt, 
          PlayerConfig.TERMINAL_FALL
        );
      } else {
        FPController.vertVel[eid] *= 0.8;
        if (Math.abs(FPController.vertVel[eid]) < 0.1) FPController.vertVel[eid] = 0;
      }

      /* directional input -------------------------------------------- */
      dir.set(
        (input.rt ? 1 : 0) - (input.lf ? 1 : 0),
        0,
        (input.bk ? 1 : 0) - (input.fw ? 1 : 0)
      );
      
      if (dir.lengthSq() > 0) dir.normalize();
      
      // Get a temporary up vector, use it, then release it
      const upVector = vec3Pool.get().set(0, 1, 0);
      dir.applyAxisAngle(upVector, holder.rotation.y);
      vec3Pool.release(upVector);

      // Base speed calculation
      const speed = PlayerConfig.WALK_SPEED *
                    (FPController.moveState[eid] === MovementState.GROUNDED ? 
                      1 : PlayerConfig.AIR_CONTROL) *
                    (input.sprint ? PlayerConfig.SPRINT_FACTOR : 1);

      horiz.set(dir.x * speed, dir.z * speed);

      /* KCC integration ---------------------------------------------- */
      // Always scale movement by delta time for frame independence
      const dt = w.time.shouldRunPhysics ? w.time.fixedDt! : w.time.dt;
      
      const requested = {
        x: horiz.x * dt,
        y: FPController.vertVel[eid] * dt,
        z: horiz.y * dt
      };
      
      // Now safe to use playerCollider since we checked it above
      kcc.computeColliderMovement(playerCollider, requested);
      const actual = kcc.computedMovement();

      if (FPController.vertVel[eid] > 0 && actual.y < requested.y * 0.9) {
        FPController.vertVel[eid] = 0; // head hit
      }

      const p = rb.translation();
      rb.setNextKinematicTranslation({
        x: p.x + actual.x,
        y: p.y + actual.y,
        z: p.z + actual.z
      });
      
      holder.position.set(p.x + actual.x, p.y + actual.y, p.z + actual.z);
      
      // Update the Transform component for network sync
      Transform.x[eid] = holder.position.x;
      Transform.y[eid] = holder.position.y;
      Transform.z[eid] = holder.position.z;
      
      // Update rotation in Transform component for network sync
      const quaternion = new THREE.Quaternion();
      holder.getWorldQuaternion(quaternion);
      Transform.qx[eid] = quaternion.x;
      Transform.qy[eid] = quaternion.y;
      Transform.qz[eid] = quaternion.z;
      Transform.qw[eid] = quaternion.w;
    }
    
    return w;
  };
}