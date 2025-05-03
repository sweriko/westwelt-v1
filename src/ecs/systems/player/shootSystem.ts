import { defineQuery, hasComponent, addEntity, addComponent } from 'bitecs';
import * as THREE from 'three';
import { LocalPlayer, FPController, Transform, Projectile, Lifespan, MeshRef, Velocity } from '../../components'; // Import required components
import { ECS } from '../../world';
import { InputState } from '../input';
import { network } from '../network/client'; // Import network client
import { WeaponConfig } from '../../config';
import { vec3Pool } from '../../utils/mathUtils'; // Keep for direction calculation

// Removed playerQuery, system now receives eid
// const playerQuery = defineQuery([LocalPlayer, FPController]);

// Server now dictates shoot cooldown, remove client-side tracking?
// Keeping prevShoot for detecting button press vs hold
let prevShoot = false;
let lastShotTime = 0; // Use a local timestamp for basic client-side feedback delay if needed

export function initPlayerShootSystem(_world: ECS) {

    // System now receives world and the specific local player eid
    return (w: ECS, eid: number) => {
        const input = w.input as InputState;
        if (!input) return w;

        const now = performance.now();

        // --- Process only the local player entity 'eid' ---
        const shootStart = input.shoot && !prevShoot;

        // Simple client-side cooldown visual feedback (optional, server is authoritative)
        const clientSideCooldown = 200; // ms, match WeaponConfig? Or make slightly shorter
        if (shootStart && now - lastShotTime > clientSideCooldown) {
             // Get camera for shoot direction
            const camera = w.ctx.three.camera;
            if (!camera) return w; // Should not happen

            // Get direction and spawn position
            const dir = vec3Pool.get();
            const spawnPos = vec3Pool.get();

            camera.getWorldDirection(dir).normalize();
            // Spawn slightly in front of camera, aligned with view
            camera.getWorldPosition(spawnPos).addScaledVector(dir, WeaponConfig.BULLET_SPAWN_DISTANCE);


            console.log(`Local player ${w.ctx.localPlayerId} shooting.`);
            // Send shoot message to the server
            network.send({
                type: 'shoot',
                position: { x: spawnPos.x, y: spawnPos.y, z: spawnPos.z },
                direction: { x: dir.x, y: dir.y, z: dir.z }
            });

            // --- Spawn Local Projectile ---
            // Create a real projectile with physics and proper lifetime
            spawnProjectile(w, spawnPos, dir);

            lastShotTime = now; // Update client-side timer

            vec3Pool.release(dir);
            vec3Pool.release(spawnPos);
        }

        prevShoot = input.shoot;

        return w;
    };
}


// Helper to spawn a real projectile with physics
function spawnProjectile(world: ECS, position: THREE.Vector3, direction: THREE.Vector3) {
    const eid = addEntity(world);
    addComponent(world, Projectile, eid);
    addComponent(world, Lifespan, eid);
    addComponent(world, MeshRef, eid);
    addComponent(world, Transform, eid);
    addComponent(world, Velocity, eid);
    
    // Setup lifespan
    Lifespan.ttl[eid] = WeaponConfig.BULLET_TTL_MS;
    Lifespan.born[eid] = performance.now();
    
    // Setup transform
    Transform.x[eid] = position.x;
    Transform.y[eid] = position.y;
    Transform.z[eid] = position.z;
    Transform.qx[eid] = 0; Transform.qy[eid] = 0; Transform.qz[eid] = 0; Transform.qw[eid] = 1;
    
    // Setup velocity
    Velocity.x[eid] = direction.x * WeaponConfig.BULLET_SPEED;
    Velocity.y[eid] = direction.y * WeaponConfig.BULLET_SPEED;
    Velocity.z[eid] = direction.z * WeaponConfig.BULLET_SPEED;
    
    // Create visual mesh
    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xff4400 })
    );
    mesh.position.copy(position);
    world.ctx.three.scene.add(mesh);
    world.ctx.maps.mesh.set(eid, mesh);
    
    return eid;
}