import * as THREE from 'three';
import { ECS } from '../world';
import { defineQuery, enterQuery, exitQuery } from 'bitecs';
import { CubeTag, Transform } from '../components';
import { SceneConfig } from '../config';

// Custom shader material class for grass
class ShaderManager {
  private static instance: ShaderManager;
  private shaderCache: Record<string, { vertex: string, fragment: string }> = {};
  
  private constructor() {
    this.initShaders();
  }

  public static getInstance(): ShaderManager {
    if (!ShaderManager.instance) {
      ShaderManager.instance = new ShaderManager();
    }
    return ShaderManager.instance;
  }

  private initShaders(): void {
    // Define grass shader
    const grassVertexShader = `
      uniform vec2 grassSize;
      uniform vec4 grassParams;
      uniform vec4 grassDraw;
      uniform float time;
      uniform vec3 playerPos;
      uniform mat4 viewMatrixInverse;

      attribute float vertIndex;

      varying vec4 vGrassParams;
      varying vec3 vNormal;
      varying vec3 vPosition;
      varying vec3 vWorldPosition;
      varying vec2 vUv;

      // Math utility functions
      float saturate(float x) {
        return clamp(x, 0.0, 1.0);
      }

      float linearstep(float minValue, float maxValue, float v) {
        return clamp((v - minValue) / (maxValue - minValue), 0.0, 1.0);
      }

      float easeOut(float x, float t) {
        return 1.0 - pow(1.0 - x, t);
      }

      float easeIn(float x, float t) {
        return pow(x, t);
      }

      // Hash functions
      vec2 hash22(vec2 p) {
        p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
        return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
      }

      vec4 hash42(vec2 p) {
        vec4 p4 = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
        p4 += dot(p4, p4.wzxy + 33.33);
        return fract((p4.xxyz + p4.yzzw) * p4.zywx) * 2.0 - 1.0;
      }

      // Noise function for wind
      float noise12(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        
        // Smooth interpolation
        vec2 u = f * f * (3.0 - 2.0 * f);
        
        // Hash corners
        float a = dot(hash22(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0));
        float b = dot(hash22(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
        float c = dot(hash22(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
        float d = dot(hash22(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
        
        // Mix
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 0.5 + 0.5;
      }

      // Matrix utility functions
      mat3 rotateX(float theta) {
        float c = cos(theta);
        float s = sin(theta);
        return mat3(
          vec3(1.0, 0.0, 0.0),
          vec3(0.0, c, -s),
          vec3(0.0, s, c)
        );
      }

      mat3 rotateY(float theta) {
        float c = cos(theta);
        float s = sin(theta);
        return mat3(
          vec3(c, 0.0, s),
          vec3(0.0, 1.0, 0.0),
          vec3(-s, 0.0, c)
        );
      }

      mat3 rotateAxis(vec3 axis, float angle) {
        axis = normalize(axis);
        float s = sin(angle);
        float c = cos(angle);
        float oc = 1.0 - c;
        
        return mat3(
          oc * axis.x * axis.x + c,           oc * axis.x * axis.y - axis.z * s,  oc * axis.z * axis.x + axis.y * s,
          oc * axis.x * axis.y + axis.z * s,  oc * axis.y * axis.y + c,           oc * axis.y * axis.z - axis.x * s,
          oc * axis.z * axis.x - axis.y * s,  oc * axis.y * axis.z + axis.x * s,  oc * axis.z * axis.z + c
        );
      }

      void main() {
        vec3 grassOffset = vec3(position.x, 0.0, position.y);

        // Blade world position
        vec3 grassBladeWorldPos = (modelMatrix * vec4(grassOffset, 1.0)).xyz;
        float heightmapSample = 0.0;
        float heightmapSampleHeight = 1.0;

        vec4 hashVal1 = hash42(vec2(grassBladeWorldPos.x, grassBladeWorldPos.z));

        float highLODOut = smoothstep(grassDraw.x * 0.5, grassDraw.x, distance(cameraPosition, grassBladeWorldPos));
        float lodFadeIn = smoothstep(grassDraw.x, grassDraw.y, distance(cameraPosition, grassBladeWorldPos));

        // Check terrain type
        float isSandy = 0.0;
        float grassAllowedHash = hashVal1.w - isSandy;
        float isGrassAllowed = step(0.0, grassAllowedHash);

        float randomAngle = hashVal1.x * 2.0 * 3.14159;
        float randomShade = clamp(hashVal1.y * 0.5 + 0.5, 0.5, 1.0);
        float randomHeight = mix(0.75, 1.5, hashVal1.z * 0.5 + 0.5) * mix(1.0, 0.0, lodFadeIn) * isGrassAllowed * heightmapSampleHeight;
        float randomWidth = mix(0.5, 1.2, hashVal1.y) * (1.0 - isSandy) * heightmapSampleHeight;
        float randomLean = mix(0.1, 0.4, hashVal1.w * 0.5 + 0.5);

        vec2 hashGrassColour = hash22(vec2(grassBladeWorldPos.x, grassBladeWorldPos.z)) * 0.5 + 0.5;
        float leanAnimation = (noise12(vec2(time * 0.35) + grassBladeWorldPos.xz * 137.423) * 2.0 - 1.0) * 0.1;

        float GRASS_SEGMENTS = grassParams.x;
        float GRASS_VERTICES = grassParams.y;

        // Figure out vertex id
        float vertID = mod(float(vertIndex), GRASS_VERTICES);

        // 1 = front, -1 = back
        float zSide = -(floor(vertIndex / GRASS_VERTICES) * 2.0 - 1.0);

        // 0 = left, 1 = right
        float xSide = mod(vertID, 2.0);

        float heightPercent = (vertID - xSide) / (GRASS_SEGMENTS * 2.0);

        // Select grass blade variation (0-4 for 5 variations)
        float bladeVariation = floor(hashVal1.x * 5.0);

        float grassTotalHeight = grassSize.y * randomHeight;
        float grassTotalWidthHigh = easeOut(1.0 - heightPercent, 2.0);
        float grassTotalWidthLow = 1.0 - heightPercent;
        float grassTotalWidth = grassSize.x * mix(grassTotalWidthHigh, grassTotalWidthLow, highLODOut) * randomWidth;

        // Shift verts
        float x = (xSide - 0.5) * grassTotalWidth;
        float y = heightPercent * grassTotalHeight;

        float windDir = noise12(grassBladeWorldPos.xz * 0.05 + 0.05 * time) * 6.28318;
        float windNoiseSample = noise12(grassBladeWorldPos.xz * 0.25 + time * 1.0) * 2.0 - 1.0;
        float windLeanAngle = mix(0.25, 1.0, clamp(windNoiseSample * 0.5 + 0.5, 0.0, 1.0));
        windLeanAngle = easeIn(windLeanAngle, 2.0) * 1.25;
        vec3 windAxis = vec3(cos(windDir), 0.0, sin(windDir));

        windLeanAngle *= heightPercent;

        float distToPlayer = distance(grassBladeWorldPos.xz, playerPos.xz);
        float playerFalloff = smoothstep(2.5, 1.0, distToPlayer);
        float playerLeanAngle = mix(0.0, 0.2, playerFalloff * linearstep(0.5, 0.0, windLeanAngle));
        vec3 grassToPlayer = normalize(vec3(playerPos.x, 0.0, playerPos.z) - vec3(grassBladeWorldPos.x, 0.0, grassBladeWorldPos.z));
        vec3 playerLeanAxis = vec3(grassToPlayer.z, 0, -grassToPlayer.x);

        randomLean += leanAnimation;

        float easedHeight = mix(easeIn(heightPercent, 2.0), 1.0, highLODOut);
        float curveAmount = -randomLean * easedHeight;

        float ncurve1 = -randomLean * easedHeight;
        vec3 n1 = vec3(0.0, (heightPercent + 0.01), 0.0);
        n1 = rotateX(ncurve1) * n1;

        float ncurve2 = -randomLean * easedHeight * 0.9;
        vec3 n2 = vec3(0.0, (heightPercent + 0.01) * 0.9, 0.0);
        n2 = rotateX(ncurve2) * n2;

        vec3 ncurve = normalize(n1 - n2);

        mat3 grassMat = rotateAxis(playerLeanAxis, playerLeanAngle) * rotateAxis(windAxis, windLeanAngle) * rotateY(randomAngle);

        vec3 grassFaceNormal = vec3(0.0, 0.0, 1.0);
        grassFaceNormal = grassMat * grassFaceNormal;
        grassFaceNormal *= zSide;

        vec3 grassVertexNormal = vec3(0.0, -ncurve.z, ncurve.y);
        vec3 grassVertexNormal1 = rotateY(3.14159 * 0.3 * zSide) * grassVertexNormal;

        grassVertexNormal1 = grassMat * grassVertexNormal1;
        grassVertexNormal1 *= zSide;

        vec3 grassVertexPosition = vec3(x, y, 0.0);
        grassVertexPosition = rotateX(curveAmount) * grassVertexPosition;
        grassVertexPosition = grassMat * grassVertexPosition;

        grassVertexPosition += grassOffset;

        vGrassParams = vec4(heightPercent, grassBladeWorldPos.y, highLODOut, xSide);
        
        const float SKY_RATIO = 0.15;
        vec3 UP = vec3(0.0, 1.0, 0.0);
        float skyFadeIn = (1.0 - highLODOut) * SKY_RATIO;
        vNormal = normalize(mix(UP, grassVertexNormal1, skyFadeIn));

        vec3 pos = grassVertexPosition;

        vec3 viewDir = normalize(cameraPosition - grassBladeWorldPos);
        vec3 viewDirXZ = normalize(vec3(viewDir.x, 0.0, viewDir.z));
        vec3 grassFaceNormalXZ = normalize(vec3(grassFaceNormal.x, 0.0, grassFaceNormal.z));

        float viewDotNormal = saturate(dot(grassFaceNormal, viewDirXZ));
        float viewSpaceThickenFactor = easeOut(1.0 - viewDotNormal, 4.0) * smoothstep(0.0, 0.2, viewDotNormal);

        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        
        // Thicken effect for better visibility
        mvPosition.x += viewSpaceThickenFactor * (xSide - 0.5) * grassTotalWidth * 0.5 * zSide;
        
        gl_Position = projectionMatrix * mvPosition;
        
        vPosition = pos;
        vWorldPosition = (modelMatrix * vec4(pos, 1.0)).xyz;
        
        // Map UV to select one of the 5 blade variations
        // Each blade is 143px wide in a 715px texture (1/5 = 0.2 of the total width)
        // X coordinate: map the xSide (0-1) to a 0.2 width segment based on variation
        float uvX = (xSide * 0.2) + (bladeVariation * 0.2);
        vUv = vec2(uvX, heightPercent);
      }
    `;
    
    const grassFragmentShader = `
      uniform vec3 diffuse;
      uniform vec3 specular;
      uniform float shininess;
      uniform float opacity;
      uniform float time;
      uniform sampler2D grassTexture;
      
      varying vec4 vGrassParams;
      varying vec3 vNormal;
      varying vec3 vPosition;
      varying vec3 vWorldPosition;
      varying vec2 vUv;
      
      // Light data (mimic Three.js directional light)
      struct DirectionalLight {
        vec3 direction;
        vec3 color;
      };
      
      const DirectionalLight directionalLight = DirectionalLight(
        normalize(vec3(-0.5, 0.8, 0.5)),
        vec3(1.0, 1.0, 1.0)
      );
      
      // Utility functions
      float saturate(float x) {
        return clamp(x, 0.0, 1.0);
      }
      
      float easeIn(float x, float t) {
        return pow(x, t);
      }
      
      vec3 calculateLighting(vec3 normal, vec3 viewDir, vec3 baseColor) {
        // Ambient term
        vec3 ambient = vec3(0.3) * baseColor;
        
        // Diffuse term with wrapped lighting for softer look
        float wrap = 0.5;
        float NdotL = saturate((dot(normal, directionalLight.direction) + wrap) / (1.0 + wrap));
        vec3 diffuseLight = NdotL * directionalLight.color * baseColor;
        
        // Simple specular for highlights
        vec3 halfVector = normalize(directionalLight.direction + viewDir);
        float NdotH = max(0.0, dot(normal, halfVector));
        vec3 specularLight = pow(NdotH, shininess) * specular * directionalLight.color;
        
        // Back-lighting for translucency effect
        float backLight = saturate((dot(viewDir, -directionalLight.direction) + wrap) / (1.0 + wrap));
        float backFalloff = 0.5;
        vec3 backScatter = directionalLight.color * pow(backLight, 1.0) * backFalloff * baseColor * (1.0 - vGrassParams.z);
        
        return ambient + diffuseLight + specularLight + backScatter;
      }
      
      void main() {
        // Grass color processing
        float heightPercent = vGrassParams.x;
        float lodFadeIn = vGrassParams.z;
        
        // Sample the grass texture
        vec4 texSample = texture2D(grassTexture, vUv);
        
        // Use texture color directly
        vec3 baseColor = texSample.rgb;
        
        // Apply ambient occlusion at the base for natural grounding
        float ao = mix(0.25, 1.0, easeIn(heightPercent, 2.0));
        baseColor *= ao;
        
        // Lighting calculation
        vec3 viewDir = normalize(cameraPosition - vWorldPosition);
        vec3 litColor = calculateLighting(normalize(vNormal), viewDir, baseColor);
        
        // Use alpha from texture if available
        float alpha = texSample.a;
        if (alpha < 0.5) discard; // Discard pixels with low alpha
        
        gl_FragColor = vec4(litColor, 1.0);
      }
    `;
    
    this.shaderCache['GRASS'] = {
      vertex: grassVertexShader,
      fragment: grassFragmentShader
    };
  }

