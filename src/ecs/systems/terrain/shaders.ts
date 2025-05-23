export const vertexShader = `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldNormal;
varying vec3 vPosition;
varying vec3 vWorldPosition;
varying vec3 vViewPosition;
varying mat3 vNormalMatrix;

void main() {
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);
  // Calculate world-space normal for triplanar mapping
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vPosition = position;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  
  vec4 modelViewPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = -modelViewPosition.xyz;
  vNormalMatrix = normalMatrix;
  
  gl_Position = projectionMatrix * modelViewPosition;
}
`;

export const fragmentShader = `
uniform sampler2D heightMap;
uniform sampler2D snowTexture;
uniform sampler2D snowNormal;
uniform sampler2D rockTexture;
uniform sampler2D rockNormal;
uniform sampler2D grassTexture;
uniform sampler2D grassNormal;
uniform sampler2D sandTexture;
uniform sampler2D sandNormal;
uniform sampler2D noiseTexture;

uniform float snowHeight;
uniform float rockHeight;
uniform float grassHeight;
uniform float sandHeight;
uniform float textureScale;
uniform float detailScale;
uniform float normalScale;
uniform float heightScale;

uniform bool enableTriplanar;
uniform bool enableTextureBombing;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldNormal;
varying vec3 vPosition;
varying vec3 vWorldPosition;
varying vec3 vViewPosition;
varying mat3 vNormalMatrix;

// Fixed triplanar mapping function using world-space normal
vec4 triplanarMapping(sampler2D tex, vec3 worldPos, vec3 worldNormal, float scale) {
  // Use absolute world-space normal for blending weights
  vec3 blending = abs(worldNormal);
  
  // Apply sharper blending with proper falloff to reduce seams
  blending = max(blending - 0.2, 0.0);
  blending = pow(blending, vec3(4.0));
  blending = blending / (blending.x + blending.y + blending.z + 0.00001);
  
  // Sample textures with world coordinates
  vec3 scaledPos = worldPos * scale;
  
  // X-axis projection (YZ plane) - side view
  vec4 xProjection = texture2D(tex, scaledPos.yz);
  
  // Y-axis projection (XZ plane) - top/bottom view (what we see when looking down)
  vec4 yProjection = texture2D(tex, scaledPos.xz);
  
  // Z-axis projection (XY plane) - front/back view
  vec4 zProjection = texture2D(tex, scaledPos.xy);
  
  // Blend the projections
  return xProjection * blending.x + yProjection * blending.y + zProjection * blending.z;
}

// Texture bombing (micro-detail variation)
vec4 textureBomb(sampler2D tex, vec2 uv, sampler2D noise, float scale) {
  // Get noise value at reduced frequency
  vec2 noiseCoord = uv * 0.3;
  vec2 offset = texture2D(noise, noiseCoord).xy * 2.0 - 1.0;
  
  // Adjust offset based on scale to avoid too much distortion
  offset *= 0.05;
  
  // Apply random offset
  vec2 bombUv = uv * scale + offset;
  
  return texture2D(tex, bombUv);
}

// Height-based blend function with smooth transitions
float heightBlend(float height1, float height2, float blend) {
  // Smoothstep creates a nice curve for blending
  return smoothstep(height1 - blend, height1 + blend, height2);
}

// Combined texture sampling with all techniques
vec4 getTexture(sampler2D tex, sampler2D normalMap, vec3 worldPos, vec3 worldNormal, float scale) {
  if (enableTriplanar) {
    return triplanarMapping(tex, worldPos, worldNormal, scale);
  } else if (enableTextureBombing) {
    return textureBomb(tex, worldPos.xz * scale, noiseTexture, 1.0);
  } else {
    // Regular texture mapping
    return texture2D(tex, worldPos.xz * scale);
  }
}

// Simplified normal mapping to avoid artifacts when looking down
vec3 getNormal(sampler2D normalMap, vec3 pos, vec3 normal, float scale) {
  if (enableTriplanar) {
    // For triplanar mapping, use vertex normal to avoid artifacts
    // This prevents stretching when looking straight down
    return normalize(normal);
  } else if (enableTextureBombing) {
    // Get normal from texture bombing
    vec4 packedNormal = textureBomb(normalMap, pos.xz * scale, noiseTexture, 1.0);
    vec3 normalFromMap = normalize(packedNormal.rgb * 2.0 - 1.0);
    
    // Simple tangent space calculation
    vec3 N = normalize(normal);
    vec3 T = normalize(cross(N, vec3(0.0, 0.0, 1.0)));
    vec3 B = normalize(cross(N, T));
    mat3 TBN = mat3(T, B, N);
    
    return normalize(TBN * normalFromMap);
  } else {
    // Regular normal mapping with simple tangent calculation
    vec4 packedNormal = texture2D(normalMap, pos.xz * scale);
    vec3 normalFromMap = normalize(packedNormal.rgb * 2.0 - 1.0);
    
    // Simple tangent space calculation
    vec3 N = normalize(normal);
    vec3 T = normalize(cross(N, vec3(0.0, 0.0, 1.0)));
    vec3 B = normalize(cross(N, T));
    mat3 TBN = mat3(T, B, N);
    
    return normalize(TBN * normalFromMap);
  }
}

void main() {
  // Height is used for material blending
  float height = vPosition.y / heightScale;
  
  // Blend factors for material transitions
  float blendRange = 0.1; // Wider blends for smoother transitions
  
  // Calculate blend weights for each texture based on height
  float snowWeight = heightBlend(snowHeight, height, blendRange);
  float rockWeight = heightBlend(rockHeight, height, blendRange) * (1.0 - snowWeight);
  float grassWeight = heightBlend(grassHeight, height, blendRange) * (1.0 - snowWeight) * (1.0 - rockWeight);
  float sandWeight = heightBlend(sandHeight, height, blendRange) * (1.0 - snowWeight) * (1.0 - rockWeight) * (1.0 - grassWeight);
  
  // Normalize weights
  float totalWeight = snowWeight + rockWeight + grassWeight + sandWeight;
  if (totalWeight > 0.0) {
    snowWeight /= totalWeight;
    rockWeight /= totalWeight;
    grassWeight /= totalWeight;
    sandWeight /= totalWeight;
  } else {
    // Default to sand if all weights are zero
    sandWeight = 1.0;
  }
  
  // Apply micro-macro texturing: large-scale (macro) and detail-scale (micro)
  // Macro texture (overall appearance) - use world normal for triplanar
  vec4 snowColor = getTexture(snowTexture, snowNormal, vWorldPosition, vWorldNormal, textureScale);
  vec4 rockColor = getTexture(rockTexture, rockNormal, vWorldPosition, vWorldNormal, textureScale);
  vec4 grassColor = getTexture(grassTexture, grassNormal, vWorldPosition, vWorldNormal, textureScale);
  vec4 sandColor = getTexture(sandTexture, sandNormal, vWorldPosition, vWorldNormal, textureScale);
  
  // Detail texture (fine details) at a different scale
  vec4 snowDetail = getTexture(snowTexture, snowNormal, vWorldPosition, vWorldNormal, detailScale);
  vec4 rockDetail = getTexture(rockTexture, rockNormal, vWorldPosition, vWorldNormal, detailScale);
  vec4 grassDetail = getTexture(grassTexture, grassNormal, vWorldPosition, vWorldNormal, detailScale);
  vec4 sandDetail = getTexture(sandTexture, sandNormal, vWorldPosition, vWorldNormal, detailScale);
  
  // Blend macro and micro details
  float detailBlend = 0.3; // Adjust to control detail visibility
  snowColor = mix(snowColor, snowDetail, detailBlend);
  rockColor = mix(rockColor, rockDetail, detailBlend);
  grassColor = mix(grassColor, grassDetail, detailBlend);
  sandColor = mix(sandColor, sandDetail, detailBlend);
  
  // Final color blend based on weights
  vec4 finalColor = 
    snowColor * snowWeight +
    rockColor * rockWeight +
    grassColor * grassWeight +
    sandColor * sandWeight;
    
  // Apply slope-based blending too
  float slope = 1.0 - vWorldNormal.y; // Use world normal for slope calculation
  float slopeBlend = 0.4;
  
  // More rock on steep slopes
  float slopeRockWeight = smoothstep(0.4, 0.7, slope);
  finalColor = mix(finalColor, rockColor, slopeRockWeight * slopeBlend);
  
  // Get blended normal maps for lighting
  vec3 snowNormalMap = getNormal(snowNormal, vWorldPosition, vNormal, textureScale);
  vec3 rockNormalMap = getNormal(rockNormal, vWorldPosition, vNormal, textureScale);
  vec3 grassNormalMap = getNormal(grassNormal, vWorldPosition, vNormal, textureScale);
  vec3 sandNormalMap = getNormal(sandNormal, vWorldPosition, vNormal, textureScale);
  
  // Blend normal maps based on weights
  vec3 blendedNormal = normalize(
    snowNormalMap * snowWeight +
    rockNormalMap * rockWeight +
    grassNormalMap * grassWeight +
    sandNormalMap * sandWeight
  );
  
  // Phong lighting with blended normal
  vec3 lightDir = normalize(vec3(1.0, 1.0, 0.5)); // Directional light
  float diffuse = max(dot(blendedNormal, lightDir), 0.0);
  vec3 ambient = vec3(0.3);
  
  // Simple reflection with view vector for specular
  vec3 viewDir = normalize(vViewPosition);
  vec3 halfDir = normalize(lightDir + viewDir);
  float specular = pow(max(dot(blendedNormal, halfDir), 0.0), 64.0) * 0.2;
  
  // Apply lighting to final color
  vec3 lighting = ambient + diffuse * vec3(1.0) + specular * vec3(1.0);
  vec3 litColor = finalColor.rgb * lighting;
  
  gl_FragColor = vec4(litColor, 1.0);
}
`; 