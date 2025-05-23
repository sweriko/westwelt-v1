/**********************************************************************
 * scene.ts – Three + Rapier initialisation & scene population
 *********************************************************************/
import * as THREE  from 'three';
import { addComponent, addEntity } from 'bitecs';
import {
  CubeTag, MeshRef, RigidBodyRef, Transform
} from './components';
import { ECS, ECSContext } from './world';
import { SceneConfig } from './config';
import { createTerrain } from './systems/terrain/TerrainSystem';

/* ------------------------------------------------------------------ */
/* createContext – bootstrap renderer / physics / camera              */
export async function createContext(
  canvas: HTMLCanvasElement,
  RAPIER: typeof import('@dimforge/rapier3d-compat')
): Promise<ECSContext> {
  /* Rapier ---------------------------------------------------------- */
  const rapier = RAPIER;
  const physics = new rapier.World({ x: 0, y: -9.81, z: 0 });

  /* Three renderer -------------------------------------------------- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SceneConfig.SKY_COLOR);
  scene.fog        = new THREE.FogExp2(0x88BBFF, 0.0002);

  const camera = new THREE.PerspectiveCamera(
    75, window.innerWidth / window.innerHeight, 0.1, 50000
  );

  // Set up window resize handler
  setupWindowResize(camera, renderer);

  // Create context object
  const ctx: ECSContext = {
    rapier, physics,
    three: { scene, camera, renderer },
    maps : { mesh: new Map(), rb: new Map() },
    localPlayerId: null
  };

  // Set up lighting, sky and ground
  setupLighting(ctx);
  setupSky(ctx);
  
  // Commented out the flat ground since we'll use terrain instead
  // setupGround(ctx);

  return ctx;
}

/* ------------------------------------------------------------------ */
/* Helper function to set up window resize handling                   */
function setupWindowResize(camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer) {
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

/* ------------------------------------------------------------------ */
/* Helper function to set up scene lighting                           */
function setupLighting(ctx: ECSContext) {
  const scene = ctx.three.scene;
  
  // Add ambient light
  scene.add(new THREE.AmbientLight(
    0xffffff, SceneConfig.AMBIENT_LIGHT_INTENSITY
  ));

  // Add directional light with shadows
  const dirLight = new THREE.DirectionalLight(
    0xffffff, SceneConfig.DIRECTIONAL_LIGHT_INTENSITY
  );
  dirLight.position.set(5, 10, 7);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.left = -100;
  dirLight.shadow.camera.right = 100;
  dirLight.shadow.camera.top = 100;
  dirLight.shadow.camera.bottom = -100;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 500;
  scene.add(dirLight);
}

/* ------------------------------------------------------------------ */
/* Helper function to create sky dome                                 */
function setupSky(ctx: ECSContext) {
  const scene = ctx.three.scene;
  const sky = new THREE.SphereGeometry(400, 32, 15).scale(-1, 1, 1);
  scene.add(new THREE.Mesh(
    sky, 
    new THREE.MeshBasicMaterial({ 
      color: SceneConfig.SKY_COLOR, 
      side: THREE.BackSide 
    })
  ));
}

/* ------------------------------------------------------------------ */
/* Helper function to create ground plane                             */
// This function is kept for reference but not used when terrain is active
function setupGround(ctx: ECSContext) {
  const scene = ctx.three.scene;
  const { rapier, physics } = ctx;
  
  const HALF_H = 0.05;                 // 0.1 m thick collider
  const GROUND_Y = -HALF_H;
  const SIZE = SceneConfig.GROUND_SIZE;

  // Create ground mesh
  const groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE, SIZE).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ 
      color: SceneConfig.GROUND_COLOR, 
      roughness: 0.8, 
      metalness: 0.2 
    })
  );
  groundMesh.receiveShadow = true;
  groundMesh.position.y    = GROUND_Y;
  scene.add(groundMesh);

  // Create ground collider
  const groundBody = physics.createRigidBody(
    rapier.RigidBodyDesc.fixed().setTranslation(0, GROUND_Y, 0)
  );
  physics.createCollider(
    rapier.ColliderDesc.cuboid(SIZE/2, HALF_H, SIZE/2), groundBody
  );
}

/* ------------------------------------------------------------------ */
/* populateScene – central cube stack + scattered cubes + terrain     */
export function populateScene(world: ECS, ctx: ECSContext): void {
  // Position camera to see the terrain better - at a moderate height
  const CAMERA_HEIGHT = 120;
  ctx.three.camera.position.set(0, CAMERA_HEIGHT, 180);
  ctx.three.camera.lookAt(0, 40, 0);

  console.log("Creating terrain entity...");
  
  // Create terrain entity first so it's ready for collisions
  const terrainEntity = createTerrain(world, {
    width: SceneConfig.TERRAIN.WIDTH,
    height: SceneConfig.TERRAIN.HEIGHT,
    depth: SceneConfig.TERRAIN.DEPTH,
    segmentsX: SceneConfig.TERRAIN.SEGMENTS_X,
    segmentsZ: SceneConfig.TERRAIN.SEGMENTS_Z,
    heightScale: SceneConfig.TERRAIN.HEIGHT_SCALE,
    snowHeight: SceneConfig.TERRAIN.SNOW_HEIGHT,
    rockHeight: SceneConfig.TERRAIN.ROCK_HEIGHT,
    grassHeight: SceneConfig.TERRAIN.GRASS_HEIGHT,
    sandHeight: SceneConfig.TERRAIN.SAND_HEIGHT,
    textureScale: SceneConfig.TERRAIN.TEXTURE_SCALE,
    detailScale: SceneConfig.TERRAIN.DETAIL_SCALE,
    normalScale: SceneConfig.TERRAIN.NORMAL_SCALE,
    enableTriplanar: SceneConfig.TERRAIN.ENABLE_TRIPLANAR,
    enableTextureBombing: SceneConfig.TERRAIN.ENABLE_TEXTURE_BOMBING
  });
  
  // Give more time for terrain physics to initialize completely
  console.log("Waiting for terrain initialization...");
  setTimeout(() => {
    console.log("Spawning cubes...");
    spawnCubes(world, ctx);
  }, 2000);
}