  public getShader(name: string): { vertex: string, fragment: string } {
    if (!this.shaderCache[name]) {
      console.error(`Shader ${name} not found`);
      return { vertex: '', fragment: '' };
    }
    return this.shaderCache[name];
  }
}

// Custom shader material class that works with our shader system
class CustomShaderMaterial extends THREE.ShaderMaterial {
  constructor(type: string, parameters: THREE.ShaderMaterialParameters = {}) {
    const shaderManager = ShaderManager.getInstance();
    const shader = shaderManager.getShader(type);
    
    if (!parameters.uniforms) {
      parameters.uniforms = {};
    }
    
    parameters.vertexShader = shader.vertex;
    parameters.fragmentShader = shader.fragment;
    
    super(parameters);
    
    // Set some default values
    this.transparent = parameters.transparent !== undefined ? parameters.transparent : false;
    this.side = parameters.side !== undefined ? parameters.side : THREE.FrontSide;
    this.depthWrite = parameters.depthWrite !== undefined ? parameters.depthWrite : true;
    this.depthTest = parameters.depthTest !== undefined ? parameters.depthTest : true;
  }
  
  setFloat(name: string, value: number): void {
    if (!this.uniforms[name]) {
      this.uniforms[name] = { value };
    } else {
      this.uniforms[name].value = value;
    }
  }
  
