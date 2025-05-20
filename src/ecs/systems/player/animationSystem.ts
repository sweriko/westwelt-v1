/**
 * Player animation system - handles player model loading, animation states and transitions
 */
import { defineQuery } from 'bitecs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Player, LocalPlayer, MeshRef, FPController, AnimationState } from '../../components';
import { ECS } from '../../world';
import { MovementState, PlayerAnimationState } from '../../config';
import { AnimationStateMachine } from './animationStateMachine';
import { PlayerSystemConfig } from './index';

export function initPlayerAnimationSystem(world: ECS) {
    // Query for player entities
    const playerQuery = defineQuery([Player, MeshRef, FPController]);
    const localPlayerQuery = defineQuery([LocalPlayer, MeshRef, FPController]);
    
    // Animation variables
    let playerModel: THREE.Group | null = null;
    let animationStateMachine: AnimationStateMachine | null = null;
    
    // Legacy animation system variables (for backward compatibility)
    let mixer: THREE.AnimationMixer | null = null;
    let animations: Map<string, THREE.AnimationAction> = new Map();
    let currentAnimation: string | null = null;
    let activeAction: THREE.AnimationAction | null = null;
    
    // Movement tracking
    let movementState = "idle"; // Current movement state: "idle" or "walking"
    let movementTimer = 0; // Timer to prevent rapid state changes
    let movementBuffer = [false, false, false, false, false]; // Buffer last 5 movement samples
    let bufferIndex = 0;
    
    // Regular check to ensure animation is playing
    let animationCheckTimer = 0;
    
    // Load player model
    const loader = new GLTFLoader();
    loader.load('/models/playermodel.glb', (gltf) => {
        console.log('Player model loaded:', gltf);
        
        // Store the model for later use
        playerModel = gltf.scene;
        
        // Process the model differently based on camera mode
        if (PlayerSystemConfig.USE_FULLBODY_FPS) {
            // Advanced animation state machine for full-body FPS
            setupFullBodyFPS(gltf);
        } else {
            // Legacy animation system for traditional camera
            setupLegacyAnimations(gltf);
        }
        
        // Add model to scene and player
        if (playerModel) {
            // Scale and position adjustments
            playerModel.scale.set(1, 1, 1);
            
            // Get player entity and attach model to player
            const playerEntities = playerQuery(world);
            if (playerEntities.length > 0) {
                const pid = playerEntities[0];
                const holder = world.ctx.maps.mesh.get(pid);
                
                if (holder) {
                    // Position the model relative to the player's position
                    // Fix: Adjust Y position to prevent sinking into ground
                    playerModel.position.set(0, -0.9, 0);
                    playerModel.rotation.y = Math.PI; // Face the camera by default
                    
                    // Add model to player holder
                    holder.add(playerModel);
                    
                    // Log bone names for debugging/reference
                    console.log("--------- BONE NAMES ---------");
                    playerModel.traverse((object) => {
                        if (object instanceof THREE.Bone) {
                            console.log("Bone:", object.name);
                        }
                    });
                    
                    // Start with idle animation
                    if (PlayerSystemConfig.USE_FULLBODY_FPS) {
                        if (animationStateMachine) {
                            animationStateMachine.setState(PlayerAnimationState.IDLE);
                        }
                    } else {
                        setAnimation("idle");
                    }
                }
            }
        }
    });
    
    // Setup for full-body FPS animation system
    function setupFullBodyFPS(gltf: any) {
        if (!playerModel) return;
        
        // Create the animation state machine
        animationStateMachine = new AnimationStateMachine(
            playerModel,
            gltf.animations,
            true // Enable debug logging
        );
        
        console.log("Full-body FPS animation system initialized");
    }
    
    // Setup for legacy animation system
    function setupLegacyAnimations(gltf: any) {
        if (!playerModel) return;
        
        // Set up animation mixer
        mixer = new THREE.AnimationMixer(playerModel);
        
        // Process animations
        gltf.animations.forEach((clip: THREE.AnimationClip) => {
            // Create actions for each animation clip
            if (mixer) {
                const action = mixer.clipAction(clip);
                
                // Store by name for easier access
                if (clip.name.toLowerCase().includes('idle')) {
                    animations.set('idle', action);
                    console.log(`Animation loaded: ${clip.name} (IDLE)`);
                } else if (clip.name.toLowerCase().includes('walk')) {
                    animations.set('walking', action);
                    console.log(`Animation loaded: ${clip.name} (WALKING)`);
                } else {
                    console.log(`Other animation loaded: ${clip.name}`);
                }
            }
        });
        
        // Configure all animations
        animations.forEach(action => {
            // Ensure animations loop infinitely and never stop
            action.setLoop(THREE.LoopRepeat, Infinity);
            action.clampWhenFinished = false;
            action.timeScale = 1;
            action.setEffectiveWeight(1);
            action.enabled = true;
            
            // Disable automatic deactivation
            action.zeroSlopeAtEnd = false;
            action.zeroSlopeAtStart = false;
        });
        
        console.log("Legacy animation system initialized");
    }
    
    // Simple animation switch without complex crossfading (legacy)
    function setAnimation(state: string) {
        // Only used in legacy animation mode
        if (PlayerSystemConfig.USE_FULLBODY_FPS) return;
        
        // Ignore if we're already in this state or animations not loaded
        if (state === movementState || !animations.has(state === "walking" ? "walking" : "idle")) {
            return;
        }
        
        // Update state
        movementState = state;
        console.log(`Changing animation to ${state}`);
        
        // Get the new animation
        let newAction: THREE.AnimationAction | null = null;
        
        if (state === "walking") {
            const walkAction = animations.get("walking");
            if (walkAction) {
                newAction = walkAction;
            }
        } else {
            const idleAction = animations.get("idle");
            if (idleAction) {
                newAction = idleAction;
            }
        }
        
        // Only proceed if we have a valid action
        if (!newAction) return;
        
        // Fade between animations - smoother transition
        if (activeAction && activeAction !== newAction) {
            // Prepare new action
            newAction.reset();
            newAction.setEffectiveWeight(1);
            newAction.enabled = true;
            newAction.play();
            
            // Fade from current to new
            newAction.crossFadeFrom(activeAction, 0.2, true);
        } else {
            // First animation or direct switch
            newAction.enabled = true;
            newAction.reset();
            newAction.play();
        }
        
        // Update current animation state
        activeAction = newAction;
        currentAnimation = state === "walking" ? "walking" : "idle";
        
        // Set timeout before next state change is allowed
        movementTimer = 0.3; // 300ms debounce
    }
    
    // Ensure an animation is playing (fallback to idle) - legacy
    function ensureAnimationPlaying() {
        // Only used in legacy animation mode
        if (PlayerSystemConfig.USE_FULLBODY_FPS) return;
        
        if (!mixer || !animations.size) return;
        
        // Check if any action is currently running
        let isAnimationActive = false;
        
        // Check if the active action is properly running
        if (activeAction && activeAction.isRunning()) {
            isAnimationActive = true;
        }
        
        if (!isAnimationActive) {
            console.log("No active animation detected, resetting to idle");
            
            // Force idle animation to play
            const idleAction = animations.get("idle");
            if (idleAction) {
                // Stop all potentially paused actions
                mixer.stopAllAction();
                
                // Reset action state
                idleAction.reset();
                idleAction.setEffectiveWeight(1);
                idleAction.enabled = true;
                idleAction.play();
                
                // Update current state
                activeAction = idleAction;
                currentAnimation = "idle";
                movementState = "idle";
            }
        }
    }
    
    // Check if player is moving based on position buffer
    function isPlayerMoving() {
        // Count true values in buffer
        const movingFrames = movementBuffer.filter(moving => moving).length;
        // Consider moving if at least 3 of the last 5 frames showed movement
        return movingFrames >= 3;
    }
    
    // Update animation state based on entity state
    function updateAnimationState(eid: number, isMoving: boolean, isSprinting: boolean) {
        // Use the appropriate animation system based on config
        if (PlayerSystemConfig.USE_FULLBODY_FPS) {
            if (!animationStateMachine) return;
            
            // Determine the appropriate animation state
            let targetState = PlayerAnimationState.IDLE;
            
            // Get the move state (grounded, jumping, falling)
            const moveState = FPController.moveState[eid];
            
            if (moveState === MovementState.JUMPING) {
                targetState = PlayerAnimationState.JUMPING;
            } else if (moveState === MovementState.FALLING) {
                targetState = PlayerAnimationState.FALLING;
            } else {
                // Player is grounded
                if (isMoving) {
                    targetState = isSprinting ? 
                        PlayerAnimationState.RUNNING : 
                        PlayerAnimationState.WALKING;
                } else {
                    targetState = PlayerAnimationState.IDLE;
                }
            }
            
            // Apply the state change
            animationStateMachine.setState(targetState);
            
            // Update the Animation component with the current state
            AnimationState.state[eid] = targetState;
        } else {
            // Legacy animation system
            if (movementTimer <= 0) {
                if (isMoving && movementState !== "walking") {
                    setAnimation("walking");
                } else if (!isMoving && movementState !== "idle") {
                    setAnimation("idle");
                }
            }
        }
    }
    
    return (w: ECS) => {
        // Update timers
        if (movementTimer > 0) {
            movementTimer -= w.time.dt;
        }
        
        // Increment animation check timer
        animationCheckTimer += w.time.dt;
        
        // Update based on animation mode
        if (PlayerSystemConfig.USE_FULLBODY_FPS) {
            // Full-body FPS animation updates
            if (animationStateMachine) {
                animationStateMachine.update(w.time.dt);
            }
        } else {
            // Legacy animation checks and updates
            if (mixer && playerModel) {
                // Check animation state regularly to prevent T-pose
                if (animationCheckTimer > 1.0) { // Check every second
                    ensureAnimationPlaying();
                    animationCheckTimer = 0;
                }
                
                // Update animation mixer
                mixer.update(w.time.dt);
            } else {
                return w; // Skip rest of function if no animations
            }
        }
        
        // Process both player and localPlayer entities
        // In most cases, entities will have both components
        const entities = new Set([...playerQuery(w), ...localPlayerQuery(w)]);
        
        for (const eid of entities) {
            const holder = w.ctx.maps.mesh.get(eid);
            
            if (holder) {
                // Initialize previous position if needed
                if (!w.time.prevPlayerPos) {
                    w.time.prevPlayerPos = new THREE.Vector3(holder.position.x, holder.position.y, holder.position.z);
                    continue; // Skip this frame as we need two positions to compare
                }
                
                // Calculate horizontal movement (ignore Y)
                const deltaX = holder.position.x - w.time.prevPlayerPos.x;
                const deltaZ = holder.position.z - w.time.prevPlayerPos.z;
                const movementSq = deltaX * deltaX + deltaZ * deltaZ;
                
                // Store in moving buffer (true if moving, false if not)
                movementBuffer[bufferIndex] = movementSq > 0.0005;
                bufferIndex = (bufferIndex + 1) % movementBuffer.length;
                
                // Determine movement state
                const isMoving = isPlayerMoving();
                const isSprinting = w.input?.sprint || false;
                
                // Update animation state
                updateAnimationState(eid, isMoving, isSprinting);
                
                // Store current position for next frame
                w.time.prevPlayerPos.set(holder.position.x, holder.position.y, holder.position.z);
            }
        }
        
        return w;
    };
}