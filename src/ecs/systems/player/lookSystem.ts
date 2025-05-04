/**
 * Player look system - handles camera movement via mouse input
 */
import { defineQuery } from 'bitecs';
import * as THREE from 'three';
import { Player, LocalPlayer, FPController, Transform } from '../../components';
import { ECS } from '../../world';
import { InputState } from '../input';
import { PlayerConfig } from '../../config';

export function initPlayerLookSystem(_world: ECS) {
  // Query specifically for local player first
  const localPlayerQuery = defineQuery([LocalPlayer, FPController]);
  const playerQuery = defineQuery([Player, FPController]);

  return (w: ECS) => {
    const input = w.input as InputState;

    // Skip if pointer isn't locked
    if (!input.pointerLocked) {
      input.dx = input.dy = 0;
      return w;
    }

    // Process local player entities first, fallback to Player tag if needed
    const localEntities = localPlayerQuery(w);
    const entities = localEntities.length > 0 ? localEntities : playerQuery(w);
    
    for (const eid of entities) {
      // Get the player object that holds the camera
      const holder = w.ctx.maps.mesh.get(eid);
      if (!holder) continue;
      
      // Update horizontal rotation (yaw)
      // CRITICAL FIX: Use negative sign for correct mouse movement direction
      holder.rotation.y = (holder.rotation.y - input.dx * PlayerConfig.MOUSE_SENSITIVITY) % (Math.PI * 2);
      if (holder.rotation.y < 0) holder.rotation.y += Math.PI * 2;

      // Update vertical look (pitch) with clamping
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
      
      // Update Transform component with the correct rotation values
      // This is critical for network synchronization
      const quaternion = new THREE.Quaternion();
      holder.getWorldQuaternion(quaternion);
      
      // Update ECS components with the current state
      Transform.qx[eid] = quaternion.x;
      Transform.qy[eid] = quaternion.y;
      Transform.qz[eid] = quaternion.z;
      Transform.qw[eid] = quaternion.w;
    }
    
    // Reset mouse deltas
    input.dx = input.dy = 0;
    
    return w;
  };
}