  setVector2(name: string, value: THREE.Vector2): void {
    if (!this.uniforms[name]) {
      this.uniforms[name] = { value };
    } else {
      this.uniforms[name].value.copy(value);
    }
  }
  
  setVector3(name: string, value: THREE.Vector3): void {
    if (!this.uniforms[name]) {
      this.uniforms[name] = { value };
    } else {
      this.uniforms[name].value.copy(value);
    }
  }
  
  setVector4(name: string, value: THREE.Vector4): void {
    if (!this.uniforms[name]) {
      this.uniforms[name] = { value };
    } else {
      this.uniforms[name].value.copy(value);
    }
  }
  
  setMatrix(name: string, value: THREE.Matrix4): void {
    if (!this.uniforms[name]) {
      this.uniforms[name] = { value: value.clone() };
    } else {
      this.uniforms[name].value.copy(value);
    }
  }
  
  setTexture(name: string, value: THREE.Texture): void {
    if (!this.uniforms[name]) {
      this.uniforms[name] = { value };
    } else {
      this.uniforms[name].value = value;
    }
  }
}

// Simple math utility functions
const setSeed = (seed: number): void => {
  // Use a simple random number generator
  Math.random = () => {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  };
};

const randRange = (min: number, max: number): number => {
  return Math.random() * (max - min) + min;
};

