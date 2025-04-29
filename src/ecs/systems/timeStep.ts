/**
 * Time step system that manages fixed time steps for physics
 */
import { ECS } from '../world';
import { updateFixedTimestep } from '../timeUtils';
import { TimeStepConfig } from '../config';

// Fixed timestep configuration constants are now directly imported from TimeStepConfig

export function initTimeStepSystem(_world: ECS) {
  return (w: ECS) => {
    // Calculate delta time in seconds
    const now = performance.now();
    // Use a minimum delta time to prevent tiny stutters during fast displays
    const dt = Math.max(TimeStepConfig.MIN_DT, (now - w.time.then) * 0.001); // Convert ms to seconds
    w.time.then = now;
    w.time.dt = dt;
    
    // Update fixed timestep values
    updateFixedTimestep(w, dt);
    
    return w;
  };
} 