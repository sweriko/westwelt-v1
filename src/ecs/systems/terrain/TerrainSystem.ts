import * as THREE from 'three';
import { defineQuery, defineSystem, enterQuery, exitQuery, addEntity, addComponent } from 'bitecs';
import { TerrainComponent } from '../../components/TerrainComponent';
import { MeshRef, RigidBodyRef } from '../../components';
import { ECS, ECSContext } from '../../world';
import { vertexShader, fragmentShader } from './shaders';
import { SceneConfig } from '../../config';

const terrainQuery = defineQuery([TerrainComponent]);
const terrainEnterQuery = enterQuery(terrainQuery);
const terrainExitQuery = exitQuery(terrainQuery);

/**
 * Create a terrain mesh from a heightmap
 */
async function createTerrainMesh(
  eid: number,
  world: ECS,
  ctx: ECSContext
): Promise<{mesh: THREE.Mesh, heightData: Float32Array}> {
  const {
    width, height, depth,
    segmentsX, segmentsZ,
    heightScale,
    snowHeight, rockHeight, grassHeight, sandHeight,
    textureScale, detailScale, normalScale,
    enableTriplanar, enableTextureBombing
  } = TerrainComponent;

  console.log(`Creating terrain mesh with dimensions ${width[eid]}x${depth[eid]}, heightScale: ${heightScale[eid]}`);

  // Create a plane geometry with specified segments
  const geometry = new THREE.PlaneGeometry(
    width[eid],
    depth[eid],
    segmentsX[eid],
    segmentsZ[eid]
  );
  
  // Rotate to lie flat on XZ plane
  geometry.rotateX(-Math.PI / 2);
  
  // Load all required textures
  const textureLoader = new THREE.TextureLoader();
  
  // Create a temporary empty texture for initialization
  const tempTexture = new THREE.Texture();
  tempTexture.needsUpdate = true;
  
  console.log("Loading terrain textures...");
  
  // Use a promise-based approach to load all textures
  const texturePromises = [
    loadTexture(textureLoader, '/public/terrain/heightmap.png'),
    loadTexture(textureLoader, '/public/textures/snow_diffuse.jpg', true),
    loadTexture(textureLoader, '/public/textures/snow_normal.jpg', true),
    loadTexture(textureLoader, '/public/textures/rock_diffuse.jpg', true),
    loadTexture(textureLoader, '/public/textures/rock_normal.jpg', true),
    loadTexture(textureLoader, '/public/textures/grass_diffuse.jpg', true),
    loadTexture(textureLoader, '/public/textures/grass_normal.jpg', true),
    loadTexture(textureLoader, '/public/textures/sand_diffuse.jpg', true),
    loadTexture(textureLoader, '/public/textures/sand_normal.jpg', true),
    loadTexture(textureLoader, '/public/textures/noise.jpg', true)
  ];
  
  // Initialize material with temporary textures
  const material = new THREE.ShaderMaterial({
    uniforms: {
      heightMap: { value: tempTexture },
      snowTexture: { value: tempTexture },
      snowNormal: { value: tempTexture },
      rockTexture: { value: tempTexture },
      rockNormal: { value: tempTexture },
      grassTexture: { value: tempTexture },
      grassNormal: { value: tempTexture },
      sandTexture: { value: tempTexture },
      sandNormal: { value: tempTexture },
      noiseTexture: { value: tempTexture },
      
      snowHeight: { value: snowHeight[eid] },
      rockHeight: { value: rockHeight[eid] },
      grassHeight: { value: grassHeight[eid] },
      sandHeight: { value: sandHeight[eid] },
      
      textureScale: { value: textureScale[eid] },
      detailScale: { value: detailScale[eid] },
      normalScale: { value: normalScale[eid] },
      heightScale: { value: heightScale[eid] },
      
      enableTriplanar: { value: enableTriplanar[eid] === 1 },
      enableTextureBombing: { value: enableTextureBombing[eid] === 1 }
    },
    vertexShader,
    fragmentShader
  });
  
  // Create mesh with initial geometry and material
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  
  // Add to scene
  ctx.three.scene.add(mesh);
  
  // Store heightmap data for collision creation
  let heightData: Float32Array = new Float32Array((segmentsX[eid] + 1) * (segmentsZ[eid] + 1));
  
  console.log("Waiting for texture loading...");
  
  // When all textures are loaded, update the material
  try {
    const textures = await Promise.all(texturePromises);
    
    const [
      heightMap,
      snowTexture, snowNormal,
      rockTexture, rockNormal,
      grassTexture, grassNormal,
      sandTexture, sandNormal,
      noiseTexture
    ] = textures;
    
    console.log("Textures loaded, updating material...");
    
    // Update material with loaded textures
    material.uniforms.heightMap.value = heightMap;
    material.uniforms.snowTexture.value = snowTexture;
    material.uniforms.snowNormal.value = snowNormal;
    material.uniforms.rockTexture.value = rockTexture;
    material.uniforms.rockNormal.value = rockNormal;
    material.uniforms.grassTexture.value = grassTexture;
    material.uniforms.grassNormal.value = grassNormal;
    material.uniforms.sandTexture.value = sandTexture;
    material.uniforms.sandNormal.value = sandNormal;
    material.uniforms.noiseTexture.value = noiseTexture;
    
    // Configure texture parameters
    configureTexture(snowTexture);
    configureTexture(snowNormal);
    configureTexture(rockTexture);
    configureTexture(rockNormal);
    configureTexture(grassTexture);
    configureTexture(grassNormal);
    configureTexture(sandTexture);
    configureTexture(sandNormal);
    configureTexture(noiseTexture);
    
    console.log("Extracting height data for collision...");
    
    // Get height data from heightmap for collider
    heightData = extractHeightData(heightMap, segmentsX[eid] + 1, segmentsZ[eid] + 1);
    
    console.log("Applying heightmap to geometry...");
    
    // Apply the heightmap to deform the geometry
    applyHeightmap(geometry, heightMap, heightScale[eid]);
    
    // Update geometry
    geometry.computeVertexNormals();
    geometry.attributes.position.needsUpdate = true;
    
    console.log("Terrain mesh creation complete");
  } catch (error) {
    console.error("Failed to load terrain textures:", error);
  }
  
  return { mesh, heightData };
}