// Constants for grass rendering
const NUM_GRASS = (32 * 32) * 3 / 32; // Reduced to 1/32 of original density
const GRASS_SEGMENTS_LOW = 1;
const GRASS_SEGMENTS_HIGH = 6;
const GRASS_VERTICES_LOW = (GRASS_SEGMENTS_LOW + 1) * 2;
const GRASS_VERTICES_HIGH = (GRASS_SEGMENTS_HIGH + 1) * 2;
const GRASS_LOD_DIST = 25 * 8; // Extended by 8x
const GRASS_MAX_DIST = 180 * 8; // Extended by 8x
const GRASS_PATCH_SIZE = (5 * 2) / 8; // Reduced to 1/8 of original size
const GRASS_WIDTH = 0.06; // Thinner grass blades
const GRASS_HEIGHT = 1.5;
const GRASS_CULLING_FACTOR = 0.25; // Only show 25% of grass patches

// Hash function for deterministic culling based on position
function hashPosition(x: number, z: number): number {
  return Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
}

// Grass component implementation
class GrassComponent {
  private meshesLow: THREE.Mesh[] = [];
  private meshesHigh: THREE.Mesh[] = [];
  private group: THREE.Group = new THREE.Group();
  private totalTime: number = 0;
  private grassMaterialLow!: CustomShaderMaterial;
  private grassMaterialHigh!: CustomShaderMaterial;
  private geometryLow!: THREE.InstancedBufferGeometry;
  private geometryHigh!: THREE.InstancedBufferGeometry;
  private readonly _scene: THREE.Scene;
  private grassTexture!: THREE.Texture;
  private heightmapTexture: THREE.Texture | null = null;
  private heightmapData: Uint8ClampedArray | null = null;
  private heightmapWidth: number = 0;
  private heightmapHeight: number = 0;
  private _terrainSize: { width: number, depth: number } = { width: 200, depth: 200 };
  private _heightScale: number = 40;
  
