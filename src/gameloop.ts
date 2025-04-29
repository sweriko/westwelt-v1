/**
 * Game loop module for managing main animation loop
 */
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { ECS } from './ecs/world';

/**
 * Set up stats.js performance monitor
 */
export function setupStats(): Stats {
  const stats = new Stats();
  stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
  stats.dom.style.position = 'absolute';
  stats.dom.style.left = '0px';
  stats.dom.style.top = '0px';
  document.body.appendChild(stats.dom);
  return stats;
}

/**
 * Start the game loop
 */
export function startGameLoop(world: ECS, pipeline: (w: ECS) => ECS): void {
  const stats = setupStats();
  
  // Start animation loop
  const raf = (_t: number) => {
    // Begin stats measurement
    stats.begin();
    
    // Run all systems
    pipeline(world);
    
    // Render the scene
    world.ctx.three.renderer.render(world.ctx.three.scene, world.ctx.three.camera);
    
    // End stats measurement
    stats.end();
    
    // Request next frame
    requestAnimationFrame(raf);
  };
  
  // Start the loop
  requestAnimationFrame(raf);
} 