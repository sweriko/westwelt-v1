/**
 * Player look system - handles camera movement via mouse input
 */
import { defineQuery } from 'bitecs';
import * as THREE from 'three';
import { Player, FPController } from '../../components';
import { ECS } from '../../world';
import { InputState } from '../input';
import { PlayerConfig } from '../../config';

export function initPlayerLookSystem(_world: ECS) {
  const playerQuery = defineQuery([Player, FPController]);

  return (w: ECS) => {
    const input = w.input as InputState;
    // Input check removed - initInputSystem is guaranteed to run first

    // Skip if pointer isn't locked
    if (!input.pointerLocked) {
      input.dx = input.dy = 0;
      return w;
    }

    for (const eid of playerQuery(w)) {
      // Get the player object that holds the camera
      const holder = w.ctx.maps.mesh.get(eid);
      if (!holder) continue;
      
      // Update yaw (horizontal rotation)
      holder.rotation.y = (holder.rotation.y - input.dx * PlayerConfig.MOUSE_SENSITIVITY) % (Math.PI * 2);
      if (holder.rotation.y < 0) holder.rotation.y += Math.PI * 2;

      // Update pitch (vertical look) with clamping
      FPController.pitch[eid] = THREE.MathUtils.clamp(
        FPController.pitch[eid] - input.dy * PlayerConfig.MOUSE_SENSITIVITY, 
        -Math.PI / 2,  // Look up limit
        Math.PI / 2    // Look down limit
      );
      
      // Apply pitch to camera
      const camera = w.ctx.three.camera;
      if (camera) {
        camera.rotation.x = FPController.pitch[eid];
      }
    }
    
    // Reset mouse deltas after processing
    input.dx = input.dy = 0;
    
    return w;
  };
} 