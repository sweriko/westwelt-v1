import { defineQuery, hasComponent, addEntity, addComponent } from 'bitecs';
import * as THREE from 'three';
import { Player, LocalPlayer, FPController, Transform, Projectile, Lifespan, MeshRef, Velocity, RigidBodyRef } from '../../components'; // Import required components
import { ECS } from '../../world';
import { InputState } from '../input';
import { WeaponConfig } from '../../config';
import { vec3Pool } from '../../utils/mathUtils'; // Keep for direction calculation

// Removed playerQuery, system now receives eid
// const playerQuery = defineQuery([LocalPlayer, FPController]);

// Server now dictates shoot cooldown, but we keep local tracking for client-side feedback
let prevShoot = false;
let lastShotTime = 0; // Client-side visual feedback delay

export function initPlayerShootSystem(_world: ECS) {
    // Query for either Player or LocalPlayer entities with FPController
    const playerQuery = defineQuery([Player, FPController]);
    const localPlayerQuery = defineQuery([LocalPlayer, FPController]);
    
    // Keep track of the last shooting state to detect button press
    let prevShoot = false;

    return (w: ECS) => {
        const input = w.input as InputState;
        if (!input) return w;

        const now = performance.now();

        // Process both player and localPlayer entities
        // In most cases, entities will have both components
        const entities = new Set([...playerQuery(w), ...localPlayerQuery(w)]);

        for (const eid of entities) {
            // Get player object
            const holder = w.ctx.maps.mesh.get(eid);
            if (!holder) continue;
            
            // Only shoot on button press (not held)
            const shootPressed = input.shoot && !prevShoot;
            
            // Check cooldown - lastShot is stored in player component
            if (shootPressed && now - FPController.lastShot[eid] > WeaponConfig.SHOOT_CD_MS) {
                spawnBullet(w, w.ctx.three.camera, w.ctx.rapier);
                FPController.lastShot[eid] = now;
            }
        }
        
        // Update previous button state
        prevShoot = input.shoot;
        
        return w;
    };
}

// Bullet spawn helper function
function spawnBullet(
    w: ECS, camera: THREE.Camera,
    R: typeof import('@dimforge/rapier3d-compat')
) {
    const { physics, maps } = w.ctx;

    const eid = addEntity(w);
    addComponent(w, Projectile,   eid);
    addComponent(w, Lifespan,     eid);
    addComponent(w, RigidBodyRef, eid);
    addComponent(w, MeshRef,      eid);
    addComponent(w, Transform,    eid);
    addComponent(w, Velocity,     eid);

    Lifespan.ttl[eid]  = WeaponConfig.BULLET_TTL_MS;
    Lifespan.born[eid] = performance.now();

    /* mesh */
    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 8, 8),
        new THREE.MeshStandardMaterial({
            color: 0xff9900, roughness: 0.3, metalness: 0.7,
            emissive: 0xff9900, emissiveIntensity: 0.5
        })
    );
    mesh.castShadow = true;

    // Get direction from camera (reuse vectors)
    const dir = vec3Pool.get();
    camera.getWorldDirection(dir).normalize();
    
    // Get spawn position (reuse vectors)
    const spawn = vec3Pool.get();
    camera.getWorldPosition(spawn).addScaledVector(dir, WeaponConfig.BULLET_SPAWN_DISTANCE);
    
    // Apply to mesh
    mesh.position.copy(spawn);

    // Add to scene
    w.ctx.three.scene.add(mesh);
    maps.mesh.set(eid, mesh);

    /* rigid body */
    // Store velocity for client-side prediction
    Velocity.x[eid] = dir.x * WeaponConfig.BULLET_SPEED;
    Velocity.y[eid] = dir.y * WeaponConfig.BULLET_SPEED;
    Velocity.z[eid] = dir.z * WeaponConfig.BULLET_SPEED;

    // Create a rigid body with CCD enabled to prevent tunneling at high speeds
    const rb = physics.createRigidBody(
        R.RigidBodyDesc.dynamic()
            .setTranslation(spawn.x, spawn.y, spawn.z)
            .setCcdEnabled(true)
            .setLinvel(dir.x * WeaponConfig.BULLET_SPEED, 
                      dir.y * WeaponConfig.BULLET_SPEED, 
                      dir.z * WeaponConfig.BULLET_SPEED)
    );

    // Create a small spherical collider
    physics.createCollider(
        R.ColliderDesc.ball(0.1)
            .setDensity(2.0)
            .setFriction(0.0)
            .setRestitution(0.2),
        rb
    );

    maps.rb.set(eid, rb);
    RigidBodyRef.id[eid] = rb.handle;
    
    // Add to entity handle map for collision detection
    if (w.ctx.entityHandleMap) {
        w.ctx.entityHandleMap.set(rb.handle, eid);
    }
    
    // Release pooled vectors
    vec3Pool.release(dir);
    vec3Pool.release(spawn);
}

/**
 * Creates a physics-based projectile for remote player shots
 * Used by network system when receiving shot events from other players
 */
export function createVisualProjectile(world: ECS, position: THREE.Vector3, direction: THREE.Vector3, color = 0x00aaff): number {
    const eid = addEntity(world);
    addComponent(world, Projectile, eid);
    addComponent(world, Lifespan, eid);
    addComponent(world, MeshRef, eid);
    addComponent(world, Transform, eid);
    addComponent(world, Velocity, eid);
    
    Lifespan.ttl[eid] = WeaponConfig.BULLET_TTL_MS;
    Lifespan.born[eid] = performance.now();
    
    Transform.x[eid] = position.x;
    Transform.y[eid] = position.y;
    Transform.z[eid] = position.z;
    Transform.qx[eid] = 0; Transform.qy[eid] = 0; Transform.qz[eid] = 0; Transform.qw[eid] = 1;
    
    Velocity.x[eid] = direction.x * WeaponConfig.BULLET_SPEED;
    Velocity.y[eid] = direction.y * WeaponConfig.BULLET_SPEED;
    Velocity.z[eid] = direction.z * WeaponConfig.BULLET_SPEED;
    
    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 8, 8),
        new THREE.MeshBasicMaterial({ color })
    );
    mesh.position.copy(position);
    world.ctx.three.scene.add(mesh);
    world.ctx.maps.mesh.set(eid, mesh);
    
    return eid;
}