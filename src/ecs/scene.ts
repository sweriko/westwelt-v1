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

/* ------------------------------------------------------------------ */
/* createContext – bootstrap renderer / physics / camera              */
export async function createContext(
  canvas: HTMLCanvasElement,
  RAPIER: typeof import('@dimforge/rapier3d')
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
  scene.fog        = new THREE.FogExp2(0x88BBFF, 0.0025);

  const camera = new THREE.PerspectiveCamera(
    75, window.innerWidth / window.innerHeight, 0.1, 1000
  );

  // Set up window resize handler
  setupWindowResize(camera, renderer);

  // Create context object
  const ctx: ECSContext = {
    rapier, physics,
    three: { scene, camera, renderer },
    maps : { mesh: new Map(), rb: new Map() }
  };

  // Set up lighting, sky and ground
  setupLighting(ctx);
  setupSky(ctx);
  setupGround(ctx);

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
  dirLight.shadow.camera.left = -20;
  dirLight.shadow.camera.right = 20;
  dirLight.shadow.camera.top = 20;
  dirLight.shadow.camera.bottom = -20;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far  = 50;
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
/* populateScene – central cube stack + scattered cubes               */
export function populateScene(world: ECS, ctx: ECSContext): void {
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
  };

  /* Create cube stacks */
  const stackSize = SceneConfig.CUBE_STACK_SIZE;
  const halfStack = stackSize / 2;
  
  // Make a cube stack
  for (let y = 0; y < stackSize; ++y)
    for (let x = 0; x < stackSize; ++x)
      for (let z = 0; z < stackSize; ++z)
        makeCube(x - halfStack, y + 0.5, z - halfStack);

  /* extra cubes */
  for (let i = 0; i < SceneConfig.EXTRA_CUBES; i++)
    makeCube(
      (Math.random() - 0.5) * 20,
      10 + Math.random() * 10,
      (Math.random() - 0.5) * 20,
      0.5 + Math.random() * 1.5
    );
}
