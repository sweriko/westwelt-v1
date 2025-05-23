/**
 * Animation state machine for the FPS full-body camera setup
 */
import * as THREE from 'three';
import { PlayerAnimationState, AnimationTransitions } from '../../config';

// Define animation clip meta data structure
interface AnimationClipMeta {
  name: string;          // Original name from the GLTF file
  state: number;         // Mapped state (PlayerAnimationState enum value)
  weight: number;        // Current weight (0-1)
  action: THREE.AnimationAction | null; // Reference to the THREE animation action
  loop: THREE.AnimationActionLoopStyles; // Loop type (THREE.LoopOnce, THREE.LoopRepeat, etc.)
  clampWhenFinished: boolean; // Whether to clamp the last frame when animation finishes
  timeScale: number;     // Animation playback speed
  isTransitioning: boolean; // Whether this animation is currently in a transition
}

export class AnimationStateMachine {
  // Animation mixer
  private mixer: THREE.AnimationMixer;
  
  // Animation data
  private clips: Map<number, AnimationClipMeta> = new Map();
  private activeState: number = PlayerAnimationState.IDLE;
  private previousState: number = PlayerAnimationState.IDLE;
  
  // Transition info
  private inTransition: boolean = false;
  private transitionTimer: number = 0;
  private transitionDuration: number = 0;
  
  // Debug
  private debug: boolean;
  
  /**
   * Create a new animation state machine
   * @param model The model to animate
   * @param animationClips Array of animation clips from the GLTF file
   * @param debug Whether to log debug info
   */
  constructor(model: THREE.Group, animationClips: THREE.AnimationClip[], debug: boolean = false) {
    this.mixer = new THREE.AnimationMixer(model);
    this.debug = debug;
    
    // Map animation clips to state enum values based on name pattern matching
    this.mapAnimationClips(animationClips);
    
    // Set initial state
    this.setState(PlayerAnimationState.IDLE);
    
    if (this.debug) {
      console.log(`Animation State Machine initialized with ${this.clips.size} clips`);
    }
  }
  
  /**
   * Map animation clips to state enum values by name pattern matching
   */
  private mapAnimationClips(animationClips: THREE.AnimationClip[]): void {
    // Map of keywords to animation states
    const keywordMap: Record<string, number> = {
      'idle': PlayerAnimationState.IDLE,
      'stand': PlayerAnimationState.IDLE,
      'walk': PlayerAnimationState.WALKING,
      'run': PlayerAnimationState.RUNNING,
      'sprint': PlayerAnimationState.SPRINT,
      'jump': PlayerAnimationState.JUMPING,
      'fall': PlayerAnimationState.FALLING,
      'shoot': PlayerAnimationState.SHOOTING,
      'fire': PlayerAnimationState.SHOOTING,
      'aim': PlayerAnimationState.AIMING,
      'reload': PlayerAnimationState.RELOAD,
      'crouch_idle': PlayerAnimationState.CROUCH_IDLE,
      'crouchidle': PlayerAnimationState.CROUCH_IDLE,
      'crouch_walk': PlayerAnimationState.CROUCH_WALK,
      'crouchwalk': PlayerAnimationState.CROUCH_WALK,
      'death': PlayerAnimationState.DEATH,
      'die': PlayerAnimationState.DEATH,
      'hit': PlayerAnimationState.HIT_REACTION,
      'inspect': PlayerAnimationState.INSPECT_WEAPON
    };
    
    // Process each animation clip
    for (const clip of animationClips) {
      // Convert clip name to lowercase for matching
      const lowerName = clip.name.toLowerCase();
      
      // Try to match keywords to determine state
      let state = -1;
      let highestPriorityMatch = -1;
      
      // Check for each keyword
      for (const [keyword, stateValue] of Object.entries(keywordMap)) {
        if (lowerName.includes(keyword)) {
          // If we find a match and it's higher priority (or first match), store it
          if (stateValue > highestPriorityMatch) {
            state = stateValue;
            highestPriorityMatch = stateValue;
          }
        }
      }
      
      // If no state was found, skip this clip
      if (state === -1) {
        if (this.debug) {
          console.log(`Could not map animation: ${clip.name}`);
        }
        continue;
      }
      
      // Create animation action from clip
      const action = this.mixer.clipAction(clip);
      
      // Configure default action settings
      action.setEffectiveWeight(0); // Start with zero weight
      action.enabled = true;
      
      // Determine if animation should loop based on state
      const shouldLoop = [
        PlayerAnimationState.DEATH,
        PlayerAnimationState.SHOOTING,
        PlayerAnimationState.RELOAD,
        PlayerAnimationState.HIT_REACTION,
        PlayerAnimationState.INSPECT_WEAPON
      ].includes(state) ? false : true;
      
      // Create clip metadata
      const clipMeta: AnimationClipMeta = {
        name: clip.name,
        state: state,
        weight: 0,
        action: action,
        loop: shouldLoop ? THREE.LoopRepeat : THREE.LoopOnce,
        clampWhenFinished: !shouldLoop,
        timeScale: 1.0,
        isTransitioning: false
      };
      
      // Configure action based on metadata
      action.setLoop(clipMeta.loop, Infinity);
      action.clampWhenFinished = clipMeta.clampWhenFinished;
      
      // Store in map
      this.clips.set(state, clipMeta);
      
      if (this.debug) {
        console.log(`Mapped animation: ${clip.name} -> ${this.getStateName(state)}`);
      }
    }
    
    // For any missing essential animations, create default placeholders
    this.createPlaceholderIfMissing(PlayerAnimationState.IDLE);
    this.createPlaceholderIfMissing(PlayerAnimationState.WALKING);
  }
  
