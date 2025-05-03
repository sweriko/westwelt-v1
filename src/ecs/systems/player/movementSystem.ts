import { defineQuery, hasComponent } from 'bitecs';
import { LocalPlayer, RigidBodyRef, FPController, Transform } from '../../components'; // Added Transform
import { ECS } from '../../world';
import { InputState } from '../input';
import { vec2Pool, vec3Pool } from '../../utils/mathUtils';
import { PlayerConfig, MovementState } from '../../config';
import * as THREE from 'three'; // Import THREE

// Removed playerQuery, system now receives eid
// const playerQuery = defineQuery([LocalPlayer, RigidBodyRef, FPController]);

export function initPlayerMovementSystem(_world: ECS) {
  const dir = vec3Pool.get();
  const horiz = vec2Pool.get();
  let prevJump = false;

  // System now receives world and the specific local player eid
  return (w: ECS, eid: number) => {
    const input = w.input as InputState;
    if (!input) return w; // Should not happen if input system runs first

    const now = performance.now();

    // --- Process only the local player entity 'eid' ---
    const rb = w.ctx.maps.rb.get(eid);
    const kcc = w.ctx.kcc;
    const playerCollider = w.ctx.playerCollider;

    if (!rb || !kcc || !playerCollider) return w; // Skip if physics components not ready

    const holder = w.ctx.maps.mesh.get(eid); // Player's visual holder mesh
    if (!holder) return w;

    // --- Movement state + gravity ---
    const grounded = kcc.computedGrounded();
    if (grounded) FPController.lastGrounded[eid] = now;

    if (grounded) {
      FPController.moveState[eid] = MovementState.GROUNDED;
    } else {
      FPController.moveState[eid] = FPController.vertVel[eid] > 0 ?
        MovementState.JUMPING : MovementState.FALLING;
    }

    // Jump buffering
    const jumpPressed = input.jump && !prevJump;
    if (jumpPressed && FPController.jumpRequested[eid] === 0) {
      FPController.jumpRequested[eid] = 1;
      FPController.lastJumpRequest[eid] = now;
    } else if (!input.jump) {
      FPController.jumpRequested[eid] = 0;
    }

    const canJump = (grounded || now - FPController.lastGrounded[eid] < PlayerConfig.COYOTE_MS) &&
                    now - FPController.lastJump[eid] > PlayerConfig.JUMP_CD_MS;

    if (canJump && (jumpPressed || (now - FPController.lastJumpRequest[eid] < PlayerConfig.JUMP_BUFFER_MS))) {
      FPController.vertVel[eid] = PlayerConfig.JUMP_VEL;
      FPController.lastJump[eid] = now;
      FPController.jumpRequested[eid] = 0;
    }
    prevJump = input.jump;

    // Apply gravity
    if (FPController.moveState[eid] !== MovementState.GROUNDED) {
      FPController.vertVel[eid] = Math.max(
        FPController.vertVel[eid] - PlayerConfig.GRAVITY * w.time.dt,
        PlayerConfig.TERMINAL_FALL
      );
    } else {
      // Apply slight downward force when grounded to help stick to slopes
      FPController.vertVel[eid] = -2.0; // Small negative velocity when grounded
    }


    // --- Directional input ---
    dir.set(
      (input.rt ? 1 : 0) - (input.lf ? 1 : 0),
      0,
      (input.bk ? 1 : 0) - (input.fw ? 1 : 0)
    );

    if (dir.lengthSq() > 0) dir.normalize();

    // Apply player's current rotation (yaw) to the direction vector
    const playerRotation = new THREE.Quaternion(Transform.qx[eid], Transform.qy[eid], Transform.qz[eid], Transform.qw[eid]);
    dir.applyQuaternion(playerRotation);


    // Base speed
    const speed = PlayerConfig.WALK_SPEED *
                  (FPController.moveState[eid] === MovementState.GROUNDED ? 1 : PlayerConfig.AIR_CONTROL) *
                  (input.sprint ? PlayerConfig.SPRINT_FACTOR : 1);

    horiz.set(dir.x * speed, dir.z * speed);

    // --- KCC integration ---
    const dt = w.time.dt; // Use variable dt for input responsiveness

    const desiredMovement = {
      x: horiz.x * dt,
      y: FPController.vertVel[eid] * dt,
      z: horiz.y * dt
    };

    kcc.computeColliderMovement(playerCollider, desiredMovement);

    const actualMovement = kcc.computedMovement();

    // Check for head collision
    if (FPController.vertVel[eid] > 0 && actualMovement.y < desiredMovement.y * 0.9) {
      FPController.vertVel[eid] = 0; // Hit ceiling
    }

    // Apply the computed movement to the rigid body for the next physics step
    const currentPos = rb.translation();
    rb.setNextKinematicTranslation({
      x: currentPos.x + actualMovement.x,
      y: currentPos.y + actualMovement.y,
      z: currentPos.z + actualMovement.z
    });

    // Update the Transform component immediately for RenderSync interpolation base
    Transform.x[eid] = currentPos.x + actualMovement.x;
    Transform.y[eid] = currentPos.y + actualMovement.y;
    Transform.z[eid] = currentPos.z + actualMovement.z;

    // Note: RenderSync will handle interpolating the *visual* mesh (`holder`)
    // based on the RigidBody's state across physics steps. We update Transform
    // here to reflect the result of this frame's input processing.

    return w;
  };
}