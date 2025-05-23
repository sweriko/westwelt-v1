import * as RAPIER from '@dimforge/rapier3d-compat';
import { createContext, populateScene } from './ecs/scene';
import { createECS } from './ecs/world';
import { startGameLoop } from './gameloop';
import { network } from './ecs/systems/network/client'; // Import network client

const canvas = document.getElementById('c') as HTMLCanvasElement;

async function main() {
  console.log("Initializing Rapier...");
  await RAPIER.init();
  console.log("Rapier initialized.");

  console.log("Creating context...");
  const ctx = await createContext(canvas, RAPIER);
  console.log("Context created.");

  console.log("Creating ECS...");
  const { world, pipeline } = createECS(ctx);
  console.log("ECS created.");

  // Give the physics engine time to fully initialize
  console.log("Waiting for physics engine to stabilize...");
  await new Promise(resolve => setTimeout(resolve, 500));

  console.log("Populating scene...");
  populateScene(world, ctx);
  console.log("Scene populated.");

  console.log("Connecting to network...");
  await network.connect(world); // Connect the network client, passing the world
  console.log("Network connection initiated.");

  console.log("Starting game loop...");
  startGameLoop(world, pipeline);
  console.log("Game loop started.");
}

main().catch(error => {
    console.error("Initialization failed:", error);
    // Display a user-friendly error message on the page
    const errorDiv = document.createElement('div');
    errorDiv.style.position = 'fixed';
    errorDiv.style.top = '0';
    errorDiv.style.left = '0';
    errorDiv.style.width = '100%';
    errorDiv.style.padding = '20px';
    errorDiv.style.backgroundColor = 'red';
    errorDiv.style.color = 'white';
    errorDiv.style.textAlign = 'center';
    errorDiv.style.zIndex = '10000';
    errorDiv.textContent = `Fatal Error: Failed to initialize the game. Please check the console for details and try refreshing. Error: ${error.message}`;
    document.body.appendChild(errorDiv);
});