/**
 * Player movement system - handles movement, jumping, and physics integration
 */
import { defineQuery } from 'bitecs';
import { Player, RigidBodyRef, FPController } from '../../components';
import { ECS } from '../../world';
import { InputState } from '../input';
import { vec2Pool, vec3Pool } from '../../utils/mathUtils';
import { PlayerConfig, MovementState } from '../../config';

export function initPlayerMovementSystem(_world: ECS) {
  const playerQuery = defineQuery([Player, RigidBodyRef, FPController]);
  
  // Reused vector objects to avoid allocations
  const dir = vec3Pool.get();
  const horiz = vec2Pool.get();
  
  // Track the previous jump state to require releasing space before jumping again
  let prevJump = false;

  return (w: ECS) => {
    const input = w.input as InputState;
    // Input check removed - initInputSystem is guaranteed to run first
    
    const now = performance.now();
    
    for (const eid of playerQuery(w)) {
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
      if (grounded) FPController.lastGrounded[eid] = now;

      if (grounded) {
        FPController.moveState[eid] = MovementState.GROUNDED;
      } else {
        FPController.moveState[eid] = FPController.vertVel[eid] > 0 ? 
          MovementState.JUMPING : MovementState.FALLING;
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
    }
    
    return w;
  };
} 