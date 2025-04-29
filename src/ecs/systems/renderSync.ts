/**********************************************************************
 * renderSync.ts – sync Three meshes with Rapier bodies each frame
 *********************************************************************/
import { defineQuery, hasComponent, exitQuery } from 'bitecs';
import { ECS } from '../world';
import {
  MeshRef, RigidBodyRef, Transform, Player, Projectile
} from '../components';
import { vec3Pool, quatPool, interpolatePositions, interpolateRotations } from '../utils/mathUtils';

export function initRenderSyncSystem(_world: ECS) {
  const q = defineQuery([MeshRef]);
  const rbQuery = defineQuery([MeshRef, RigidBodyRef]);
  
  // Listen for entity deletions with MeshRef component
  const exitMeshQuery = exitQuery(q);
  
  // Storage for previous physics state for interpolation
  const prevPositions = new Map<number, THREE.Vector3>();
  const prevRotations = new Map<number, THREE.Quaternion>();

  return (w: ECS) => {
    // First, handle entity removal through bitECS exitQuery
    for (const eid of exitMeshQuery(w)) {
      // Clean up interpolation data for removed entities
      prevPositions.delete(eid);
      prevRotations.delete(eid);
      
      // Remove from entity handle map if present
      if (w.ctx.entityHandleMap) {
        // Find and remove any entry for this entity ID
        for (const [handle, entityId] of w.ctx.entityHandleMap.entries()) {
          if (entityId === eid) {
            w.ctx.entityHandleMap.delete(handle);
            break;
          }
        }
      }
    }
    
    // Then handle entities marked for deletion
    for (const eid of q(w)) {
      const mesh = w.ctx.maps.mesh.get(eid);
      if (mesh?.userData?.markedForDeletion) {
        // Clean up interpolation data only
        prevPositions.delete(eid);
        prevRotations.delete(eid);
      }
    }
    
    // Alpha for interpolation (0.0 to 1.0)
    const isHighRefreshRate = w.time.dt < 0.01; // Detecting high refresh (>100Hz)
    const alpha = isHighRefreshRate ? 
                  // Less interpolation on high refresh for sharper image
                  Math.min(0.5, w.time.alpha || 0) :
                  // Standard interpolation on normal refresh
                  (w.time.alpha !== undefined ? w.time.alpha : 0);
    
    // Get reusable vectors/quaternions
    const currentPos = vec3Pool.get();
    const currentRot = quatPool.get();
    
    for (const eid of rbQuery(w)) {
      const mesh = w.ctx.maps.mesh.get(eid)!;
      const rb   = w.ctx.maps.rb.get(eid); 
      
      if (!rb) continue;

      // Handle physics-driven objects that aren't the player
      if (!hasComponent(w, Player, eid)) {
        const p = rb.translation();
        const r = rb.rotation();
        
        // Set current position/rotation
        currentPos.set(p.x, p.y, p.z);
        currentRot.set(r.x, r.y, r.z, r.w);
        
        // Initialize previous state on first frame
        if (!prevPositions.has(eid)) {
          prevPositions.set(eid, currentPos.clone());
        }
        if (!prevRotations.has(eid)) {
          prevRotations.set(eid, currentRot.clone());
        }
        
        // Get previous state
        const prevPos = prevPositions.get(eid)!;
        const prevRot = prevRotations.get(eid)!;
        
        // Update previous state only when physics runs
        if (w.time.shouldRunPhysics) {
          prevPos.copy(currentPos);
          prevRot.copy(currentRot);
        }
        
        // On fast-moving objects, reduce interpolation to prevent blur
        const vel = rb.linvel ? rb.linvel() : null;
        const isMovingFast = vel && (vel.x*vel.x + vel.y*vel.y + vel.z*vel.z > 100);
        
        // Skip interpolation entirely for fast-moving objects (like bullets)
        // to avoid the quaternion slerp overhead - just use current position directly
        if (isMovingFast || hasComponent(w, Projectile, eid)) {
          mesh.position.set(currentPos.x, currentPos.y, currentPos.z);
          mesh.quaternion.set(currentRot.x, currentRot.y, currentRot.z, currentRot.w);
        } else {
          // Standard interpolation for normal objects
          const objectAlpha = isHighRefreshRate ? 0.3 : alpha;
          interpolatePositions(mesh.position, prevPos, currentPos, objectAlpha);
          interpolateRotations(mesh.quaternion, prevRot, currentRot, objectAlpha);
        }
        
        continue;
      }

      // Handle the player capsule (position only)
      if (hasComponent(w, Player, eid)) {
        const p = rb.translation();
        
        // Player movement uses same interpolation technique
        currentPos.set(p.x, p.y, p.z);
        
        // Initialize previous state on first frame
        if (!prevPositions.has(eid)) {
          prevPositions.set(eid, currentPos.clone());
        }
        
        // Get previous state
        const prevPos = prevPositions.get(eid)!;
        
        // Update previous state only when physics runs
        if (w.time.shouldRunPhysics) {
          prevPos.copy(currentPos);
        }
        
        // For player, use minimal interpolation on high refresh rate
        const playerAlpha = isHighRefreshRate ? Math.min(0.3, alpha) : alpha;
        
        // Interpolate player position
        interpolatePositions(mesh.position, prevPos, currentPos, playerAlpha);
        continue;
      }
    }

    // Handle remaining kinematic meshes - write transform back into ECS 
    for (const eid of q(w)) {
      // Skip if it has a rigid body (already processed above)
      if (hasComponent(w, RigidBodyRef, eid)) continue;
      
      const mesh = w.ctx.maps.mesh.get(eid)!;
      
      // Use pooled vectors
      const pos = vec3Pool.get();
      const quat = quatPool.get();
      
      mesh.getWorldPosition(pos);
      mesh.getWorldQuaternion(quat);

      Transform.x[eid]  = pos.x;
      Transform.y[eid]  = pos.y;
      Transform.z[eid]  = pos.z;
      Transform.qx[eid] = quat.x;
      Transform.qy[eid] = quat.y;
      Transform.qz[eid] = quat.z;
      Transform.qw[eid] = quat.w;
      
      // Release pooled vectors
      vec3Pool.release(pos);
      quatPool.release(quat);
    }
    
    // Release pooled vectors used for the loop
    vec3Pool.release(currentPos);
    quatPool.release(currentRot);
    
    return w;
  };
}