/**
 * Extract height data from a heightmap texture
 */
function extractHeightData(
  heightMap: THREE.Texture,
  width: number,
  height: number
): Float32Array {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = heightMap.image.width;
  canvas.height = heightMap.image.height;
  ctx.drawImage(heightMap.image, 0, 0);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  
  const heightData = new Float32Array(width * height);
  
  // Sample the heightmap with bilinear filtering
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1);
      const v = z / (height - 1);
      
      // Sample heightmap with bilinear interpolation
      const heightValue = sampleHeightmap(imgData, canvas.width, canvas.height, u, v);
      
      // Store the normalized height value directly
      heightData[z * width + x] = heightValue;
    }
  }
  
  // Output some diagnostic info about the height data
  let min = 1.0, max = 0.0, sum = 0.0;
  for (let i = 0; i < heightData.length; i++) {
    min = Math.min(min, heightData[i]);
    max = Math.max(max, heightData[i]);
    sum += heightData[i];
  }
  
  console.log(`Height data stats - Min: ${min}, Max: ${max}, Avg: ${sum/heightData.length}`);
  
  // Validate the height data
  if (max <= 0.01) {
    console.warn("WARNING: Height data is nearly flat! Check your heightmap texture.");
    
    // If heightmap is essentially flat, add some random height variations for testing
    for (let i = 0; i < heightData.length; i++) {
      if (Math.random() < 0.1) { // Add some random peaks
        heightData[i] = Math.random() * 0.5 + 0.5; // Random value between 0.5 and 1.0
      }
    }
    console.log("Added some random height variations for testing");
  }
  
  return heightData;
}

/**
 * Create physics colliders for the terrain
 */
