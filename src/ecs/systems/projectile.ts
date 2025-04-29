import { defineQuery, removeEntity } from 'bitecs';
import { Lifespan, Projectile } from '../components';
import { ECS } from '../world';
import * as THREE from 'three';

export function initProjectileSystem(_world: ECS) {
  const projectileQuery = defineQuery([Projectile, Lifespan]);
  
  return (w: ECS) => {
    const now = performance.now();
    
    // Create a list of entities to remove to avoid modifying during iteration
    const entitiesToRemove: number[] = [];
    
    // Process bullet lifetimes and handle destruction
    for (const eid of projectileQuery(w)) {
      // Skip processing if already marked for removal
      if (entitiesToRemove.includes(eid)) continue;
      
      // Get rigid body reference
      const rb = w.ctx.maps.rb.get(eid);
      if (!rb) {
        // Body reference invalid, mark for removal
        entitiesToRemove.push(eid);
        continue;
      }
      
      // Skip if body is no longer valid (prevents "unreachable" errors)
      try {
        // Just check if we can access a property - will throw if body is invalid
        rb.handle;
      } catch (error) {
        // Something's wrong with this rigid body, mark for removal
        console.warn("Invalid rigid body detected, removing entity", eid);
        entitiesToRemove.push(eid);
        continue;
      }
      
      // Check if bullet should be removed due to lifetime
      const expired = now - Lifespan.born[eid] > Lifespan.ttl[eid];
      
      // Check if bullet was marked for deletion by collision system
      const mesh = w.ctx.maps.mesh.get(eid);
      const markedForDeletion = mesh?.userData?.markedForDeletion === true;
      
      // Mark for removal if expired or deletion requested
      if (expired || markedForDeletion) {
        entitiesToRemove.push(eid);
      }
    }
    
    // Remove all entities marked for deletion
    for (const eid of entitiesToRemove) {
      // Get and remove the mesh
      const mesh = w.ctx.maps.mesh.get(eid);
      if (mesh) {
        w.ctx.three.scene.remove(mesh);
        
        // Properly cast to THREE.Mesh to access geometry and material
        if (mesh instanceof THREE.Mesh) {
          if (mesh.geometry) {
            mesh.geometry.dispose();
          }
          
          if (mesh.material) {
            // Handle both single and array materials
            if (Array.isArray(mesh.material)) {
              mesh.material.forEach(material => {
                if (material) material.dispose();
              });
            } else {
              mesh.material.dispose();
            }
          }
        }
        
        w.ctx.maps.mesh.delete(eid);
      }
      
      // Get and remove the rigid body
      const rb = w.ctx.maps.rb.get(eid);
      if (rb) {
        w.ctx.physics.removeRigidBody(rb);
        w.ctx.maps.rb.delete(eid);
      }
      
      // Remove the entity
      removeEntity(w, eid);
    }
    
    return w;
  };
}
