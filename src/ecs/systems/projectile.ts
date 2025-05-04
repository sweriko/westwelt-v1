import { defineQuery, hasComponent, removeEntity } from 'bitecs';
import { Lifespan, Projectile, Velocity, Transform, MeshRef, RigidBodyRef } from '../components';
import { ECS } from '../world';
import * as THREE from 'three';

export function initProjectileSystem(_world: ECS) {
  // Query for all projectiles, whether physics-based or visual-only
  const projectileQuery = defineQuery([Projectile, Lifespan]);
  
  // Separate query for visual-only projectiles (those without RigidBody)
  const visualProjectileQuery = defineQuery([Projectile, Lifespan, Velocity, Transform, MeshRef]);
  const physicsProjectileQuery = defineQuery([Projectile, Lifespan, RigidBodyRef]);

  return (w: ECS) => {
    const now = performance.now();
    const delta = w.time.dt; // Use world delta time

    const entitiesToRemove: number[] = [];

    // First update visual-only projectiles with simple kinematic movement
    for (const eid of visualProjectileQuery(w)) {
      // Skip if entity already has a RigidBody (will be handled by physics system)
      if (hasComponent(w, RigidBodyRef, eid)) continue;
      
      // --- Simple Kinematic Movement ---
      Transform.x[eid] += Velocity.x[eid] * delta;
      Transform.y[eid] += Velocity.y[eid] * delta;
      Transform.z[eid] += Velocity.z[eid] * delta;

      // Sync mesh position with Transform
      const mesh = w.ctx.maps.mesh.get(eid);
      if (mesh) {
        mesh.position.set(Transform.x[eid], Transform.y[eid], Transform.z[eid]);
      }
    }

    // Check all projectiles for lifespan and deletion flags
    for (const eid of projectileQuery(w)) {
      // --- Check Lifespan ---
      if (now - Lifespan.born[eid] > Lifespan.ttl[eid]) {
        entitiesToRemove.push(eid);
        continue;
      }

      // --- Check for Deletion Flag (from collision detection) ---
      const mesh = w.ctx.maps.mesh.get(eid);
      if (mesh?.userData?.markedForDeletion === true) {
        if (!entitiesToRemove.includes(eid)) { // Avoid duplicates
          entitiesToRemove.push(eid);
        }
      }
    }

    // --- Remove Entities ---
    for (const eid of entitiesToRemove) {
      // Get and remove the mesh
      const mesh = w.ctx.maps.mesh.get(eid);
      if (mesh) {
        w.ctx.three.scene.remove(mesh);
        if (mesh instanceof THREE.Mesh) {
          mesh.geometry?.dispose();
          if (mesh.material) {
            if (Array.isArray(mesh.material)) {
              mesh.material.forEach(material => material?.dispose());
            } else {
              mesh.material.dispose();
            }
          }
        }
        w.ctx.maps.mesh.delete(eid);
      }

      // Remove Rapier body if it exists
      const rb = w.ctx.maps.rb.get(eid);
      if (rb) {
        w.ctx.physics.removeRigidBody(rb);
        w.ctx.maps.rb.delete(eid);
        
        // Also remove from entity handle map if it exists
        if (w.ctx.entityHandleMap) {
          // Search for this entity's handle
          for (const [handle, entityId] of w.ctx.entityHandleMap.entries()) {
            if (entityId === eid) {
              w.ctx.entityHandleMap.delete(handle);
              break;
            }
          }
        }
      }

      // Remove the entity if it still exists
      if (hasComponent(w, Projectile, eid)) {
        removeEntity(w, eid);
      }
    }

    return w;
  };
}