/* ------------------------------------------------------------------ */
/* Spawn cubes above the terrain                                      */
function spawnCubes(world: ECS, ctx: ECSContext): void {
  const { rapier, physics, maps, three } = ctx;
  
  // Create shared geometry and materials for cube factory
  const geometries = new Map<number, THREE.BoxGeometry>();
  const materials = new Map<number, THREE.MeshStandardMaterial>();
  
  // Cube factory function with reused geometries/materials
  const makeCube = (
    x: number, y: number, z: number,
    size = 1, color = Math.random() * 0xffffff
  ) => {
    /* Three mesh ---------------------------------------------------- */
    // Reuse or create geometry
    if (!geometries.has(size)) {
      geometries.set(size, new THREE.BoxGeometry(size, size, size));
    }
    
    // Reuse material if same color (within tolerance) or create new
    let material: THREE.MeshStandardMaterial | undefined;
    for (const [existingColor, existingMaterial] of materials.entries()) {
      // Allow for small color differences (hex representation)
      if (Math.abs(existingColor - color) < 100) {
        material = existingMaterial;
        break;
      }
    }
    
    if (!material) {
      material = new THREE.MeshStandardMaterial({ 
        color, 
        roughness: 0.7, 
        metalness: 0.3 
      });
      materials.set(color, material);
    }
    
    const mesh = new THREE.Mesh(geometries.get(size)!, material);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.position.set(x, y, z);
    three.scene.add(mesh);

    /* Rapier body --------------------------------------------------- */
    const rb = physics.createRigidBody(
      rapier.RigidBodyDesc.dynamic()
            .setTranslation(x, y, z)
            .setCcdEnabled(true)
    );
    physics.createCollider(
      rapier.ColliderDesc.cuboid((size * 0.98) / 2, (size * 0.98) / 2, (size * 0.98) / 2)
            .setRestitution(SceneConfig.CUBE_RESTITUTION)
            .setFriction(SceneConfig.CUBE_FRICTION),
      rb
    );

    /* ECS entity ---------------------------------------------------- */
    const eid = addEntity(world);
    addComponent(world, CubeTag,     eid);
    addComponent(world, Transform,   eid);
    addComponent(world, MeshRef,     eid);
    addComponent(world, RigidBodyRef,eid);

    maps.mesh.set(eid, mesh);
    maps.rb.set(eid, rb);
    RigidBodyRef.id[eid] = rb.handle;
    
    // Update handle map
    if (world.ctx.entityHandleMap) {
      world.ctx.entityHandleMap.set(rb.handle, eid);
    }
    
    return rb;
  };

  /* Create cube stacks elevated above terrain */
  const stackSize = SceneConfig.CUBE_STACK_SIZE;
  const halfStack = stackSize / 2;
  
  // Terrain height at spawn point (approximation)
  const TERRAIN_BASE_HEIGHT = SceneConfig.TERRAIN.HEIGHT_SCALE * 0.7; // Higher estimate of average terrain height
  const SPAWN_HEIGHT_OFFSET = 120; // Lower the cube spawn height
  
  console.log(`Spawning cubes at base height: ${TERRAIN_BASE_HEIGHT + SPAWN_HEIGHT_OFFSET}`);
  
  // Make a cube stack
  for (let y = 0; y < stackSize; ++y)
    for (let x = 0; x < stackSize; ++x)
      for (let z = 0; z < stackSize; ++z) {
        const rb = makeCube(x - halfStack, TERRAIN_BASE_HEIGHT + y + SPAWN_HEIGHT_OFFSET, z - halfStack);
        // Apply an initial impulse to ensure movement and collision detection
        rb.applyImpulse({ x: (Math.random() - 0.5) * 0.1, y: 0, z: (Math.random() - 0.5) * 0.1 }, true);
      }

  /* extra cubes */
  for (let i = 0; i < SceneConfig.EXTRA_CUBES; i++) {
    const rb = makeCube(
      (Math.random() - 0.5) * 20,
      TERRAIN_BASE_HEIGHT + SPAWN_HEIGHT_OFFSET + 10 + Math.random() * 10,
      (Math.random() - 0.5) * 20,
      0.5 + Math.random() * 1.5
    );
    // Apply an initial impulse to ensure movement and collision detection
    rb.applyImpulse({ x: (Math.random() - 0.5) * 0.1, y: 0, z: (Math.random() - 0.5) * 0.1 }, true);
  }
}
