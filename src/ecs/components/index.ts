import { defineComponent, Types } from 'bitecs';

// Basic transform component (position, rotation, scale)
export const Transform = defineComponent({
  x: Types.f32,
  y: Types.f32,
  z: Types.f32,
  rx: Types.f32,
  ry: Types.f32,
  rz: Types.f32,
  sx: Types.f32,
  sy: Types.f32,
  sz: Types.f32
});

// References to Three.js objects
export const MeshRef = defineComponent();
export const RigidBodyRef = defineComponent({
  id: Types.ui32 // Store Rapier body handle
});

// Tags
export const CubeTag = defineComponent();
export const PlayerTag = defineComponent();
export const NetworkPlayerTag = defineComponent();
export const LocalPlayerTag = defineComponent();
export const BulletTag = defineComponent();

// Export terrain component
export { TerrainComponent } from './TerrainComponent'; 