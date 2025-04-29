import { defineQuery, addComponent, addEntity, hasComponent } from 'bitecs';
import { Projectile, CubeTag, RigidBodyRef, CollisionEvent } from '../components';
import { ECS } from '../world';
import { vec3Pool, createEntityPairKey } from '../utils/mathUtils';
import { PhysicsConfig } from '../config';

export function initCollisionSystem(world: ECS) {
  const projectileQuery = defineQuery([Projectile, RigidBodyRef]);
  const cubeQuery = defineQuery([CubeTag, RigidBodyRef]);
  
  // Last processed collision time to avoid duplicates
  const processedCollisions = new Map<bigint, number>();
  
  // Cache of rigid body handles to entity IDs
  // Initialize entity handle mapping
  if (!world.ctx.entityHandleMap) {
    world.ctx.entityHandleMap = new Map<number, number>();
  }
  
  // Helper to mark entities for deletion outside the hot collision loop
  function markEntityForDeletion(eid: number) {
    const mesh = world.ctx.maps.mesh.get(eid);
    if (mesh) {
      if (!mesh.userData) mesh.userData = {};
      mesh.userData.markedForDeletion = true;
    }
  }
  
  return (w: ECS) => {
    const now = performance.now();
    
    // Clean up old processed collisions (older than 200ms)
    for (const [key, time] of processedCollisions.entries()) {
      if (now - time > 200) {
        processedCollisions.delete(key);
      }
    }
    
    // Skip if no event queue is available
    if (!w.ctx.eventQueue) {
      return w;
    }
    
    // Cache query results once per tick
    const projectiles = projectileQuery(w);
    const cubes = cubeQuery(w);
    
    // Update entity handle map for any new entities
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
      // We only care about collision starts
      if (!started) return;
      
      // Get entity IDs from rigid body handles
      const entity1 = w.ctx.entityHandleMap!.get(handle1);
      const entity2 = w.ctx.entityHandleMap!.get(handle2);
      
      if (!entity1 || !entity2) return;
      
      // Use hasComponent for O(1) lookups instead of array.includes()
      const isProjectile1 = hasComponent(w, Projectile, entity1);
      const isProjectile2 = hasComponent(w, Projectile, entity2);
      const isCube1 = hasComponent(w, CubeTag, entity1);
      const isCube2 = hasComponent(w, CubeTag, entity2);
      
      // Skip if not a projectile-cube collision
      if (!((isProjectile1 && isCube2) || (isProjectile2 && isCube1))) {
        return;
      }
      
      // Determine which is which
      const projectileEid = isProjectile1 ? entity1 : entity2;
      const cubeEid = isCube1 ? entity1 : entity2;
      
      // Create a unique ID for this collision using BigInt
      const collisionId = createEntityPairKey(projectileEid, cubeEid);
      
      // Skip if we've already processed this collision recently
      if (processedCollisions.has(collisionId)) return;
      
      // Mark collision as processed
      processedCollisions.set(collisionId, now);
      
      // Get the cube and projectile rigid bodies
      const cubeRB = w.ctx.maps.rb.get(cubeEid);
      const projectileRB = w.ctx.maps.rb.get(projectileEid);
      
      if (!cubeRB || !projectileRB) return;
      
      // Calculate impact direction - from bullet to cube center
      const bulletPos = projectileRB.translation();
      const cubePos = cubeRB.translation();
      
      // Direction vector from bullet to cube center (where to push the cube)
      // Use pooled vector
      const impactDir = vec3Pool.get().set(
        cubePos.x - bulletPos.x,
        cubePos.y - bulletPos.y,
        cubePos.z - bulletPos.z
      ).normalize();
      
      // If direction is zero (e.g., direct center hit), use reversed bullet velocity
      if (impactDir.lengthSq() < 0.001) {
        const vel = projectileRB.linvel();
        impactDir.set(-vel.x, -vel.y, -vel.z).normalize();
      }
      
      // Apply impulse force at contact point in direction from bullet to cube
      cubeRB.applyImpulseAtPoint(
        { 
          x: impactDir.x * PhysicsConfig.IMPACT_FORCE, 
          y: impactDir.y * PhysicsConfig.IMPACT_FORCE, 
          z: impactDir.z * PhysicsConfig.IMPACT_FORCE 
        },
        {
          x: bulletPos.x,
          y: bulletPos.y,
          z: bulletPos.z
        },
        true
      );
      
      // Add some random torque for realistic effect
      cubeRB.applyTorqueImpulse(
        {
          x: (Math.random() - 0.5) * PhysicsConfig.IMPACT_FORCE * 0.3,
          y: (Math.random() - 0.5) * PhysicsConfig.IMPACT_FORCE * 0.3,
          z: (Math.random() - 0.5) * PhysicsConfig.IMPACT_FORCE * 0.3
        },
        true
      );
      
      // Create a collision event entity
      const eventEid = addEntity(w);
      addComponent(w, CollisionEvent, eventEid);
      CollisionEvent.entity1[eventEid] = projectileEid;
      CollisionEvent.entity2[eventEid] = cubeEid;
      CollisionEvent.impulse[eventEid] = PhysicsConfig.IMPACT_FORCE;
      CollisionEvent.time[eventEid] = now;
      
      // Mark projectile for destruction
      markEntityForDeletion(projectileEid);
      
      // Release pooled vector
      vec3Pool.release(impactDir);
    });
    
    return w;
  };
} 