  /**
   * Create a placeholder animation if a critical state is missing
   */
  private createPlaceholderIfMissing(state: number): void {
    if (!this.clips.has(state)) {
      if (this.debug) {
        console.warn(`Critical animation state missing: ${this.getStateName(state)}, creating placeholder`);
      }
      
      // Create a dummy clip
      const dummyClip = new THREE.AnimationClip(
        `placeholder_${this.getStateName(state)}`, 
        1, 
        [] // Empty tracks
      );
      
      // Create action from clip
      const action = this.mixer.clipAction(dummyClip);
      
      // Create clip metadata
      const clipMeta: AnimationClipMeta = {
        name: dummyClip.name,
        state: state,
        weight: 0,
        action: action,
        loop: THREE.LoopRepeat,
        clampWhenFinished: false,
        timeScale: 1.0,
        isTransitioning: false
      };
      
      // Configure action
      action.setLoop(clipMeta.loop, Infinity);
      action.clampWhenFinished = clipMeta.clampWhenFinished;
      
      // Store in map
      this.clips.set(state, clipMeta);
    }
  }
  
  /**
   * Get user-friendly name for an animation state
   */
  private getStateName(state: number): string {
    for (const [key, value] of Object.entries(PlayerAnimationState)) {
      if (typeof value === 'number' && value === state) {
        return key;
      }
    }
    return `Unknown(${state})`;
  }
  
  /**
   * Set the current animation state
   * @param state The new state to set
   * @param forceInstant If true, will switch immediately without transition
   * @returns True if state changed, false if same state or invalid state
   */
  setState(state: number, forceInstant: boolean = false): boolean {
    // If same state, do nothing
    if (state === this.activeState) {
      return false;
    }
    
    // Check if the state exists
    if (!this.clips.has(state)) {
      console.warn(`Animation state not available: ${this.getStateName(state)}`);
      
      // Try to use closest available state
      if (state === PlayerAnimationState.FALLING && this.clips.has(PlayerAnimationState.JUMPING)) {
        state = PlayerAnimationState.JUMPING;
      } else if (state === PlayerAnimationState.RUNNING && this.clips.has(PlayerAnimationState.WALKING)) {
        state = PlayerAnimationState.WALKING;
      } else if (state === PlayerAnimationState.JUMPING && this.clips.has(PlayerAnimationState.IDLE)) {
        state = PlayerAnimationState.IDLE;
      } else if (!this.clips.has(PlayerAnimationState.IDLE)) {
        // If we can't even fall back to IDLE, just return
        return false;
      } else {
        // Default fallback to IDLE
        state = PlayerAnimationState.IDLE;
      }
    }
    
    // Store previous state for reference
    this.previousState = this.activeState;
    
    // Get animations
    const prevAnim = this.clips.get(this.previousState);
    const nextAnim = this.clips.get(state);
    
    if (!prevAnim || !nextAnim || !prevAnim.action || !nextAnim.action) {
      console.error(`Invalid animation data for transition from ${this.getStateName(this.previousState)} to ${this.getStateName(state)}`);
      return false;
    }
    
    // Calculate transition time
    let transitionTime = AnimationTransitions.DEFAULT;
    const specificTransitionKey = `${this.previousState}_to_${state}`;
    if (specificTransitionKey in AnimationTransitions) {
      transitionTime = AnimationTransitions[specificTransitionKey as keyof typeof AnimationTransitions];
    }
    
    if (forceInstant) {
      transitionTime = 0;
    }
    
    // Set new active state
    this.activeState = state;
    
    // Handle transition
    if (transitionTime <= 0) {
      // Immediate switch
      prevAnim.action.stop();
      nextAnim.action.play();
      prevAnim.weight = 0;
      nextAnim.weight = 1;
      this.inTransition = false;
    } else {
      // Start crossfade transition
      prevAnim.action.fadeOut(transitionTime);
      nextAnim.action.reset().fadeIn(transitionTime).play();
      
      this.inTransition = true;
      this.transitionTimer = 0;
      this.transitionDuration = transitionTime;
      
      if (this.debug) {
        console.log(`Starting transition: ${this.getStateName(this.previousState)} -> ${this.getStateName(this.activeState)} (${transitionTime}s)`);
      }
    }
    
    return true;
  }
  
