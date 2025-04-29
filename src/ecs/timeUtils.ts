/**
 * Time utilities for managing fixed timestep and frame timing
 */
import { ECS } from './world';
import { TimeStepConfig } from './config';

/**
 * Update time accumulator and calculate physics steps
 */
export function updateFixedTimestep(world: ECS, deltaTime: number): void {
  // Cap deltaTime to prevent jumps after pauses/tab switches
  const dt = Math.min(deltaTime, TimeStepConfig.MAX_FRAME_TIME);
  
  // Add to accumulator
  world.time.accumulator += dt;
  
  // Calculate how many physics steps to take
  const steps = Math.floor(world.time.accumulator / TimeStepConfig.FIXED_DT);
  const clampedSteps = Math.min(steps, TimeStepConfig.MAX_STEPS);
  
  // Store in world time
  world.time.shouldRunPhysics = clampedSteps > 0;
  world.time.physicsSteps = clampedSteps;
  world.time.fixedDt = TimeStepConfig.FIXED_DT;
  
  // Calculate interpolation alpha
  if (steps > 0) {
    world.time.accumulator -= clampedSteps * TimeStepConfig.FIXED_DT;
    world.time.alpha = world.time.accumulator / TimeStepConfig.FIXED_DT;
  } else {
    world.time.alpha = 0;
  }
} 