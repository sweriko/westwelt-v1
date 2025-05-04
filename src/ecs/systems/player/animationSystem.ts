/**
 * Player animation system - handles player model loading, animation states and transitions
 */
import { defineQuery } from 'bitecs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Player, LocalPlayer, MeshRef, FPController } from '../../components';
import { ECS } from '../../world';
import { MovementState } from '../../config';

// Animation state constants
const AnimationState = {
    IDLE: 'idle',
    WALKING: 'walking'
};

export function initPlayerAnimationSystem(world: ECS) {
    // Query for either Player or LocalPlayer entities with required components
    const playerQuery = defineQuery([Player, MeshRef, FPController]);
    const localPlayerQuery = defineQuery([LocalPlayer, MeshRef, FPController]);
    
    // Animation variables
    let playerModel: THREE.Group | null = null;
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
        
        // Set up animation mixer
        mixer = new THREE.AnimationMixer(playerModel);
        
        // Process animations
        gltf.animations.forEach((clip) => {
            // Create actions for each animation clip
            if (mixer) {
                const action = mixer.clipAction(clip);
                
                // Store by name for easier access
                if (clip.name.toLowerCase().includes('idle')) {
                    animations.set(AnimationState.IDLE, action);
                    console.log(`Animation loaded: ${clip.name} (IDLE)`);
                } else if (clip.name.toLowerCase().includes('walk')) {
                    animations.set(AnimationState.WALKING, action);
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
                    setAnimation("idle");
                }
            }
        }
    });
    
    // Simple animation switch without complex crossfading
    function setAnimation(state: string) {
        // Ignore if we're already in this state or animations not loaded
        if (state === movementState || !animations.has(state === "walking" ? AnimationState.WALKING : AnimationState.IDLE)) {
            return;
        }
        
        // Update state
        movementState = state;
        console.log(`Changing animation to ${state}`);
        
        // Get the new animation
        let newAction: THREE.AnimationAction | null = null;
        
        if (state === "walking") {
            const walkAction = animations.get(AnimationState.WALKING);
            if (walkAction) {
                newAction = walkAction;
            }
        } else {
            const idleAction = animations.get(AnimationState.IDLE);
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
        currentAnimation = state === "walking" ? AnimationState.WALKING : AnimationState.IDLE;
        
        // Set timeout before next state change is allowed
        movementTimer = 0.3; // 300ms debounce
    }
    
    // Ensure an animation is playing (fallback to idle)
    function ensureAnimationPlaying() {
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
            const idleAction = animations.get(AnimationState.IDLE);
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
                currentAnimation = AnimationState.IDLE;
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
    
    return (w: ECS) => {
        // Update timers
        if (movementTimer > 0) {
            movementTimer -= w.time.dt;
        }
        
        // Increment animation check timer
        animationCheckTimer += w.time.dt;
        
        // Only continue if animations are loaded
        if (!mixer || !playerModel) {
            return w;
        }
        
        // Check animation state regularly to prevent T-pose
        if (animationCheckTimer > 1.0) { // Check every second
            ensureAnimationPlaying();
            animationCheckTimer = 0;
        }
        
        // Update animation mixer
        mixer.update(w.time.dt);
        
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
                
                // Only change animation if debounce timer is up
                if (movementTimer <= 0) {
                    if (isMoving && movementState !== "walking") {
                        setAnimation("walking");
                    } else if (!isMoving && movementState !== "idle") {
                        setAnimation("idle");
                    }
                }
                
                // Store current position for next frame
                w.time.prevPlayerPos.set(holder.position.x, holder.position.y, holder.position.z);
            }
        }
        
        return w;
    };
}