function createTerrainColliders(
  eid: number,
  world: ECS,
  ctx: ECSContext,
  heightData: Float32Array,
  vertices?: Float32Array,
  indices?: Uint32Array
): void {
  const { rapier, physics } = ctx;
  const {
    width, depth, heightScale,
    segmentsX, segmentsZ
  } = TerrainComponent;
  
  console.log("Creating terrain colliders using trimesh...");
  
  // Create a fixed rigid body for the terrain
  const rigidBodyDesc = rapier.RigidBodyDesc.fixed();
  const terrainBody = physics.createRigidBody(rigidBodyDesc);
  
  // Store reference to the body
  ctx.maps.rb.set(eid, terrainBody);
  addComponent(world, RigidBodyRef, eid);
  RigidBodyRef.id[eid] = terrainBody.handle;
  
  // Use provided vertices and indices if available
  if (vertices && indices) {
    console.log(`Using precomputed trimesh with ${vertices.length / 3} vertices and ${indices.length / 3} triangles`);
    
    // Create a trimesh collider that exactly matches our visual mesh
    const trimeshDesc = rapier.ColliderDesc.trimesh(vertices, indices);
    
    // Set appropriate friction for terrain
    trimeshDesc.setFriction(SceneConfig.TERRAIN.COLLISION.FRICTION);
    trimeshDesc.setRestitution(SceneConfig.TERRAIN.COLLISION.RESTITUTION);
    
    // Create the collider and attach it to the rigid body
    const collider = physics.createCollider(trimeshDesc, terrainBody);
    
    console.log("Terrain collision (trimesh) created successfully");
  } else {
    // If vertices and indices are not provided, create a fallback cube collider
    console.warn("No trimesh data provided, creating fallback collision");
    
    const cubeDesc = rapier.ColliderDesc.cuboid(width[eid]/2, heightScale[eid]/2, depth[eid]/2);
    cubeDesc.setTranslation(0, heightScale[eid]/2, 0);
    cubeDesc.setFriction(SceneConfig.TERRAIN.COLLISION.FRICTION);
    
    const collider = physics.createCollider(cubeDesc, terrainBody);
  }
  
  // Register with entity handle map if it exists
  if (world.ctx.entityHandleMap) {
    world.ctx.entityHandleMap.set(terrainBody.handle, eid);
  }
}

/**
 * Downsample a heightfield for more efficient collision detection
 */
function downsampleHeightfield(
  heightData: Float32Array,
  srcWidth: number, srcHeight: number,
  destWidth: number, destHeight: number
): Float32Array {
  const result = new Float32Array(destWidth * destHeight);
  
  // Enhanced downsampling that preserves important terrain features
  // Use a weighted sampling approach to ensure collisions are accurate
  for (let z = 0; z < destHeight; z++) {
    for (let x = 0; x < destWidth; x++) {
      // Calculate the source region this destination pixel covers
      const srcX1 = Math.floor((x / (destWidth - 1)) * (srcWidth - 1));
      const srcZ1 = Math.floor((z / (destHeight - 1)) * (srcHeight - 1));
      const srcX2 = Math.min(Math.ceil((x + 1) / (destWidth - 1) * (srcWidth - 1)), srcWidth - 1);
      const srcZ2 = Math.min(Math.ceil((z + 1) / (destHeight - 1) * (srcHeight - 1)), srcHeight - 1);
      
      // Find both the maximum and average height in the region
      let maxHeight = 0;
      let minHeight = 1.0;
      let totalHeight = 0;
      let sampleCount = 0;
      
      for (let sz = srcZ1; sz <= srcZ2; sz++) {
        for (let sx = srcX1; sx <= srcX2; sx++) {
          const height = heightData[sz * srcWidth + sx];
          maxHeight = Math.max(maxHeight, height);
          minHeight = Math.min(minHeight, height);
          totalHeight += height;
          sampleCount++;
        }
      }
      
      // Use a weighted blend based on height variation
      const avgHeight = sampleCount > 0 ? totalHeight / sampleCount : 0;
      const heightVariation = maxHeight - minHeight;
      
      // Dynamically adjust weights based on terrain variation
      // High variation (cliffs, peaks) = favor max height (90%)
      // Low variation (flat areas) = more balanced (60% max, 40% avg)
      const maxWeight = 0.6 + (0.3 * Math.min(heightVariation * 5, 1.0));
      const avgWeight = 1.0 - maxWeight;
      
      // Weighted blend preserves peaks better while still maintaining general terrain shape
      const weightedHeight = maxHeight * maxWeight + avgHeight * avgWeight;
      
      result[z * destWidth + x] = weightedHeight;
    }
  }
  
  return result;
}

