/**
 * Player shooting system - handles weapon firing
 */
import { addComponent, addEntity, defineQuery } from 'bitecs';
import * as THREE from 'three';
import { Player, FPController, Projectile, Lifespan, Velocity, MeshRef, RigidBodyRef, Transform } from '../../components';
import { ECS } from '../../world';
import { InputState } from '../input';
import { vec3Pool } from '../../utils/mathUtils';
import { WeaponConfig } from '../../config';

export function initPlayerShootSystem(_world: ECS) {
  const playerQuery = defineQuery([Player, FPController]);
  
  // Track the previous shoot state to detect start of shooting
  let prevShoot = false;

  return (w: ECS) => {
    const input = w.input as InputState;
    // Input check removed - initInputSystem is guaranteed to run first
    
    const now = performance.now();
    
    for (const eid of playerQuery(w)) {
      // Detect shoot button pressed (not held)
      const shootStart = input.shoot && !prevShoot;
      
      if (shootStart && now - FPController.lastShot[eid] > WeaponConfig.SHOOT_CD_MS) {
        spawnBullet(w, w.ctx.three.camera, w.ctx.rapier);
        FPController.lastShot[eid] = now;
      }
    }
    
    // Store shoot state for next frame
    prevShoot = input.shoot;
    
    return w;
  };
}

/* bullet helper ---------------------------------------------------- */
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
  // Velocity component is for future client-side prediction
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
  
  // Release pooled vectors
  vec3Pool.release(dir);
  vec3Pool.release(spawn);
} 