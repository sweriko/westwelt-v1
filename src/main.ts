import * as RAPIER from '@dimforge/rapier3d-compat';
import { createContext, populateScene } from './ecs/scene';
import { createECS } from './ecs/world';
import { startGameLoop } from './gameloop';

/* canvas declared in /index.html */
const canvas = document.getElementById('c') as HTMLCanvasElement;

/**
 * Main application entry point
 */
async function main() {
  /* Initialize Rapier WASM module first */
  await RAPIER.init();
  
  /* bootstrap Three + Rapier context (physics world still empty) */
  const ctx = await createContext(canvas, RAPIER);

  /* create ECS world & system pipeline */
  const { world, pipeline } = createECS(ctx);

  /* now that ECS exists, spawn cubes & any other scene content */
  populateScene(world, ctx);
  
  /* Start the game loop */
  startGameLoop(world, pipeline);
}

// Initialize the application
main().catch(console.error);
