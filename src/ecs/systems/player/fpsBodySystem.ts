/**
 * Simplified FPS Full Body Camera System
 */
import { defineQuery } from 'bitecs';
import * as THREE from 'three';
import { Player, LocalPlayer, FPController, MeshRef } from '../../components';
import { ECS } from '../../world';

// Simplified settings for FPS body camera system
export const FPSBodySettings = {
  // Camera position relative to head
  CAMERA_OFFSET: new THREE.Vector3(0, 16, 33),
  
  // Debug visualization
  DEBUG_VISUALIZATION: false,
};

export function initFPSBodySystem(world: ECS) {
  // Query for player entities
  const localPlayerQuery = defineQuery([LocalPlayer, FPController, MeshRef]);
  const playerQuery = defineQuery([Player, FPController, MeshRef]);
  
  // Reference objects
  let playerModel: THREE.Group | null = null;
  let skeletonHelper: THREE.SkeletonHelper | null = null;
  let headBone: THREE.Bone | null = null;
  
  // Camera holder
  let cameraHolder: THREE.Object3D | null = null;
  
  // Current state
  let isSetup = false;
  
  // Add event listener for settings changes
  document.addEventListener('fps-settings-changed', () => {
    if (cameraHolder && isSetup) {
      // Update camera position from settings
      cameraHolder.position.copy(FPSBodySettings.CAMERA_OFFSET);
      console.log('FPS camera settings updated');
    }
  });
  
  // Setup function - called when player model is loaded and ready
  function setupFPSBody(w: ECS, playerEntity: number) {
    if (isSetup) return;
    
    const holder = w.ctx.maps.mesh.get(playerEntity);
    if (!holder) return;
    
    // Find the player model
    holder.traverse((child) => {
      if (child.type === 'Group' && child.children.length > 0) {
        playerModel = child as THREE.Group;
      }
    });
    
    if (!playerModel) {
      console.log("Player model not found, waiting...");
      return;
    }
    
    // Create camera holder
    cameraHolder = new THREE.Object3D();
    cameraHolder.name = "fpsBodyCameraHolder";
    
    // Find head bone
    playerModel.traverse((object) => {
      if (object instanceof THREE.Bone) {
        // Find head bone
        if (object.name === 'mixamorigHead') {
          headBone = object;
        }
        
        if (FPSBodySettings.DEBUG_VISUALIZATION) {
          // Add tiny markers to visualize bone positions
          const marker = new THREE.Mesh(
            new THREE.SphereGeometry(0.02, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0xff0000 })
          );
          object.add(marker);
        }
      }
    });
    
    // If we found the head bone, set up the camera
    if (headBone) {
      // Attach camera holder to head bone
      headBone.add(cameraHolder);
      
      // Position the camera holder at the eye position
      cameraHolder.position.copy(FPSBodySettings.CAMERA_OFFSET);
      
      // Add skeleton helper for debug visualization
      if (FPSBodySettings.DEBUG_VISUALIZATION && playerModel) {
        skeletonHelper = new THREE.SkeletonHelper(playerModel);
        w.ctx.three.scene.add(skeletonHelper);
      }
      
      // Move camera to the new setup
      w.ctx.three.camera.position.set(0, 0, 0);
      w.ctx.three.camera.rotation.set(0, 0, 0);
      
      // FIX: Rotate camera 180 degrees so it faces forward instead of backward
      const fixRotation = new THREE.Euler(0, Math.PI, 0);
      const fixQuaternion = new THREE.Quaternion().setFromEuler(fixRotation);
      cameraHolder.quaternion.multiply(fixQuaternion);
      
      // Add camera to holder
      cameraHolder.add(w.ctx.three.camera);
      
      // Fix for clipping plane issues - adjust near and far planes
      if (w.ctx.three.camera instanceof THREE.PerspectiveCamera) {
        w.ctx.three.camera.near = 0.1;
        w.ctx.three.camera.far = 50000;
        w.ctx.three.camera.updateProjectionMatrix();
      }
      
      console.log("Simplified FPS Body Camera setup complete!");
      isSetup = true;
    } else {
      console.warn("Head bone not found in the model - cannot setup FPS camera");
    }
  }
  
  // Function to ensure camera remains properly attached to head
  function ensureCameraFixedToHead() {
    if (!isSetup || !headBone || !cameraHolder) return;
    
    // Force update world matrices to ensure correct positioning
    headBone.updateWorldMatrix(true, false);
    
    // Make sure camera holder has the correct offset
    cameraHolder.position.copy(FPSBodySettings.CAMERA_OFFSET);
    
    // Ensure camera is correctly oriented
    cameraHolder.updateMatrixWorld(true);
  }
  
  // Main system function
  return (w: ECS) => {
    // Get entities
    const localEntities = localPlayerQuery(w);
    const entities = localEntities.length > 0 ? localEntities : playerQuery(w);
    
    if (entities.length === 0) return w;
    
    // Just use the first player entity
    const pid = entities[0];
    
    // Setup if not already done
    if (!isSetup) {
      setupFPSBody(w, pid);
      if (!isSetup) return w; // Exit if setup not completed
      
      // Ensure scene has proper render settings
      if (w.ctx.three && w.ctx.three.scene) {
        console.log("Ensuring proper scene setup");
        w.ctx.three.scene.background = new THREE.Color(0x87CEEB); // Sky blue
        
        // Make sure fog is disabled as it can cause visual issues
        w.ctx.three.scene.fog = null;
        
        // Fix for scene renderer
        if (w.ctx.three.renderer) {
          // Enable logarithmic depth buffer to fix z-fighting at large distances
          (w.ctx.three.renderer as any).physicallyCorrectLights = true;
          w.ctx.three.renderer.shadowMap.enabled = true;
          
          // Fix for position shifting with distance from origin
          w.ctx.three.renderer.setPixelRatio(window.devicePixelRatio);
          
          console.log("Enhanced renderer setup complete");
        }
      }
    }
    
    // Ensure camera is correctly positioned
    ensureCameraFixedToHead();
    
    // Update skeleton helper if available
    if (skeletonHelper) {
      skeletonHelper.update();
    }
    
    // Apply player pitch directly to camera
    if (pid !== undefined && FPController.pitch[pid] !== undefined) {
      w.ctx.three.camera.rotation.x = FPController.pitch[pid];
    }
    
    return w;
  };
} 