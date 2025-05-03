import { defineQuery, hasComponent } from 'bitecs';
import * as THREE from 'three';
import { LocalPlayer, FPController, Transform } from '../../components'; // Added Transform
import { ECS } from '../../world';
import { InputState } from '../input';
import { PlayerConfig } from '../../config';

// Removed playerQuery, system now receives eid
// const playerQuery = defineQuery([LocalPlayer, FPController, Transform]);

export function initPlayerLookSystem(_world: ECS) {

    // Use temporary quaternion for calculations
    const deltaRotation = new THREE.Quaternion();
    const currentRotation = new THREE.Quaternion();
    const pitchQuat = new THREE.Quaternion();
    const yawQuat = new THREE.Quaternion();
    const forward = new THREE.Vector3(0, 0, -1);
    const worldUp = new THREE.Vector3(0, 1, 0);


    // System now receives world and the specific local player eid
    return (w: ECS, eid: number) => {
        const input = w.input as InputState;
        if (!input) return w;

        // Skip if pointer isn't locked or no mouse movement
        if (!input.pointerLocked || (input.dx === 0 && input.dy === 0)) {
             input.dx = input.dy = 0; // Still reset deltas
             return w;
        }

        // --- Process only the local player entity 'eid' ---
        const holder = w.ctx.maps.mesh.get(eid); // Get the Object3D holder
        if (!holder) return w;

        // --- Yaw (Horizontal Rotation) - Applied to the holder/RigidBody/Transform ---
        const yawAngle = -input.dx * PlayerConfig.MOUSE_SENSITIVITY;
        yawQuat.setFromAxisAngle(worldUp, yawAngle);

        // Get current rotation from Transform component
        currentRotation.set(Transform.qx[eid], Transform.qy[eid], Transform.qz[eid], Transform.qw[eid]);

        // Apply yaw to the current rotation
        currentRotation.multiplyQuaternions(yawQuat, currentRotation); // Yaw multiplies from the left for world Y rotation
        currentRotation.normalize();

        // Update Transform component with new rotation
        Transform.qx[eid] = currentRotation.x;
        Transform.qy[eid] = currentRotation.y;
        Transform.qz[eid] = currentRotation.z;
        Transform.qw[eid] = currentRotation.w;

         // Apply yaw rotation directly to the Object3D holder for immediate visual feedback
         // This might be slightly redundant if RenderSync handles it, but helps responsiveness.
         // Ensure holder.rotation is updated if RenderSync relies on it.
         // holder.quaternion.copy(currentRotation); // Or let RenderSync handle this from Transform

        // --- Pitch (Vertical Rotation) - Applied only to the camera ---
        const currentPitch = FPController.pitch[eid];
        let newPitch = currentPitch - input.dy * PlayerConfig.MOUSE_SENSITIVITY;
        newPitch = THREE.MathUtils.clamp(newPitch, -Math.PI / 2 * 0.99, Math.PI / 2 * 0.99); // Clamp pitch

        // Update pitch in FPController component
        FPController.pitch[eid] = newPitch;

        // Apply pitch directly to the camera object
        const camera = w.ctx.three.camera;
        if (camera) {
             // We rotate camera locally around its X axis
            pitchQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), newPitch);
            camera.quaternion.copy(pitchQuat); // Set camera's local rotation
        }

        // Reset mouse deltas after processing
        input.dx = input.dy = 0;

        return w;
    };
}