/**
 * Load a texture with error handling and fallback
 */
function loadTexture(
  loader: THREE.TextureLoader, 
  path: string, 
  useFallback = false
): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(
      path,
      (texture) => {
        console.log(`Loaded texture: ${path}`);
        resolve(texture);
      },
      undefined,
      (err: unknown) => {
        console.warn(`Failed to load texture ${path}:`, err);
        if (useFallback) {
          // Create a default texture as fallback
          const canvas = document.createElement('canvas');
          canvas.width = 256;
          canvas.height = 256;
          const ctx = canvas.getContext('2d')!;
          
          // Fill with a checkerboard pattern for diffuse textures
          if (path.includes('diffuse')) {
            ctx.fillStyle = '#888888';
            ctx.fillRect(0, 0, 256, 256);
            ctx.fillStyle = '#666666';
            for (let y = 0; y < 16; y++) {
              for (let x = 0; x < 16; x++) {
                if ((x + y) % 2 === 0) {
                  ctx.fillRect(x * 16, y * 16, 16, 16);
                }
              }
            }
          } 
          // Fill with a flat normal map for normal textures
          else if (path.includes('normal')) {
            ctx.fillStyle = '#8080FF'; // Default normal pointing up (0,0,1)
            ctx.fillRect(0, 0, 256, 256);
          }
          // Default noise texture
          else if (path.includes('noise')) {
            for (let y = 0; y < 256; y++) {
              for (let x = 0; x < 256; x++) {
                const v = Math.floor(Math.random() * 255);
                ctx.fillStyle = `rgb(${v},${v},${v})`;
                ctx.fillRect(x, y, 1, 1);
              }
            }
          }
          // Default heightmap
          else if (path.includes('heightmap')) {
            // Create a simple heightmap with some features
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, 256, 256);
            
            // Add some mountains/hills
            for (let i = 0; i < 20; i++) {
              const x = Math.random() * 256;
              const y = Math.random() * 256;
              const radius = 20 + Math.random() * 40;
              const height = 128 + Math.random() * 127;
              
              const grd = ctx.createRadialGradient(x, y, 0, x, y, radius);
              grd.addColorStop(0, `rgb(${height},${height},${height})`);
              grd.addColorStop(1, '#000000');
              
              ctx.fillStyle = grd;
              ctx.beginPath();
              ctx.arc(x, y, radius, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          
          const texture = new THREE.CanvasTexture(canvas);
          console.log(`Created fallback texture for ${path}`);
          resolve(texture);
        } else {
          reject(err);
        }
      }
    );
  });
}

/**
 * Configure texture parameters for tiling and filtering
 */
function configureTexture(texture: THREE.Texture): void {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
}

/**
 * Apply heightmap to deform geometry
 */
function applyHeightmap(
  geometry: THREE.PlaneGeometry,
  heightMap: THREE.Texture,
  heightScale: number
): void {
  // Get heightmap data
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  canvas.width = heightMap.image.width;
  canvas.height = heightMap.image.height;
  ctx.drawImage(heightMap.image, 0, 0);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  
  // Get position attribute for modification
  const positions = geometry.attributes.position.array;
  
  // Plane geometry is laid flat on XZ plane, Y is up
  const segmentsX = Math.sqrt(positions.length / 3) - 1;
  const segmentsZ = segmentsX;
  
  // Apply heightmap to vertices
  for (let i = 0, j = 0; i < positions.length; i += 3, j++) {
    const x = (j % (segmentsX + 1)) / segmentsX;
    const z = Math.floor(j / (segmentsZ + 1)) / segmentsZ;
    
    // Sample heightmap (bilinear interpolation)
    const heightValue = sampleHeightmap(data, canvas.width, canvas.height, x, z);
    
    // Apply height to Y coordinate (plane is rotated so Y is up)
    positions[i + 1] = heightValue * heightScale;
  }
}

/**
 * Sample heightmap with bilinear interpolation
 */
