/**
 * Math utilities including vector/quaternion pooling
 */
import * as THREE from 'three';

// Default pool size configuration
export const ObjectPoolConfig = {
  INITIAL_SIZE: 20  // Reduced from 50 to conserve memory
};

// A simple vector/quaternion pool to avoid allocations
class ObjectPool<T> {
  private pool: T[] = [];
  private createFn: () => T;
  private resetFn: (obj: T) => void;
  
  constructor(createFn: () => T, resetFn: (obj: T) => void, initialSize = ObjectPoolConfig.INITIAL_SIZE) {
    this.createFn = createFn;
    this.resetFn = resetFn;
    
    // Pre-allocate initial pool
    for (let i = 0; i < initialSize; i++) {
      this.pool.push(this.createFn());
    }
  }
  
  get(): T {
    if (this.pool.length === 0) {
      return this.createFn();
    }
    return this.pool.pop()!;
  }
  
  release(obj: T): void {
    this.resetFn(obj);
    this.pool.push(obj);
  }
}

// Vector3 pool
export const vec3Pool = new ObjectPool<THREE.Vector3>(
  () => new THREE.Vector3(),
  (v) => v.set(0, 0, 0)
);

// Quaternion pool
export const quatPool = new ObjectPool<THREE.Quaternion>(
  () => new THREE.Quaternion(),
  (q) => q.set(0, 0, 0, 1)
);

// Euler pool
export const eulerPool = new ObjectPool<THREE.Euler>(
  () => new THREE.Euler(),
  (e) => e.set(0, 0, 0)
);

// Vector2 pool
export const vec2Pool = new ObjectPool<THREE.Vector2>(
  () => new THREE.Vector2(),
  (v) => v.set(0, 0)
);

// Interpolation helpers
export function interpolatePositions(
  dest: THREE.Vector3,
  prev: THREE.Vector3, 
  current: THREE.Vector3, 
  alpha: number
): THREE.Vector3 {
  return dest.lerpVectors(prev, current, alpha);
}

export function interpolateRotations(
  dest: THREE.Quaternion,
  prev: THREE.Quaternion, 
  current: THREE.Quaternion, 
  alpha: number
): THREE.Quaternion {
  return dest.slerpQuaternions(prev, current, alpha);
}

// Convert numeric tuple to BigInt64 for use as map key
export function createEntityPairKey(a: number, b: number): bigint {
  // Ensure a < b to make the key consistent regardless of order
  if (a > b) [a, b] = [b, a];
  
  // Convert to BigInt and combine into single 64-bit value
  // This allows for efficient storage without string conversions
  return (BigInt(a) << 32n) | BigInt(b & 0xFFFFFFFF);
}

/**
 * Get direction vector from one point to another
 * @param fromPos Starting position
 * @param toPos Target position
 * @param outVec Optional output vector (if not provided, one will be pooled)
 * @returns Normalized direction vector (caller must vec3Pool.release(outVec) when done)
 */
export function directionFromTo(
  fromPos: { x: number, y: number, z: number },
  toPos: { x: number, y: number, z: number },
  outVec = vec3Pool.get()
): THREE.Vector3 {
  return outVec.set(
    toPos.x - fromPos.x,
    toPos.y - fromPos.y,
    toPos.z - fromPos.z
  ).normalize();
} 