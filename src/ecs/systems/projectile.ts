import { defineQuery, hasComponent, removeEntity } from 'bitecs';
import { Lifespan, Projectile, Velocity, Transform, MeshRef } from '../components'; // Added Velocity, Transform, MeshRef
import { ECS } from '../world';
import * as THREE from 'three';

export function initProjectileSystem(_world: ECS) {
  const projectileQuery = defineQuery([Projectile, Lifespan, Velocity, Transform, MeshRef]);

  return (w: ECS) => {
    const now = performance.now();
    const delta = w.time.dt; // Use world delta time

    const entitiesToRemove: number[] = [];

    for (const eid of projectileQuery(w)) {
        // --- Simple Kinematic Movement ---
        Transform.x[eid] += Velocity.x[eid] * delta;
        Transform.y[eid] += Velocity.y[eid] * delta;
        Transform.z[eid] += Velocity.z[eid] * delta;

        // Sync mesh position with Transform
        const mesh = w.ctx.maps.mesh.get(eid);
        if (mesh) {
            mesh.position.set(Transform.x[eid], Transform.y[eid], Transform.z[eid]);
        }

        // --- Check Lifespan ---
        if (now - Lifespan.born[eid] > Lifespan.ttl[eid]) {
            entitiesToRemove.push(eid);
        }

        // --- Check for Deletion Flag (from potential client-side collision effects) ---
        // Note: Authoritative collision comes from server now.
        // This flag might be set by local effects if desired.
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

        // Remove Rapier body if it existed (shouldn't for visual bullets)
        const rb = w.ctx.maps.rb.get(eid);
        if (rb) {
            console.warn(`Removing unexpected RigidBody for visual projectile ${eid}`);
            w.ctx.physics.removeRigidBody(rb);
            w.ctx.maps.rb.delete(eid);
        }

        // Remove the entity if it still exists
         if (hasComponent(w, Projectile, eid)) {
            removeEntity(w, eid);
         }
    }

    return w;
  };
}