  /**
   * Update the animation state machine
   * @param deltaTime Time elapsed since last update in seconds
   */
  update(deltaTime: number): void {
    // Update the animation mixer
    this.mixer.update(deltaTime);
    
    // Update transition state if needed
    if (this.inTransition) {
      this.transitionTimer += deltaTime;
      
      // Calculate progress (0-1)
      const t = Math.min(1.0, this.transitionTimer / this.transitionDuration);
      
      // Get source and target animations
      const prevClip = this.clips.get(this.previousState);
      const nextClip = this.clips.get(this.activeState);
      
      if (prevClip && nextClip && prevClip.action && nextClip.action) {
        // Update weights based on progress
        prevClip.weight = 1.0 - t;
        nextClip.weight = t;
        
        // Apply weights to actions
        prevClip.action.setEffectiveWeight(prevClip.weight);
        nextClip.action.setEffectiveWeight(nextClip.weight);
        
        // Check if transition is complete
        if (t >= 1.0) {
          // Stop the previous animation
          prevClip.action.stop();
          prevClip.weight = 0;
          prevClip.isTransitioning = false;
          
          // Ensure the new animation has full weight
          nextClip.action.setEffectiveWeight(1);
          nextClip.weight = 1;
          nextClip.isTransitioning = false;
          
          // Transition complete
          this.inTransition = false;
          this.transitionTimer = 0;
          
          if (this.debug) {
            console.log(`Transition complete: ${this.getStateName(this.previousState)} -> ${this.getStateName(this.activeState)}`);
          }
        }
      }
    }
    
    // Check for animations that have ended (one-shot animations)
    const currentClip = this.clips.get(this.activeState);
    if (currentClip && currentClip.action && 
        currentClip.loop === THREE.LoopOnce && 
        !this.inTransition &&
        currentClip.action.loop === THREE.LoopOnce &&
        currentClip.action.time >= currentClip.action.getClip().duration) {
      
      // Animation has completed, transition to idle
      if (this.debug) {
        console.log(`One-shot animation completed: ${this.getStateName(this.activeState)}, returning to IDLE`);
      }
      
      this.setState(PlayerAnimationState.IDLE);
    }
  }
  
  /**
   * Get the current animation state
   */
  getState(): number {
    return this.activeState;
  }
  
  /**
   * Get the previous animation state
   */
  getPreviousState(): number {
    return this.previousState;
  }
  
  /**
   * Check if currently in transition between states
   */
  isInTransition(): boolean {
    return this.inTransition;
  }
  
  /**
   * Set the time scale for an animation
   * @param state The animation state to adjust
   * @param timeScale The new time scale (1.0 = normal speed)
   */
  setTimeScale(state: number, timeScale: number): void {
    const clipMeta = this.clips.get(state);
    if (clipMeta && clipMeta.action) {
      clipMeta.timeScale = timeScale;
      clipMeta.action.setEffectiveTimeScale(timeScale);
    }
  }
  
  /**
   * Set the time scale for the current animation
   * @param timeScale The new time scale (1.0 = normal speed)
   */
  setCurrentTimeScale(timeScale: number): void {
    this.setTimeScale(this.activeState, timeScale);
  }
  
  /**
   * Get the animation mixer
   */
  getMixer(): THREE.AnimationMixer {
    return this.mixer;
  }
} 