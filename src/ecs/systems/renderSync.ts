import { defineQuery, hasComponent, exitQuery } from 'bitecs';
import { ECS } from '../world';
import {
  MeshRef, RigidBodyRef, Transform, LocalPlayer, RemotePlayer, InterpolationTarget // Added RemotePlayer, InterpolationTarget
} from '../components';
import { vec3Pool, quatPool, interpolatePositions, interpolateRotations } from '../utils/mathUtils';
import * as THREE from 'three'; // Import THREE

export function initRenderSyncSystem(_world: ECS) {
    const localPlayerQuery = defineQuery([LocalPlayer, MeshRef, RigidBodyRef]);
    const remotePlayerQuery = defineQuery([RemotePlayer, MeshRef, InterpolationTarget, Transform]); // Remote players use InterpolationTarget & Transform
    const otherRbQuery = defineQuery([MeshRef, RigidBodyRef]); // Query for non-player rigid bodies
    const allMeshQuery = defineQuery([MeshRef]); // For cleanup

    const exitMeshQuery = exitQuery(allMeshQuery);

    // Storage for interpolation - keyed by Entity ID
    const interpolationData = new Map<number, {
        prevPos: THREE.Vector3;
        prevRot: THREE.Quaternion;
        prevTimestamp: number;
    }>();

    // Reusable THREE objects
    const currentPos = new THREE.Vector3();
    const currentRot = new THREE.Quaternion();
    const targetPos = new THREE.Vector3();
    const targetRot = new THREE.Quaternion();


    return (w: ECS) => {
        const now = Date.now(); // Current render time

        // --- Cleanup exited entities ---
        for (const eid of exitMeshQuery(w)) {
            interpolationData.delete(eid);
            // Note: Mesh and RB removal is handled elsewhere (e.g., projectileSystem, networkSystem)
        }

        // --- Sync Local Player ---
        // Local player's visual mesh should follow the *kinematic* rigid body
        const localPlayers = localPlayerQuery(w);
        if (localPlayers.length > 0) {
            const eid = localPlayers[0];
            const mesh = w.ctx.maps.mesh.get(eid)!;
            const rb = w.ctx.maps.rb.get(eid);
            if (mesh && rb) {
                 // Get the *current* (potentially interpolated by Rapier) kinematic position
                 const p = rb.translation();
                 // Rotation comes from the Transform component updated by look system
                 const r = { x: Transform.qx[eid], y: Transform.qy[eid], z: Transform.qz[eid], w: Transform.qw[eid] };

                 mesh.position.set(p.x, p.y, p.z);
                 mesh.quaternion.set(r.x, r.y, r.z, r.w);
            }
        }


        // --- Sync and Interpolate Remote Players ---
        const remoteEntities = remotePlayerQuery(w);
        for (const eid of remoteEntities) {
            const mesh = w.ctx.maps.mesh.get(eid)!;
            if (!mesh) continue;

            // Get target state from InterpolationTarget component
            targetPos.set(InterpolationTarget.targetX[eid], InterpolationTarget.targetY[eid], InterpolationTarget.targetZ[eid]);
            targetRot.set(InterpolationTarget.targetQX[eid], InterpolationTarget.targetQY[eid], InterpolationTarget.targetQZ[eid], InterpolationTarget.targetQW[eid]);
            const targetTimestamp = InterpolationTarget.timestamp[eid];

             // Get current state from Transform component (this is the *visual* state)
             currentPos.set(Transform.x[eid], Transform.y[eid], Transform.z[eid]);
             currentRot.set(Transform.qx[eid], Transform.qy[eid], Transform.qz[eid], Transform.qw[eid]);


            // Simple Lerp for now - replace with time-based interpolation later
            const lerpFactor = 0.2; // Adjust for smoothness
            currentPos.lerp(targetPos, lerpFactor);
            currentRot.slerp(targetRot, lerpFactor);


            // Update the Transform component with the interpolated visual state
            Transform.x[eid] = currentPos.x;
            Transform.y[eid] = currentPos.y;
            Transform.z[eid] = currentPos.z;
            Transform.qx[eid] = currentRot.x;
            Transform.qy[eid] = currentRot.y;
            Transform.qz[eid] = currentRot.z;
            Transform.qw[eid] = currentRot.w;

            // Apply interpolated state to the mesh
            mesh.position.copy(currentPos);
            mesh.quaternion.copy(currentRot);

             // Update animation mixer if it exists on the mesh
             const animData = mesh.userData; // Assuming mixer is stored in userData
             if (animData?.mixer) {
                 animData.mixer.update(w.time.dt);
             }
        }


        // --- Sync Other Rigid Bodies (Cubes, etc.) ---
        const otherRbEntities = otherRbQuery(w);
        for (const eid of otherRbEntities) {
            // Skip if it's a player (handled above)
            if (hasComponent(w, LocalPlayer, eid) || hasComponent(w, RemotePlayer, eid)) continue;

            const mesh = w.ctx.maps.mesh.get(eid)!;
            const rb = w.ctx.maps.rb.get(eid);
            if (!mesh || !rb) continue;

             // Read directly from Rapier body for dynamic objects
             const p = rb.translation();
             const r = rb.rotation();

             // Apply directly to mesh (or use interpolation if desired)
             mesh.position.set(p.x, p.y, p.z);
             mesh.quaternion.set(r.x, r.y, r.z, r.w);

             // Update Transform component for consistency (optional for non-player RB)
             Transform.x[eid] = p.x; Transform.y[eid] = p.y; Transform.z[eid] = p.z;
             Transform.qx[eid] = r.x; Transform.qy[eid] = r.y; Transform.qz[eid] = r.z; Transform.qw[eid] = r.w;
        }

        // --- Update Transform for non-RB Meshes (if any) ---
         // This part remains the same as before, handling meshes without RBs
         for (const eid of allMeshQuery(w)) {
             if (hasComponent(w, RigidBodyRef, eid) || hasComponent(w, LocalPlayer, eid) || hasComponent(w, RemotePlayer, eid)) continue;

             const mesh = w.ctx.maps.mesh.get(eid)!;
             if (!mesh) continue;

             mesh.getWorldPosition(currentPos);
             mesh.getWorldQuaternion(currentRot);

             Transform.x[eid] = currentPos.x; Transform.y[eid] = currentPos.y; Transform.z[eid] = currentPos.z;
             Transform.qx[eid] = currentRot.x; Transform.qy[eid] = currentRot.y; Transform.qz[eid] = currentRot.z; Transform.qw[eid] = currentRot.w;
         }


        return w;
    };
}