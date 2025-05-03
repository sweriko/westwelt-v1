import { defineQuery, addComponent, addEntity, hasComponent } from 'bitecs';
import { Projectile, CubeTag, RigidBodyRef, CollisionEvent, Health, LocalPlayer } from '../components'; // Added Health, LocalPlayer
import { ECS } from '../world';
import { vec3Pool, createEntityPairKey } from '../utils/mathUtils';
import { PhysicsConfig, WeaponConfig } from '../config'; // Added WeaponConfig
import { network } from './network/client'; // Import network client

export function initCollisionSystem(world: ECS) {
  // Queries remain the same for projectile-cube interaction
  const projectileQuery = defineQuery([Projectile, RigidBodyRef]);
  const cubeQuery = defineQuery([CubeTag, RigidBodyRef]);
  const localPlayerQuery = defineQuery([LocalPlayer]); // Query for local player

  const processedCollisions = new Map<bigint, number>();

  // Initialize entity handle mapping if not done already
  if (!world.ctx.entityHandleMap) {
    world.ctx.entityHandleMap = new Map<number, number>();
  }

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

    if (!w.ctx.eventQueue) {
      return w;
    }

    // Update entity handle map (can be optimized)
    const projectiles = projectileQuery(w);
    const cubes = cubeQuery(w);
    for (const eid of projectiles) {
        const rb = w.ctx.maps.rb.get(eid);
        if (rb && !w.ctx.entityHandleMap!.has(rb.handle)) {
            w.ctx.entityHandleMap!.set(rb.handle, eid);
        }
    }
     for (const eid of cubes) {
         const rb = w.ctx.maps.rb.get(eid);
         if (rb && !w.ctx.entityHandleMap!.has(rb.handle)) {
             w.ctx.entityHandleMap!.set(rb.handle, eid);
         }
     }


    // Process collision events from Rapier physics
    w.ctx.eventQueue.drainCollisionEvents((handle1: number, handle2: number, started: boolean) => {
        if (!started) return; // Only care about collision starts

        const entity1 = w.ctx.entityHandleMap!.get(handle1);
        const entity2 = w.ctx.entityHandleMap!.get(handle2);

        if (!entity1 || !entity2) return;

        const isProjectile1 = hasComponent(w, Projectile, entity1);
        const isProjectile2 = hasComponent(w, Projectile, entity2);
        const isCube1 = hasComponent(w, CubeTag, entity1);
        const isCube2 = hasComponent(w, CubeTag, entity2);
        const isLocalPlayer1 = hasComponent(w, LocalPlayer, entity1); // Check if it's the local player
        const isLocalPlayer2 = hasComponent(w, LocalPlayer, entity2);

        // --- Collision: Projectile <-> Cube ---
        if ((isProjectile1 && isCube2) || (isProjectile2 && isCube1)) {
            const projectileEid = isProjectile1 ? entity1 : entity2;
            const cubeEid = isCube1 ? entity1 : entity2;

            const collisionId = createEntityPairKey(projectileEid, cubeEid);
            if (processedCollisions.has(collisionId)) return;
            processedCollisions.set(collisionId, now);

            const cubeRB = w.ctx.maps.rb.get(cubeEid);
            const projectileRB = w.ctx.maps.rb.get(projectileEid);
            if (!cubeRB || !projectileRB) return;

            // Apply impulse (same as before)
            const bulletPos = projectileRB.translation();
            const cubePos = cubeRB.translation();
            const impactDir = vec3Pool.get().set(
                cubePos.x - bulletPos.x, cubePos.y - bulletPos.y, cubePos.z - bulletPos.z
            ).normalize();
             if (impactDir.lengthSq() < 0.001) {
                 const vel = projectileRB.linvel();
                 impactDir.set(-vel.x, -vel.y, -vel.z).normalize();
             }
            cubeRB.applyImpulseAtPoint(
                { x: impactDir.x * PhysicsConfig.IMPACT_FORCE, y: impactDir.y * PhysicsConfig.IMPACT_FORCE, z: impactDir.z * PhysicsConfig.IMPACT_FORCE },
                bulletPos,
                true
            );
             cubeRB.applyTorqueImpulse({ x: (Math.random() - 0.5) * PhysicsConfig.IMPACT_FORCE * 0.3, y: (Math.random() - 0.5) * PhysicsConfig.IMPACT_FORCE * 0.3, z: (Math.random() - 0.5) * PhysicsConfig.IMPACT_FORCE * 0.3 }, true);


            // Mark projectile for deletion
            markEntityForDeletion(w, projectileEid);
            vec3Pool.release(impactDir);
            return; // Processed this collision
        }

         // --- Collision: Projectile <-> LocalPlayer ---
         // This should NOT happen if projectiles are visual-only or sensors are used correctly.
         // However, if a physics-based projectile hits the local player's *physical* collider:
         if ((isProjectile1 && isLocalPlayer2) || (isProjectile2 && isLocalPlayer1)) {
             const projectileEid = isProjectile1 ? entity1 : entity2;
             const playerEid = isLocalPlayer1 ? entity1 : entity2;

             console.warn(`Client-side collision detected between local player ${playerEid} and projectile ${projectileEid}. This might indicate an issue if hits are server-authoritative.`);

             // Optionally apply visual feedback or mark projectile for deletion,
             // but do NOT apply damage here. Damage comes from the server.
             markEntityForDeletion(w, projectileEid);
             return;
         }

         // --- Add other collision types if needed (e.g., Player <-> Cube) ---

    });

    return w;
  };
}