import { defineQuery } from 'bitecs';
import { DebugVis, Projectile, Player, RigidBodyRef } from '../components';
import { ECS } from '../world';
import * as THREE from 'three';
import { vec3Pool } from '../utils/mathUtils';

// Maximum number of points in trajectory
const MAX_TRAJECTORY_POINTS = 100;

export function initDebugVisSystem(world: ECS) {
  const debugQuery = defineQuery([DebugVis]);
  const playerQuery = defineQuery([Player, RigidBodyRef]);
  const projectileQuery = defineQuery([Projectile, RigidBodyRef]);
  
  // Store trajectory data
  const trajectoryLines = new Map<number, THREE.Line>();
  const trajectories = new Map<number, {
    count: number,  // Current number of points
    maxCount: number  // Maximum capacity
  }>();
  
  // Store pre-allocated buffers to avoid creating new ones each frame
  const positionBuffers = new Map<number, {
    array: Float32Array,
    attribute: THREE.BufferAttribute
  }>();
  
  // Shared line material for all trajectories
  const lineMaterial = new THREE.LineBasicMaterial({ 
    color: 0xff9900, 
    transparent: true, 
    opacity: 0.7 
  });
  
  // Create player capsule mesh for debug
  let playerCapsule: THREE.Mesh | null = null;
  
  // Create a simple cylinder geometry
  const createCylinderGeometry = (radius: number, height: number, widthSegments = 16): THREE.BufferGeometry => {
    // Create cylinder body
    return new THREE.CylinderGeometry(
      radius, radius, height - radius * 2, widthSegments, 1, true
    );
  };
  
  // Initialize the debug capsule and materials
  const wireframeMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    wireframe: true,
    transparent: true,
    opacity: 0.7
  });
  
  // Create the capsule mesh once at initialization
  const capsuleGeometry = createCylinderGeometry(0.3, 1.8, 16);
  playerCapsule = new THREE.Mesh(capsuleGeometry, wireframeMaterial);
  world.ctx.three.scene.add(playerCapsule);
  playerCapsule.visible = false; // Hidden by default
  
  return (w: ECS) => {
    // First check if debug visualization is enabled
    const debugEnts = debugQuery(w);
    const debugId = debugEnts.length > 0 ? debugEnts[0] : -1;
    const debugActive = debugId !== -1 && DebugVis.active[debugId] === 1;
    
    // Update player capsule visibility and position
    if (playerCapsule) {
      playerCapsule.visible = debugActive;
      
      // Update position if visible
      if (debugActive) {
        const playerEnts = playerQuery(w);
        if (playerEnts.length > 0) {
          const playerEid = playerEnts[0];
          const playerObj = w.ctx.maps.mesh.get(playerEid);
          if (playerObj) {
            playerCapsule.position.copy(playerObj.position);
            playerCapsule.position.y -= 0.3; // Adjust to match center of capsule
            playerCapsule.rotation.y = playerObj.rotation.y;
          }
        }
      }
    }
    
    // Update projectile trajectories
    for (const projectileEid of projectileQuery(w)) {
      // Get current position for this projectile
      const rb = w.ctx.maps.rb.get(projectileEid);
      if (!rb) continue;
      
      // Get position and add to trajectory
      const pos = rb.translation();
      const currentPos = vec3Pool.get().set(pos.x, pos.y, pos.z);
      
      // Initialize trajectory and buffer if needed
      if (!trajectories.has(projectileEid)) {
        // Create trajectory tracking object
        trajectories.set(projectileEid, {
          count: 0,
          maxCount: MAX_TRAJECTORY_POINTS
        });
        
        // Pre-allocate the Float32Array with maximum size
        const posArray = new Float32Array(MAX_TRAJECTORY_POINTS * 3);
        const posAttribute = new THREE.BufferAttribute(posArray, 3);
        positionBuffers.set(projectileEid, {
          array: posArray,
          attribute: posAttribute
        });
      }
      
      // Get the trajectory data
      const trajectory = trajectories.get(projectileEid)!;
      // Get the buffer
      const buffer = positionBuffers.get(projectileEid)!;
      
      // Add current position directly to the buffer
      if (trajectory.count < MAX_TRAJECTORY_POINTS) {
        // We have room, add at the end
        const idx = trajectory.count * 3;
        buffer.array[idx] = currentPos.x;
        buffer.array[idx + 1] = currentPos.y;
        buffer.array[idx + 2] = currentPos.z;
        trajectory.count++;
      } else {
        // Shift all points one position back using copyWithin (much faster than loop)
        buffer.array.copyWithin(0, 3);
        
        // Add new point at the end
        const idx = (trajectory.count - 1) * 3;
        buffer.array[idx] = currentPos.x;
        buffer.array[idx + 1] = currentPos.y;
        buffer.array[idx + 2] = currentPos.z;
      }
      
      // Mark buffer for update
      buffer.attribute.needsUpdate = true;
      
      // Release the pooled vector
      vec3Pool.release(currentPos);
      
      // Only update/show trajectory lines if debug is active
      if (debugActive) {
        if (trajectoryLines.has(projectileEid)) {
          // Update existing line - reuse the geometry
          const line = trajectoryLines.get(projectileEid)!;
          line.visible = true;
          
          // Get the pre-allocated buffer and update it
          const buffer = positionBuffers.get(projectileEid)!;
          
          // Update geometry to draw only the current points
          line.geometry.setDrawRange(0, trajectory.count);
          buffer.attribute.needsUpdate = true;
        } else {
          // Create new line with dynamic buffer geometry
          const geometry = new THREE.BufferGeometry();
          const buffer = positionBuffers.get(projectileEid)!;
          
          // Add attribute to geometry
          geometry.setAttribute('position', buffer.attribute);
          
          // Set initial draw range
          geometry.setDrawRange(0, trajectory.count);
          
          // Use the shared material
          const line = new THREE.Line(geometry, lineMaterial);
          trajectoryLines.set(projectileEid, line);
          w.ctx.three.scene.add(line);
        }
      } else {
        // Hide lines if debug is disabled
        if (trajectoryLines.has(projectileEid)) {
          trajectoryLines.get(projectileEid)!.visible = false;
        }
      }
    }
    
    // Clean up trajectories for removed projectiles
    for (const [eid, line] of trajectoryLines.entries()) {
      const projectileExists = projectileQuery(w).includes(eid);
      
      // Check if projectile is marked for deletion
      const mesh = w.ctx.maps.mesh.get(eid);
      const markedForDeletion = mesh?.userData?.markedForDeletion === true;
      
      if (!projectileExists || markedForDeletion) {
        // Remove the trajectory line
        w.ctx.three.scene.remove(line);
        line.geometry.dispose();
        if (line.material instanceof THREE.Material) {
          line.material.dispose();
        } else if (Array.isArray(line.material)) {
          line.material.forEach(mat => mat.dispose());
        }
        trajectoryLines.delete(eid);
        trajectories.delete(eid);
        positionBuffers.delete(eid);
      }
    }
    
    return w;
  };
} 