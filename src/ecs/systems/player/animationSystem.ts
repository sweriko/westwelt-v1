import { defineQuery, hasComponent } from 'bitecs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import {
    LocalPlayer, RemotePlayer, MeshRef, FPController, Transform, AnimationState, NetworkId // Added components
} from '../../components';
import { ECS } from '../../world';
import { MovementState, PlayerAnimationState } from '../../config';

// Store mixers and actions globally or per-entity if needed
const playerAnimationData = new Map<number, { // Keyed by Entity ID
    mixer: THREE.AnimationMixer | null;
    actions: Record<string, THREE.AnimationAction>;
    currentAction: THREE.AnimationAction | null;
    model: THREE.Object3D | null;
}>();

let baseModelLoaded = false;
let baseModelAnimations: THREE.AnimationClip[] = []; // Store base animations

// Preload the base model
async function preloadBaseModel() {
    if (baseModelLoaded) return;
    console.log("Preloading base player model for animations...");
    const loader = new GLTFLoader();
    try {
        const gltf = await loader.loadAsync('/models/playermodel.glb');
        baseModelAnimations = gltf.animations;
        baseModelLoaded = true;
        console.log("Base player model animations preloaded.");
    } catch (error) {
        console.error("Failed to preload base player model animations:", error);
    }
}
preloadBaseModel(); // Start preloading

