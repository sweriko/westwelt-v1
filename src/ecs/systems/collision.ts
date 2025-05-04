import { defineQuery, addComponent, addEntity, hasComponent } from 'bitecs';
import { Projectile, CubeTag, RigidBodyRef, CollisionEvent, Health, LocalPlayer, NetworkId } from '../components';
import { ECS } from '../world';
import { vec3Pool, createEntityPairKey } from '../utils/mathUtils';
import { PhysicsConfig, WeaponConfig } from '../config';
import { network } from './network/client';

export function initCollisionSystem(world: ECS) {
  // Queries for finding entities
  const projectileQuery = defineQuery([Projectile, RigidBodyRef]);
  const cubeQuery = defineQuery([CubeTag, RigidBodyRef]);
  const localPlayerQuery = defineQuery([LocalPlayer]);
  
  // Processed collisions cache to avoid duplicates
  const processedCollisions = new Map<bigint, number>();

  // Initialize entity handle mapping if not done already
  if (!world.ctx.entityHandleMap) {
    world.ctx.entityHandleMap = new Map<number, number>();
  }

  // Helper function to mark entities for deletion
  function markEntityForDeletion(w: ECS, eid: number) {
    const mesh = w.ctx.maps.mesh.get(eid);
    if (mesh) {
      if (!mesh.userData) mesh.userData = {};
      mesh.userData.markedForDeletion = true;
    }
  }

  return (w: ECS) => {
    const now = performance.now();

    // Clean up old processed collisions
    for (const [key, time] of processedCollisions.entries()) {
      if (now - time > 200) {
        processedCollisions.delete(key);
      }
    }

    // Skip if event queue not available
    if (!w.ctx.eventQueue) {
      return w;
    }

    // Update entity handle map for projectiles and cubes
    // This helps translate Rapier body handles to our ECS entity IDs
    for (const eid of projectileQuery(w)) {
      const rb = w.ctx.maps.rb.get(eid);
      if (rb && !w.ctx.entityHandleMap!.has(rb.handle)) {
        w.ctx.entityHandleMap!.set(rb.handle, eid);
      }
    }
    
    for (const eid of cubeQuery(w)) {
      const rb = w.ctx.maps.rb.get(eid);
      if (rb && !w.ctx.entityHandleMap!.has(rb.handle)) {
        w.ctx.entityHandleMap!.set(rb.handle, eid);
      }
    }

    // Process collision events from Rapier physics
    w.ctx.eventQueue.drainCollisionEvents((handle1: number, handle2: number, started: boolean) => {
      if (!started) return; // Only care about collision starts

      // Get entity IDs from rigid body handles
      const entity1 = w.ctx.entityHandleMap!.get(handle1);
      const entity2 = w.ctx.entityHandleMap!.get(handle2);

      if (!entity1 || !entity2) return;

      // Check entity types
      const isProjectile1 = hasComponent(w, Projectile, entity1);
      const isProjectile2 = hasComponent(w, Projectile, entity2);
      const isCube1 = hasComponent(w, CubeTag, entity1);
      const isCube2 = hasComponent(w, CubeTag, entity2);
      const isLocalPlayer1 = hasComponent(w, LocalPlayer, entity1);
      const isLocalPlayer2 = hasComponent(w, LocalPlayer, entity2);
      
      // --- Collision: Projectile <-> Cube ---
      if ((isProjectile1 && isCube2) || (isProjectile2 && isCube1)) {
        const projectileEid = isProjectile1 ? entity1 : entity2;
        const cubeEid = isCube1 ? entity1 : entity2;

        // Create a unique collision ID to prevent duplicate processing
        const collisionId = createEntityPairKey(projectileEid, cubeEid);
        if (processedCollisions.has(collisionId)) return;
        processedCollisions.set(collisionId, now);

        // Get the rigid bodies
        const cubeRB = w.ctx.maps.rb.get(cubeEid);
        const projectileRB = w.ctx.maps.rb.get(projectileEid);
        if (!cubeRB || !projectileRB) return;

        // Apply impulse to cube
        const bulletPos = projectileRB.translation();
        const cubePos = cubeRB.translation();
        
        // Calculate impact direction
        const impactDir = vec3Pool.get().set(
          cubePos.x - bulletPos.x, 
          cubePos.y - bulletPos.y, 
          cubePos.z - bulletPos.z
        ).normalize();
        
        // If direction is zero (direct center hit), use reversed bullet velocity
        if (impactDir.lengthSq() < 0.001) {
          const vel = projectileRB.linvel();
          impactDir.set(-vel.x, -vel.y, -vel.z).normalize();
        }
        
        // Apply impulse at impact point
        cubeRB.applyImpulseAtPoint(
          { 
            x: impactDir.x * PhysicsConfig.IMPACT_FORCE, 
            y: impactDir.y * PhysicsConfig.IMPACT_FORCE, 
            z: impactDir.z * PhysicsConfig.IMPACT_FORCE 
          },
          bulletPos,
          true
        );
        
        // Apply random torque for more natural movement
        cubeRB.applyTorqueImpulse(
          { 
            x: (Math.random() - 0.5) * PhysicsConfig.IMPACT_FORCE * 0.3, 
            y: (Math.random() - 0.5) * PhysicsConfig.IMPACT_FORCE * 0.3, 
            z: (Math.random() - 0.5) * PhysicsConfig.IMPACT_FORCE * 0.3 
          }, 
          true
        );

        // Mark projectile for deletion
        markEntityForDeletion(w, projectileEid);
        vec3Pool.release(impactDir);
        return; // Processed this collision
      }

      // --- Collision: Projectile <-> LocalPlayer ---
      // This should only happen with OTHER players' projectiles hitting the local player
      // The server is authoritative, but we can use this to provide immediate visual feedback
      if ((isProjectile1 && isLocalPlayer2) || (isProjectile2 && isLocalPlayer1)) {
        const projectileEid = isProjectile1 ? entity1 : entity2;
        const playerEid = isLocalPlayer1 ? entity1 : entity2;

        // Create a unique collision ID to prevent duplicate processing
        const collisionId = createEntityPairKey(projectileEid, playerEid);
        if (processedCollisions.has(collisionId)) return;
        processedCollisions.set(collisionId, now);

        console.log(`Local impact detected: projectile ${projectileEid} hit local player ${playerEid}`);
        
        // Mark projectile for deletion (visual feedback)
        markEntityForDeletion(w, projectileEid);
        
        // Server will determine actual damage via hit event,
        // but we can trigger immediate local feedback if desired:
        // For example, play hit sound, flash screen, etc.
        
        return; // Processed this collision
      }
    });

    return w;
  };
}