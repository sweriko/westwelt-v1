import { defineComponent, Types } from 'bitecs';

export const TerrainComponent = defineComponent({
  // Size of the terrain
  width: Types.f32,
  height: Types.f32,
  depth: Types.f32,
  
  // Resolution
  segmentsX: Types.ui16,
  segmentsZ: Types.ui16,
  
  // Heightmap settings
  heightScale: Types.f32,
  
  // Material blend settings
  snowHeight: Types.f32,
  rockHeight: Types.f32,
  grassHeight: Types.f32,
  sandHeight: Types.f32,
  
  // Texture scale factors
  textureScale: Types.f32,
  detailScale: Types.f32,
  normalScale: Types.f32,
  
  // Flags
  enableTriplanar: Types.ui8,
  enableTextureBombing: Types.ui8
}); 