export function initPlayerAnimationSystem(world: ECS) {
    // Query for both local and remote players that have meshes
    const playerQuery = defineQuery([MeshRef, Transform, AnimationState]);
    // Query specifically for the local player's controller state
    const localPlayerControllerQuery = defineQuery([LocalPlayer, FPController]);

    // --- Helper Functions ---
    function setupAnimations(eid: number, model: THREE.Object3D) {
        if (!baseModelLoaded || !model) return; // Ensure base model is loaded

        // First, find the appropriate node to apply animations to
        let animationRoot = model;
        
        // Search for armature/skeleton if the model has one
        model.traverse(node => {
            // Look for Armature, rig, or Skeleton in the name
            if (node.name.toLowerCase().includes('armature') || 
                node.name.toLowerCase().includes('rig') || 
                node.name.toLowerCase().includes('skeleton')) {
                animationRoot = node;
                return; // Found it, stop traversing
            }
        });

        // Create mixer on the appropriate node
        const mixer = new THREE.AnimationMixer(animationRoot);
        const actions: Record<string, THREE.AnimationAction> = {};
        
        // Disable animation logging to prevent console spam about missing bones
        mixer.clipAction = (function(originalFunction) {
            return function(clip: THREE.AnimationClip, ...args: any[]) {
                // Backup and temporarily disable console.error
                const originalConsoleError = console.error;
                console.error = function() {}; // Do nothing
                
                // Call original function
                const result = originalFunction.call(this, clip, ...args);
                
                // Restore console.error
                console.error = originalConsoleError;
                
                return result;
            };
        })(mixer.clipAction) as any;

        baseModelAnimations.forEach((clip) => {
            try {
                const action = mixer.clipAction(clip);
                // Default setup: loop repeating animations, clamp others
                if (clip.name.toLowerCase().includes('idle') || 
                    clip.name.toLowerCase().includes('walk') || 
                    clip.name.toLowerCase().includes('run')) {
                    action.setLoop(THREE.LoopRepeat, Infinity);
                } else {
                    action.setLoop(THREE.LoopOnce, 1);
                    action.clampWhenFinished = true;
                }
                actions[clip.name] = action;
            } catch (error) {
                // Silently ignore animation errors
            }
        });

        // Find default idle action
        const idleActionName = Object.keys(actions).find(name => name.toLowerCase().includes('idle'));
        let currentAction: THREE.AnimationAction | null = null;
        if (idleActionName) {
            currentAction = actions[idleActionName];
            currentAction.play();
        } else {
            console.warn(`No idle animation found for player ${eid}`);
        }

        playerAnimationData.set(eid, { mixer, actions, currentAction, model });
        console.log(`Animation setup complete for player entity ${eid}`);
    }

    function fadeToAction(eid: number, actionName: string, duration: number = 0.2) {
        const data = playerAnimationData.get(eid);
        if (!data || !data.actions[actionName]) return;

        const nextAction = data.actions[actionName];
        const previousAction = data.currentAction;

        if (previousAction === nextAction) return; // Already playing

        nextAction.enabled = true;
         nextAction.setEffectiveTimeScale(1);
         nextAction.setEffectiveWeight(1);
         nextAction.time = 0; // Reset time when fading in

        if (previousAction) {
            previousAction.fadeOut(duration);
        }

        nextAction.reset().fadeIn(duration).play();
        data.currentAction = nextAction;
    }

    // System receives world and optionally the local player eid
    // Modified to iterate over all players and apply animations
     return (w: ECS, localPlayerEid?: number) => {

        // --- Update Mixers ---
        const delta = w.time.dt;
        playerAnimationData.forEach(data => data.mixer?.update(delta));

        // --- Determine and Set Animation State for Local Player ---
        if (localPlayerEid !== undefined && hasComponent(w, FPController, localPlayerEid)) {
            const moveState = FPController.moveState[localPlayerEid];
            let targetAnimationState = PlayerAnimationState.IDLE;

            if (moveState === MovementState.JUMPING) {
                targetAnimationState = PlayerAnimationState.JUMPING;
            } else if (moveState === MovementState.FALLING) {
                targetAnimationState = PlayerAnimationState.FALLING;
            } else if (moveState === MovementState.GROUNDED) {
                 // Check horizontal velocity magnitude from RigidBody for walking/running
                 const rb = w.ctx.maps.rb.get(localPlayerEid);
                 let speedSq = 0;
                 if (rb) {
                     const linvel = rb.linvel();
                     speedSq = linvel.x * linvel.x + linvel.z * linvel.z;
                 }

                if (speedSq > 50) { // Running threshold (adjust as needed)
                     targetAnimationState = PlayerAnimationState.RUNNING;
                } else if (speedSq > 0.1) { // Walking threshold
                     targetAnimationState = PlayerAnimationState.WALKING;
                 } else {
                     targetAnimationState = PlayerAnimationState.IDLE;
                 }
            }
             // TODO: Add checks for shooting, aiming based on input or other state

             AnimationState.state[localPlayerEid] = targetAnimationState;
        }


        // --- Apply Animations Based on State for ALL Players ---
        const allPlayers = playerQuery(w);
        for (const eid of allPlayers) {
             const data = playerAnimationData.get(eid);
             const model = w.ctx.maps.mesh.get(eid);

             // Setup animations if not done yet (e.g., for newly joined remote players)
            if (!data && model && baseModelLoaded) {
                 console.log(`Lazy setup of animations for player entity ${eid}`);
                 // Find the actual GLTF model node if the map stores a holder
                 let playerModelNode = model;
                 if (model.children.length > 0 && model.children[0].type === 'Group') { // Heuristic to find the GLTF scene group
                    playerModelNode = model.children[0];
                 }
                setupAnimations(eid, playerModelNode);
            }

            const animData = playerAnimationData.get(eid); // Get data again after potential setup
            if (!animData) continue; // Skip if setup failed or model not ready


            const currentState = AnimationState.state[eid];
            let targetActionName = 'idle'; // Default animation

            switch (currentState) {
                case PlayerAnimationState.WALKING: targetActionName = 'walk'; break; // Match your GLTF animation names
                case PlayerAnimationState.RUNNING: targetActionName = 'run'; break; // Match your GLTF animation names
                case PlayerAnimationState.JUMPING: targetActionName = 'jump_start'; break; // Use appropriate jump animation name
                case PlayerAnimationState.FALLING: targetActionName = 'jump_fall'; break; // Use appropriate fall animation name
                case PlayerAnimationState.SHOOTING: targetActionName = 'shoot'; break;
                case PlayerAnimationState.AIMING: targetActionName = 'aim'; break; // Or aim_idle?
                case PlayerAnimationState.DEATH: targetActionName = 'death'; break;
                case PlayerAnimationState.IDLE:
                default: targetActionName = 'idle'; break;
            }

            // Find the actual animation name (case-insensitive search)
            const actionKey = Object.keys(animData.actions).find(key => key.toLowerCase().includes(targetActionName));

            if (actionKey && animData.currentAction !== animData.actions[actionKey]) {
                fadeToAction(eid, actionKey);
            } else if (!actionKey) {
                // Fallback to idle if target animation not found
                const idleKey = Object.keys(animData.actions).find(key => key.toLowerCase().includes('idle'));
                if (idleKey && animData.currentAction !== animData.actions[idleKey]) {
                    fadeToAction(eid, idleKey);
                }
            }
        }

        return w;
    };
}