  constructor(scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    this._scene = scene;
    scene.add(this.group);
    
    // Load grass texture
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load('/public/textures/grassblade.png', (texture) => {
      this.grassTexture = texture;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      
      // Create grass materials and geometries
      this.grassMaterialLow = this.createGrassMaterial(true);
      this.grassMaterialHigh = this.createGrassMaterial(false);
      this.geometryLow = this.createGrassGeometry(GRASS_SEGMENTS_LOW);
      this.geometryHigh = this.createGrassGeometry(GRASS_SEGMENTS_HIGH);
      
      console.log("Grass system initialized");
    });
    
    // Load terrain heightmap
    textureLoader.load('/public/terrain/heightmap.png', (texture) => {
      this.heightmapTexture = texture;
      
      // Extract heightmap data for sampling
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      canvas.width = texture.image.width;
      canvas.height = texture.image.height;
      this.heightmapWidth = canvas.width;
      this.heightmapHeight = canvas.height;
      
      ctx.drawImage(texture.image, 0, 0);
      this.heightmapData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      
      console.log(`Loaded terrain heightmap: ${canvas.width}x${canvas.height}`);
    });
  }
  
  // Setters for terrain properties
  set terrainSize(size: { width: number, depth: number }) {
    this._terrainSize = size;
  }
  
  set heightScale(scale: number) {
    this._heightScale = scale;
  }
  
  // Get height at world position from heightmap
  private getTerrainHeight(x: number, z: number): number {
    if (!this.heightmapData || this.heightmapWidth === 0 || this.heightmapHeight === 0) {
      return 0;
    }
    
    // Convert world coordinates to heightmap UV coordinates
    const u = (x + this._terrainSize.width / 2) / this._terrainSize.width;
    const v = (z + this._terrainSize.depth / 2) / this._terrainSize.depth;
    
    // Clamp to valid range
    const clampedU = Math.max(0, Math.min(1, u));
    const clampedV = Math.max(0, Math.min(1, v));
    
    // Convert to pixel coordinates
    const px = Math.floor(clampedU * (this.heightmapWidth - 1));
    const py = Math.floor(clampedV * (this.heightmapHeight - 1));
    
    // Sample heightmap
    const index = (py * this.heightmapWidth + px) * 4;
    const height = this.heightmapData[index] / 255.0;
    
    // Scale to terrain height
    return height * this._heightScale;
  }