function sampleHeightmap(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  u: number,
  v: number
): number {
  // Convert UV to pixel coordinates
  const x = u * (width - 1);
  const y = v * (height - 1);
  
  // Get integer pixel coordinates and fractional parts
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const dx = x - x0;
  const dy = y - y0;
  
  // Sample the four surrounding pixels
  const p00 = getPixelHeight(data, width, x0, y0);
  const p10 = getPixelHeight(data, width, x1, y0);
  const p01 = getPixelHeight(data, width, x0, y1);
  const p11 = getPixelHeight(data, width, x1, y1);
  
  // Bilinear interpolation
  const p0 = p00 * (1 - dx) + p10 * dx;
  const p1 = p01 * (1 - dx) + p11 * dx;
  return p0 * (1 - dy) + p1 * dy;
}

/**
 * Get pixel height value from RGBA data
 */
function getPixelHeight(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number
): number {
  const i = (y * width + x) * 4;
  // Use red channel for height (normalized to 0-1)
  return data[i] / 255;
}

/**
 * Create a visual debug representation of the heightfield collision
 */
function createCollisionDebugMesh(
  ctx: ECSContext,
  vertices: Float32Array,
  indices: Uint32Array
): THREE.Mesh {
  // Create a visible wireframe representation of the trimesh collider
  
  // Create a buffer geometry from the vertices and indices
  const geometry = new THREE.BufferGeometry();
  
  // Set vertices (copy to ensure a fresh array)
  const positionArray = new Float32Array(vertices.length);
  for (let i = 0; i < vertices.length; i++) {
    positionArray[i] = vertices[i];
  }
  
  // Set the index array (triangles)
  const indexArray = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    indexArray[i] = indices[i];
  }
  
  // Set attributes
  geometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));
  geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));
  
  // Compute normals for proper lighting
  geometry.computeVertexNormals();
  
  // Create a wireframe material
  const material = new THREE.MeshBasicMaterial({
    color: 0xff3333,
    wireframe: true,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide
  });
  
  // Create and return the mesh
  const mesh = new THREE.Mesh(geometry, material);
  mesh.visible = false; // Start hidden by default
  
  // Add to scene
  ctx.three.scene.add(mesh);
  
  // Add a toggle function on key press (for debugging)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'v') {
      mesh.visible = !mesh.visible;
      console.log(`Collision debug mesh visibility: ${mesh.visible}`);
    }
  });
  
  console.log("Debug collision mesh created. Press 'V' to toggle visibility.");
  
  return mesh;
}

/**
 * Create terrain system
 */