  // Calculate terrain normal at given world position by sampling neighboring heights
  private getTerrainNormal(x: number, z: number): THREE.Vector3 {
    const sampleDistance = 1.0; // Distance between sample points
    
    // Sample heights at neighboring points
    const heightCenter = this.getTerrainHeight(x, z);
    const heightLeft = this.getTerrainHeight(x - sampleDistance, z);
    const heightRight = this.getTerrainHeight(x + sampleDistance, z);
    const heightUp = this.getTerrainHeight(x, z - sampleDistance);
    const heightDown = this.getTerrainHeight(x, z + sampleDistance);
    
    // Calculate partial derivatives (slopes)
    const slopeX = (heightRight - heightLeft) / (2 * sampleDistance);
    const slopeZ = (heightDown - heightUp) / (2 * sampleDistance);
    
    // Create normal vector using cross product
    // For a heightfield, the normal can be calculated from the slopes
    const normal = new THREE.Vector3(-slopeX, 1.0, -slopeZ).normalize();
    
    return normal;
  }

  private createGrassMaterial(isLowDetail: boolean): CustomShaderMaterial {
    const material = new CustomShaderMaterial('GRASS', {
      uniforms: {
        grassSize: { value: new THREE.Vector2(GRASS_WIDTH, GRASS_HEIGHT) },
        grassParams: { value: new THREE.Vector4(
          isLowDetail ? GRASS_SEGMENTS_LOW : GRASS_SEGMENTS_HIGH,
          isLowDetail ? GRASS_VERTICES_LOW : GRASS_VERTICES_HIGH,
          0, 0
        )},
        grassDraw: { value: new THREE.Vector4(GRASS_LOD_DIST, GRASS_MAX_DIST, 0, 0) },
        time: { value: 0.0 },
        playerPos: { value: new THREE.Vector3(0, 0, 0) },
        viewMatrixInverse: { value: new THREE.Matrix4() },
        diffuse: { value: new THREE.Color(0xffffff) },
        specular: { value: new THREE.Color(0x111111) },
        shininess: { value: 30 },
        grassTexture: { value: this.grassTexture }
      },
      transparent: true,
      alphaTest: 0.5,
      side: THREE.DoubleSide
    });
    
    return material;
  }

  private createGrassGeometry(segments: number): THREE.InstancedBufferGeometry {
    setSeed(0);

    const VERTICES = (segments + 1) * 2;

    // Create indices
    const indices: number[] = [];
    for (let i = 0; i < segments; ++i) {
      const vi = i * 2;
      indices[i*12+0] = vi + 0;
      indices[i*12+1] = vi + 1;
      indices[i*12+2] = vi + 2;

      indices[i*12+3] = vi + 2;
      indices[i*12+4] = vi + 1;
      indices[i*12+5] = vi + 3;

      const fi = VERTICES + vi;
      indices[i*12+6] = fi + 2;
      indices[i*12+7] = fi + 1;
      indices[i*12+8] = fi + 0;

      indices[i*12+9]  = fi + 3;
      indices[i*12+10] = fi + 1;
      indices[i*12+11] = fi + 2;
    }

    // Create offsets with more sparse distribution
    const offsets: number[] = [];
    for (let i = 0; i < NUM_GRASS; ++i) {
      // Add random jitter to make grass placement less uniform
      const x = randRange(-GRASS_PATCH_SIZE * 0.5, GRASS_PATCH_SIZE * 0.5);
      const z = randRange(-GRASS_PATCH_SIZE * 0.5, GRASS_PATCH_SIZE * 0.5);
      
      // Use deterministic culling based on position
      const bladeHash = hashPosition(x * 100, z * 100);
      if (bladeHash < 0.7) {  // Only keep 70% of blades
        offsets.push(x);
        offsets.push(z);
        offsets.push(0); // Y will be set at runtime based on terrain
      } else {
        // Still need to push something to maintain count
        offsets.push(x);
        offsets.push(z);
        offsets.push(-1000); // Place far below terrain to effectively hide it
      }
    }

    // Create vertex IDs
    const vertID = new Uint8Array(VERTICES*2);
    for (let i = 0; i < VERTICES*2; ++i) {
      vertID[i] = i;
    }

    // Create instanced geometry
    const geo = new THREE.InstancedBufferGeometry();
    geo.instanceCount = NUM_GRASS;
    geo.setAttribute('vertIndex', new THREE.Uint8BufferAttribute(vertID, 1));
    geo.setAttribute('position', new THREE.InstancedBufferAttribute(new Float32Array(offsets), 3));
    geo.setIndex(indices);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1 + GRASS_PATCH_SIZE * 2);