export function createTerrainSystem(ctx: ECSContext) {
  return defineSystem((world: ECS) => {
    // Handle newly created terrain entities
    const enterEntities = terrainEnterQuery(world);
    for (let i = 0; i < enterEntities.length; i++) {
      const eid = enterEntities[i];
      
      createTerrainMesh(eid, world, ctx)
        .then(({ mesh, heightData }) => {
          // Store mesh reference in ECS
          ctx.maps.mesh.set(eid, mesh);
          
          // Generate vertices and indices for collision
          const collisionSegmentsX = Math.min(
            Math.max(TerrainComponent.segmentsX[eid] / 2, 64), 
            SceneConfig.TERRAIN.COLLISION.MAX_COLLISION_SEGMENTS
          );
          const collisionSegmentsZ = Math.min(
            Math.max(TerrainComponent.segmentsZ[eid] / 2, 64), 
            SceneConfig.TERRAIN.COLLISION.MAX_COLLISION_SEGMENTS
          );
          
          // Create temporary geometry
          const tempGeometry = new THREE.PlaneGeometry(
            TerrainComponent.width[eid],
            TerrainComponent.depth[eid],
            collisionSegmentsX,
            collisionSegmentsZ
          );
          
          // Rotate to lie flat on XZ plane
          tempGeometry.rotateX(-Math.PI / 2);
          
          // Get vertices and indices from the geometry
          const positions = tempGeometry.attributes.position.array;
          const indices = tempGeometry.index ? tempGeometry.index.array : null;
          
          if (!indices) {
            console.error("Terrain geometry has no indices");
            return;
          }
          
          // Apply height data to the vertices
          const downsampled = downsampleHeightfield(
            heightData,
            TerrainComponent.segmentsX[eid] + 1, 
            TerrainComponent.segmentsZ[eid] + 1,
            collisionSegmentsX + 1, 
            collisionSegmentsZ + 1
          );
          
          console.log(`Created collision mesh with resolution ${collisionSegmentsX}x${collisionSegmentsZ}`);
          
          // Apply height to vertices
          for (let i = 0, j = 0; i < positions.length; i += 3, j++) {
            const x = j % (collisionSegmentsX + 1);
            const z = Math.floor(j / (collisionSegmentsX + 1));
            const index = z * (collisionSegmentsX + 1) + x;
            
            if (index < downsampled.length) {
              // Apply height to Y coordinate
              positions[i + 1] = downsampled[index] * TerrainComponent.heightScale[eid];
            }
          }
          
          // Now we need to convert Three.js format to Rapier format
          const vertices = new Float32Array(positions.length);
          for (let i = 0; i < positions.length; i += 3) {
            vertices[i] = positions[i];       // X
            vertices[i + 1] = positions[i + 1]; // Y
            vertices[i + 2] = positions[i + 2]; // Z
          }
          
          // Create an array of indices (each triangle is 3 consecutive indices)
          const triangleIndices = new Uint32Array(indices.length);
          for (let i = 0; i < indices.length; i++) {
            triangleIndices[i] = indices[i];
          }
          
          // Create debug visualization for collision mesh first, so we can see it
          console.log("Creating collision debug visualization");
          const debugMesh = createCollisionDebugMesh(ctx, vertices, triangleIndices);
          
          // Create actual physics colliders
          createTerrainColliders(eid, world, ctx, heightData, vertices, triangleIndices);
        });
    }
    
    // Handle terrain entity removal
    const exitEntities = terrainExitQuery(world);
    for (let i = 0; i < exitEntities.length; i++) {
      const eid = exitEntities[i];
      const mesh = ctx.maps.mesh.get(eid) as THREE.Mesh | undefined;
      const rb = ctx.maps.rb.get(eid);
      
      if (mesh) {
        // Remove from scene
        ctx.three.scene.remove(mesh);
        
        // Clean up resources
        mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m: THREE.Material) => m.dispose());
        } else {
          mesh.material.dispose();
        }
        
        // Remove from map
        ctx.maps.mesh.delete(eid);
      }
      
      // Remove rigid body if it exists
      if (rb) {
        ctx.physics.removeRigidBody(rb);
        ctx.maps.rb.delete(eid);
      }
    }
    
    return world;
  });
}

/**
 * Helper function to create a terrain entity
 */
export function createTerrain(
  world: ECS,
  {
    width = 200,
    height = 40,
    depth = 200,
    segmentsX = 128,
    segmentsZ = 128,
    heightScale = 40,
    snowHeight = 0.8,
    rockHeight = 0.6,
    grassHeight = 0.3,
    sandHeight = 0.1,
    textureScale = 0.1,
    detailScale = 0.5,
    normalScale = 1.0,
    enableTriplanar = true,
    enableTextureBombing = true
  } = {}
) {
  const entity = addEntity(world);
  
  addComponent(world, TerrainComponent, entity);
  addComponent(world, MeshRef, entity);
  
  // Set component values
  TerrainComponent.width[entity] = width;
  TerrainComponent.height[entity] = height;
  TerrainComponent.depth[entity] = depth;
  TerrainComponent.segmentsX[entity] = segmentsX;
  TerrainComponent.segmentsZ[entity] = segmentsZ;
  TerrainComponent.heightScale[entity] = heightScale;
  TerrainComponent.snowHeight[entity] = snowHeight;
  TerrainComponent.rockHeight[entity] = rockHeight;
  TerrainComponent.grassHeight[entity] = grassHeight;
  TerrainComponent.sandHeight[entity] = sandHeight;
  TerrainComponent.textureScale[entity] = textureScale;
  TerrainComponent.detailScale[entity] = detailScale;
  TerrainComponent.normalScale[entity] = normalScale;
  TerrainComponent.enableTriplanar[entity] = enableTriplanar ? 1 : 0;
  TerrainComponent.enableTextureBombing[entity] = enableTextureBombing ? 1 : 0;
  
  return entity;
} 