    return geo;
  }

  private createGrassMesh(distToCell: number): THREE.Mesh {
    const isLowDetail = distToCell > GRASS_LOD_DIST;
    const geometry = isLowDetail ? this.geometryLow : this.geometryHigh;
    const material = isLowDetail ? this.grassMaterialLow : this.grassMaterialHigh;
    
    const mesh = new THREE.Mesh(geometry, material);
    if (!mesh) {
      throw new Error("Failed to create grass mesh");
    }
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.visible = false;
    
    if (isLowDetail) {
      this.meshesLow.push(mesh);
    } else {
      this.meshesHigh.push(mesh);
    }
    
    this.group.add(mesh);
    return mesh;
  }

  update(deltaTime: number, playerPosition: THREE.Vector3): void {
    this.totalTime += deltaTime;

    // Update material time uniforms
    this.grassMaterialLow.setFloat('time', this.totalTime);
    this.grassMaterialHigh.setFloat('time', this.totalTime);
    
    // Update player position
    this.grassMaterialLow.setVector3('playerPos', playerPosition);
    this.grassMaterialHigh.setVector3('playerPos', playerPosition);
    
    // Update view matrix
    this.grassMaterialLow.setMatrix('viewMatrixInverse', this.camera.matrixWorld);
    this.grassMaterialHigh.setMatrix('viewMatrixInverse', this.camera.matrixWorld);

    // Make all grass patches invisible initially
    for (const child of this.group.children) {
      child.visible = false;
    }

    // Create frustum for culling
    const frustum = new THREE.Frustum();
    const projScreenMatrix = new THREE.Matrix4();
    projScreenMatrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreenMatrix);
    
    // Calculate base cell position
    const baseCellPos = new THREE.Vector3().copy(this.camera.position);
    baseCellPos.divideScalar(GRASS_PATCH_SIZE);
    baseCellPos.floor();
    baseCellPos.multiplyScalar(GRASS_PATCH_SIZE);
    
    // Copy meshes arrays for reuse
    const meshesLow = [...this.meshesLow];
    const meshesHigh = [...this.meshesHigh];
    
    // Camera position flattened to XZ plane for distance calculation
    const cameraPosXZ = new THREE.Vector3(this.camera.position.x, 0, this.camera.position.z);
    
    // Temp objects for calculations
    const upVector = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion();
    
    // Spawn grass patches
    let totalGrass = 0;
    let totalVerts = 0;
    
    // Increased range to match 8x viewing distance
    for (let x = -88; x < 88; x++) {
      for (let z = -88; z < 88; z++) {
        // Determine patch visibility based on position
        // Use stable hash value that won't change between frames
        const cellSeed = (x * 73856093) ^ (z * 19349663);
        const patchHash = hashPosition(cellSeed, 0);
        if (patchHash > GRASS_CULLING_FACTOR) {
          continue;
        }
        
        // Current cell position
        const cellX = baseCellPos.x + x * GRASS_PATCH_SIZE;
        const cellZ = baseCellPos.z + z * GRASS_PATCH_SIZE;
        
        // Get terrain height at this position
        const terrainHeight = this.getTerrainHeight(cellX, cellZ);
        
        const currentCell = new THREE.Vector3(
          cellX, 
          terrainHeight, // Place on terrain surface
          cellZ
        );
        
        // Create AABB for culling
        const aabb = new THREE.Box3().setFromCenterAndSize(
          currentCell,
          new THREE.Vector3(GRASS_PATCH_SIZE, 1000, GRASS_PATCH_SIZE)
        );
        
        // Calculate distance to cell (using XZ plane for consistent culling)
        const cellXZ = new THREE.Vector3(currentCell.x, 0, currentCell.z);
        const distToCell = cellXZ.distanceTo(cameraPosXZ);
        
        // Skip if too far
        if (distToCell > GRASS_MAX_DIST) {
          continue;
        }
        
        // Skip if outside frustum
        if (!frustum.intersectsBox(aabb)) {
          continue;
        }
        
        // Smooth LOD transition - use low detail mesh for cell near the LOD boundary
        // Apply stable culling based on distance and position to prevent flickering
        const transitionWidth = 5.0; // Width of transition zone
        const lodStart = GRASS_LOD_DIST - transitionWidth;
        const lodEnd = GRASS_LOD_DIST + transitionWidth;
        
        let mesh: THREE.Mesh;
        
        if (distToCell < lodStart) {
          // Clearly in high detail zone
          mesh = meshesHigh.length > 0 ? meshesHigh.pop()! : this.createGrassMesh(distToCell);
          totalVerts += GRASS_VERTICES_HIGH;
        } 
        else if (distToCell > lodEnd) {
          // Clearly in low detail zone
          mesh = meshesLow.length > 0 ? meshesLow.pop()! : this.createGrassMesh(distToCell);
          totalVerts += GRASS_VERTICES_LOW;
        }
        else {
          // In transition zone - use a deterministic decision based on cell position
          // This prevents flickering when moving across the LOD boundary
          const lodRatio = (distToCell - lodStart) / (lodEnd - lodStart); // 0 to 1
          const lodDecision = hashPosition(cellX * 0.3, cellZ * 0.3);
          
          if (lodDecision > lodRatio) {
            mesh = meshesHigh.length > 0 ? meshesHigh.pop()! : this.createGrassMesh(lodStart);
            totalVerts += GRASS_VERTICES_HIGH;
          } else {
            mesh = meshesLow.length > 0 ? meshesLow.pop()! : this.createGrassMesh(lodEnd);
            totalVerts += GRASS_VERTICES_LOW;
          }
        }
        
        // Set position
        mesh.position.copy(currentCell);
        
        // Calculate terrain normal at this position
        const normal = this.getTerrainNormal(cellX, cellZ);
        
        // Create rotation from normal vector to align grass with terrain slope
        quaternion.setFromUnitVectors(upVector, normal);
        mesh.quaternion.copy(quaternion);
        
        mesh.visible = true;
        
        totalGrass += 1;
      }
    }
  }
}

let grassComponent: GrassComponent | null = null;

// Initialize the grass system
export function initGrassSystem(world: ECS) {
  const { scene, camera } = world.ctx.three;
  
  // Wait a bit for terrain to be initialized before creating grass
  setTimeout(() => {
    // Create the grass component after terrain is set up
    grassComponent = new GrassComponent(scene, camera as THREE.PerspectiveCamera);
    
    // Get terrain size from SceneConfig
    if (grassComponent) {
      const terrainConfig = SceneConfig.TERRAIN;
      grassComponent.terrainSize = { 
        width: terrainConfig.WIDTH || 200, 
        depth: terrainConfig.DEPTH || 200 
      };
      grassComponent.heightScale = terrainConfig.HEIGHT_SCALE || 40;
    }
  }, 500);
  
  // Return the system function
  return function grassSystem(world: ECS) {
    // Get player position from the camera
    const playerPosition = world.ctx.three.camera.position.clone();
    
    // Update grass with elapsed time and player position
    if (grassComponent) {
      grassComponent.update(world.time.dt, playerPosition);
    }
    
    return world;
  };
} 