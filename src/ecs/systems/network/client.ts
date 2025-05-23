import {
    addComponent,
    addEntity,
    defineQuery,
    enterQuery,
    exitQuery,
    hasComponent,
    removeComponent,
    removeEntity
} from 'bitecs';
import * as THREE from 'three';
import { NetworkConfig, WeaponConfig, PlayerConfig } from '../../config';
import {
    AnimationState, Health, InterpolationTarget, LocalPlayer, MeshRef, NetworkId, RemotePlayer, RigidBodyRef, Transform, Projectile, Lifespan, Velocity
} from '../../components';
import { ECS, ECSContext } from '../../world';
import { PlayerAnimationState } from '../../config';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'; // Needed for loading remote player models
import { createVisualProjectile } from '../player/shootSystem'; // Import the visual projectile function

// --- Network State Interface ---
export interface NetworkState {
    connected: boolean;
    connecting: boolean;
    socket: WebSocket | null;
    messageQueue: any[]; // Queue for incoming messages
    pendingUpdates: Map<number, any>; // EntityId -> Last sent state for diffing (optimization)
    lastSentTime: number;
    lastPingTime: number;
}

// --- Network Singleton ---
// Using a singleton pattern for managing the WebSocket connection
class NetworkClient {
    private world: ECS | null = null;
    private state: NetworkState = {
        connected: false,
        connecting: false,
        socket: null,
        messageQueue: [],
        pendingUpdates: new Map(),
        lastSentTime: 0,
        lastPingTime: 0
    };
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private modelsLoaded = false; // Track if base models are loaded

    async connect(world: ECS): Promise<void> {
        if (this.state.connected || this.state.connecting) {
            console.warn("Network connection already established or in progress.");
            return;
        }

        this.world = world;
        this.world.network = this.state; // Link the state to the world
        this.state.connecting = true;
        console.log(`Attempting to connect to ${NetworkConfig.SERVER_URL}...`);

        // Preload models needed for remote players before connecting
        await this.preloadModels();

        try {
            this.state.socket = new WebSocket(NetworkConfig.SERVER_URL);

            this.state.socket.onopen = () => {
                console.log("WebSocket connection established.");
                this.state.connected = true;
                this.state.connecting = false;
                this.reconnectAttempts = 0; // Reset attempts on successful connection
                if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
                this.state.lastPingTime = Date.now(); // Start ping timer
            };

            this.state.socket.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data as string);
                    // Push message to the queue to be processed by the system
                    this.state.messageQueue.push(message);
                } catch (error) {
                    console.error("Failed to parse server message:", error);
                }
            };

            this.state.socket.onerror = (error) => {
                console.error("WebSocket error:", error);
                // Error event often precedes close event, let onclose handle reconnect
            };

            this.state.socket.onclose = (event) => {
                console.log(`WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason}`);
                this.state.connected = false;
                this.state.connecting = false;
                this.state.socket = null;
                this.world!.ctx.localPlayerId = null; // Reset local player ID
                // Maybe clear existing remote players here? Or let the server handle it on re-init.
                this.scheduleReconnect();
            };
        } catch (error) {
            console.error("Failed to create WebSocket connection:", error);
            this.state.connecting = false;
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error("Max reconnection attempts reached. Please refresh the page.");
            return;
        }
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts -1), 30000); // Exponential backoff
        console.log(`Attempting to reconnect in ${delay / 1000} seconds (Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

        this.reconnectTimer = setTimeout(() => {
            if (this.world) {
                this.connect(this.world);
            }
        }, delay);
    }

    send(data: any): void {
        if (this.state.connected && this.state.socket) {
            this.state.socket.send(JSON.stringify(data));
        }
    }

    disconnect(): void {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectAttempts = this.maxReconnectAttempts; // Prevent further attempts
        if (this.state.socket) {
            this.state.socket.close();
            this.state.socket = null;
        }
        this.state.connected = false;
        this.state.connecting = false;
        console.log("Network disconnected manually.");
    }

    // --- Model Preloading ---
    private async preloadModels() {
        if (this.modelsLoaded) return;
        console.log("Preloading player model for remote players...");
        const loader = new GLTFLoader();
        try {
            await loader.loadAsync('/models/playermodel.glb');
            this.modelsLoaded = true;
            console.log("Player model preloaded successfully.");
        } catch (error) {
            console.error("Failed to preload player model:", error);
        }
    }
}

export const network = new NetworkClient(); // Export singleton instance

// --- ECS Network System ---
export function initNetworkSystem(world: ECS) {
    const localPlayerQuery = defineQuery([LocalPlayer, Transform, Health, AnimationState]);
    const remotePlayerQuery = defineQuery([RemotePlayer, NetworkId, Transform, MeshRef, InterpolationTarget]);
    const networkIdMap = world.players; // Use the map from the world object

    // --- Queries for Adding/Removing Remote Players ---
    const remotePlayerEnterQuery = enterQuery(remotePlayerQuery);
    const remotePlayerExitQuery = exitQuery(remotePlayerQuery);

    // --- Message Handlers ---
    const handleInit = (data: any) => {
        console.log("Received init from server:", data);
        world.ctx.localPlayerId = data.playerId;

        // Find the local player entity (should have been created by initPlayerSystem)
        const localPlayers = localPlayerQuery(world);
        if (localPlayers.length > 0) {
            const localEid = localPlayers[0];
            // Add NetworkId if it doesn't exist, or update it
            if (!hasComponent(world, NetworkId, localEid)) {
                 addComponent(world, NetworkId, localEid);
            }
            NetworkId.id[localEid] = data.playerId;
            networkIdMap.set(data.playerId, localEid);

             // Initialize local player state from server if necessary (e.g., spawn pos)
            if (data.initialState?.position) {
                 Transform.x[localEid] = data.initialState.position.x;
                 Transform.y[localEid] = data.initialState.position.y;
                 Transform.z[localEid] = data.initialState.position.z;
                // Also update the RigidBody position if it exists
                const rb = world.ctx.maps.rb.get(localEid);
                if(rb) {
                    rb.setTranslation(data.initialState.position, true);
                     // Reset velocity after setting position
                    rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
                    rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
                }
            }
            if (data.initialState?.rotation) {
                Transform.qx[localEid] = data.initialState.rotation.x;
                Transform.qy[localEid] = data.initialState.rotation.y;
                Transform.qz[localEid] = data.initialState.rotation.z;
                Transform.qw[localEid] = data.initialState.rotation.w;
                 const rb = world.ctx.maps.rb.get(localEid);
                 if(rb) rb.setRotation(data.initialState.rotation, true);
            }
             if (data.initialState?.health !== undefined) {
                Health.current[localEid] = data.initialState.health;
                Health.max[localEid] = data.initialState.maxHealth || PlayerConfig.MAX_HEALTH;
             }
        } else {
            console.error("LocalPlayer entity not found during network init!");
        }

        // Add existing players from the server message
        data.players?.forEach((playerState: any) => handlePlayerJoined({ playerState }));
    };

    const handlePlayerJoined = (data: any) => {
        const playerState = data.playerState;
        if (!playerState || playerState.id === world.ctx.localPlayerId || networkIdMap.has(playerState.id)) {
            return; // Don't add self or existing players
        }
        console.log(`Player ${playerState.id} joined, creating remote entity...`);
        addRemotePlayer(world, world.ctx, playerState);
    };

    const handlePlayerLeft = (data: any) => {
        const remoteEid = networkIdMap.get(data.playerId);
        if (remoteEid !== undefined) {
            console.log(`Player ${data.playerId} left, removing entity ${remoteEid}`);
            removeRemotePlayer(world, world.ctx, remoteEid);
            networkIdMap.delete(data.playerId);
        } else {
             console.log(`Received playerLeft for unknown or already removed player ${data.playerId}`);
        }
    };

    const handleWorldState = (data: any) => {
        data.players?.forEach((playerState: any) => {
            if (playerState.id === world.ctx.localPlayerId) return; // Ignore updates for local player state

            const remoteEid = networkIdMap.get(playerState.id);
            if (remoteEid !== undefined) {
                // Update existing remote player's target state for interpolation
                if (hasComponent(world, InterpolationTarget, remoteEid)) {
                    InterpolationTarget.targetX[remoteEid] = playerState.position.x;
                    InterpolationTarget.targetY[remoteEid] = playerState.position.y;
                    InterpolationTarget.targetZ[remoteEid] = playerState.position.z;
                    InterpolationTarget.targetQX[remoteEid] = playerState.rotation.x;
                    InterpolationTarget.targetQY[remoteEid] = playerState.rotation.y;
                    InterpolationTarget.targetQZ[remoteEid] = playerState.rotation.z;
                    InterpolationTarget.targetQW[remoteEid] = playerState.rotation.w;
                    InterpolationTarget.timestamp[remoteEid] = data.timestamp; // Use server timestamp
                }
                if (hasComponent(world, AnimationState, remoteEid)) {
                    AnimationState.state[remoteEid] = playerState.animationState;
                }
                if (hasComponent(world, Health, remoteEid) && playerState.health !== undefined) {
                     Health.current[remoteEid] = playerState.health;
                }
            } else {
                // Player doesn't exist locally, add them (might happen on late join/reconnect)
                console.log(`WorldState adding missing player ${playerState.id}`);
                addRemotePlayer(world, world.ctx, playerState);
            }
        });
    };

    const handlePlayerShoot = (data: any) => {
        const shooterEid = networkIdMap.get(data.playerId);
        if (shooterEid === undefined || shooterEid === world.ctx.localPlayerId) return; // Ignore self or unknown

        // Find the shooter entity to get accurate position/direction for effects
        const shooterMesh = world.ctx.maps.mesh.get(shooterEid);
        if (shooterMesh) {
            // Use the provided position/direction from the message for spawning
            const pos = new THREE.Vector3(data.position.x, data.position.y, data.position.z);
            const dir = new THREE.Vector3(data.direction.x, data.direction.y, data.direction.z);

            // Create visual projectile for remote player shot
            createVisualProjectile(world, pos, dir, 0x00aaff);
            
            // TODO: Play shooting sound spatially from shooterMesh position
        } else {
            console.warn(`Shooter mesh not found for remote player ${data.playerId}`);
        }
    };

    const handlePlayerDamaged = (data: any) => {
        const localPlayers = localPlayerQuery(world);
        if (localPlayers.length > 0) {
            const localEid = localPlayers[0];
            console.log(`Local player (${NetworkId.id[localEid]}) took ${data.damage} damage from ${data.sourceId}`);
            if (hasComponent(world, Health, localEid)) {
                Health.current[localEid] = data.newHealth;
                // Trigger UI update or visual feedback here
                console.log(`My new health: ${Health.current[localEid]}`);
            }
        }
    };

    const handleHealthUpdate = (data: any) => {
        const targetEid = networkIdMap.get(data.playerId);
        if (targetEid !== undefined && targetEid !== world.ctx.localPlayerId) {
            if (hasComponent(world, Health, targetEid)) {
                Health.current[targetEid] = data.health;
            }
        }
    };

    const handleRespawn = (data: any) => {
        console.log("Received respawn confirmation from server", data.newState);
        const localPlayers = localPlayerQuery(world);
        if (localPlayers.length > 0) {
            const localEid = localPlayers[0];
            const newState = data.newState;

            // Forcefully set state based on server respawn data
            if (newState.position) {
                Transform.x[localEid] = newState.position.x;
                Transform.y[localEid] = newState.position.y;
                Transform.z[localEid] = newState.position.z;
                const rb = world.ctx.maps.rb.get(localEid);
                if (rb) {
                    rb.setTranslation(newState.position, true);
                    rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
                    rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
                }
                // Reset vertical velocity in FPController
                if(hasComponent(world, FPController, localEid)) {
                    FPController.vertVel[localEid] = 0;
                    FPController.moveState[localEid] = MovementState.GROUNDED; // Assume grounded after respawn
                }
            }
            if (newState.rotation) {
                Transform.qx[localEid] = newState.rotation.x;
                Transform.qy[localEid] = newState.rotation.y;
                Transform.qz[localEid] = newState.rotation.z;
                Transform.qw[localEid] = newState.rotation.w;
                const rb = world.ctx.maps.rb.get(localEid);
                if(rb) rb.setRotation(newState.rotation, true);
                // Also potentially update camera pitch if needed, though server usually doesn't dictate this
            }
            if (newState.health !== undefined) {
                Health.current[localEid] = newState.health;
                Health.max[localEid] = newState.maxHealth || PlayerConfig.MAX_HEALTH;
            }
            AnimationState.state[localEid] = PlayerAnimationState.IDLE; // Reset animation

            console.log(`Local player respawned at ${newState.position.x.toFixed(2)}, ${newState.position.y.toFixed(2)}, ${newState.position.z.toFixed(2)}`);
            // Trigger UI updates if necessary
        }
    };

    // --- System Logic ---
    return (w: ECS) => {
        const now = Date.now();

        // --- Process Incoming Messages ---
        while (w.network.messageQueue.length > 0) {
            const message = w.network.messageQueue.shift();
            switch (message.type) {
                case 'init': handleInit(message); break;
                case 'playerJoined': handlePlayerJoined(message); break;
                case 'playerLeft': handlePlayerLeft(message); break;
                case 'worldState': handleWorldState(message); break; // Use worldState for updates
                case 'playerShoot': handlePlayerShoot(message); break;
                case 'playerDamaged': handlePlayerDamaged(message); break; // When local player is damaged
                case 'healthUpdate': handleHealthUpdate(message); break; // For remote player health changes
                case 'respawn': handleRespawn(message); break;
                case 'hitConfirmed': /* Optional: Show hit marker for local player */ break;
                case 'playerDefeated': /* Optional: Show kill feed message */ break;
                case 'playerRespawned': /* Optional: Handle remote player visual respawn */ break;
                case 'ping': /* Server ping, client can ignore or track latency */ break;
                case 'error': console.error("Server Error:", message.message); break;
                default: console.warn("Received unhandled message type:", message.type);
            }
        }

        // --- Send Local Player Updates ---
        if (w.network.connected && now - w.network.lastSentTime > NetworkConfig.UPDATE_INTERVAL_MS) {
            const localPlayers = localPlayerQuery(w);
            if (localPlayers.length > 0) {
                const eid = localPlayers[0];
                const currentState = {
                    position: { x: Transform.x[eid], y: Transform.y[eid], z: Transform.z[eid] },
                    rotation: { x: Transform.qx[eid], y: Transform.qy[eid], z: Transform.qz[eid], w: Transform.qw[eid] },
                    animationState: AnimationState.state[eid],
                    health: Health.current[eid]
                };

                network.send({ type: 'playerUpdate', state: currentState });
                w.network.lastSentTime = now;
            }
        }

        // --- Interpolate Remote Players ---
        const remoteEntities = remotePlayerQuery(w);
        // Use a fixed delay for interpolation between server updates
        const renderTime = now - NetworkConfig.INTERPOLATION_DELAY_MS;

        for (const eid of remoteEntities) {
            // Get the target state from InterpolationTarget component
            const currentTimestamp = InterpolationTarget.timestamp[eid];
            const targetX = InterpolationTarget.targetX[eid];
            const targetY = InterpolationTarget.targetY[eid];
            const targetZ = InterpolationTarget.targetZ[eid];
            const targetQX = InterpolationTarget.targetQX[eid];
            const targetQY = InterpolationTarget.targetQY[eid];
            const targetQZ = InterpolationTarget.targetQZ[eid];
            const targetQW = InterpolationTarget.targetQW[eid];

            // Smooth interpolation factor - adjust this based on network conditions
            const lerpFactor = 0.1; // Reduced from 0.2 for smoother movement

            // Update position with interpolation
            Transform.x[eid] += (targetX - Transform.x[eid]) * lerpFactor;
            Transform.y[eid] += (targetY - Transform.y[eid]) * lerpFactor;
            Transform.z[eid] += (targetZ - Transform.z[eid]) * lerpFactor;

            // Use Quaternion slerp for smoother rotation interpolation
            const currentQuat = new THREE.Quaternion(Transform.qx[eid], Transform.qy[eid], Transform.qz[eid], Transform.qw[eid]);
            const targetQuat = new THREE.Quaternion(targetQX, targetQY, targetQZ, targetQW);
            
            // Use a smaller factor for rotation to avoid jittering
            const rotLerpFactor = 0.08; // Slower rotation interpolation
            currentQuat.slerp(targetQuat, rotLerpFactor);

            Transform.qx[eid] = currentQuat.x;
            Transform.qy[eid] = currentQuat.y;
            Transform.qz[eid] = currentQuat.z;
            Transform.qw[eid] = currentQuat.w;
            
            // Optional: Update the mesh directly here if needed
            // But generally this should be handled by renderSync
        }

        // --- Handle Player Model Loading for New Remote Players ---
        const entered = remotePlayerEnterQuery(w);
        for (const eid of entered) {
            const networkId = NetworkId.id[eid];
            console.log(`Remote player entity ${eid} (NetworkID: ${networkId}) entered query. Setting up model...`);
            // Ensure the setup runs only once per entity entry
            if (!world.ctx.maps.mesh.has(eid)) {
                setupRemotePlayerModel(world, world.ctx, eid, networkId);
            }
        }

        // --- Handle Cleanup for Removed Remote Players ---
        const exited = remotePlayerExitQuery(w);
        for (const eid of exited) {
            console.log(`Remote player entity ${eid} exited query. Cleaning up...`);
            removeRemotePlayer(world, world.ctx, eid);
            // The NetworkId mapping is cleaned up in handlePlayerLeft
        }

        // --- Ping Server ---
        if (w.network.connected && now - w.network.lastPingTime > NetworkConfig.PING_INTERVAL_MS) {
            network.send({ type: 'ping' });
            w.network.lastPingTime = now;
        }

        return w;
    };
}

async function addRemotePlayer(world: ECS, ctx: ECSContext, playerState: any) {
    if (ctx.localPlayerId === playerState.id) {
        console.warn(`Attempted to add local player ${playerState.id} as remote.`);
        return;
    }
    if (world.players.has(playerState.id)) {
        console.warn(`Remote player ${playerState.id} already exists.`);
        return;
    }

    const eid = addEntity(world);
    addComponent(world, RemotePlayer, eid);
    addComponent(world, NetworkId, eid);
    addComponent(world, Transform, eid);
    addComponent(world, MeshRef, eid); // Needed for RenderSync
    addComponent(world, Health, eid);
    addComponent(world, AnimationState, eid);
    addComponent(world, InterpolationTarget, eid); // For smooth movement

    NetworkId.id[eid] = playerState.id;
    Transform.x[eid] = playerState.position.x;
    Transform.y[eid] = playerState.position.y;
    Transform.z[eid] = playerState.position.z;
    Transform.qx[eid] = playerState.rotation.x;
    Transform.qy[eid] = playerState.rotation.y;
    Transform.qz[eid] = playerState.rotation.z;
    Transform.qw[eid] = playerState.rotation.w;
    Health.current[eid] = playerState.health;
    Health.max[eid] = playerState.maxHealth || PlayerConfig.MAX_HEALTH; // Use default if not provided
    AnimationState.state[eid] = playerState.animationState;

    // Initialize interpolation target to current state
    InterpolationTarget.targetX[eid] = playerState.position.x;
    InterpolationTarget.targetY[eid] = playerState.position.y;
    InterpolationTarget.targetZ[eid] = playerState.position.z;
    InterpolationTarget.targetQX[eid] = playerState.rotation.x;
    InterpolationTarget.targetQY[eid] = playerState.rotation.y;
    InterpolationTarget.targetQZ[eid] = playerState.rotation.z;
    InterpolationTarget.targetQW[eid] = playerState.rotation.w;
    InterpolationTarget.timestamp[eid] = Date.now(); // Use current time initially

    world.players.set(playerState.id, eid); // Map NetworkId to EntityId

    console.log(`Added remote player entity ${eid} for NetworkId ${playerState.id}`);

    // Model setup is now handled by the enterQuery in the system loop
}

async function setupRemotePlayerModel(world: ECS, ctx: ECSContext, eid: number, networkId: number) {
    console.log(`Setting up model for remote entity ${eid} (NetworkID: ${networkId})`);
    const loader = new GLTFLoader();
    try {
        const gltf = await loader.loadAsync('/models/playermodel.glb');
        const model = gltf.scene;

        model.scale.set(1, 1, 1); // Adjust scale as needed
        model.position.set(0, 0, 0); // Position should be at entity center, not offset
        model.rotation.y = 0; // Don't add rotation - let the transform handle it
        
        // Add animation mixer if animations exist
        let mixer: THREE.AnimationMixer | null = null;
        if (gltf.animations && gltf.animations.length > 0) {
            mixer = new THREE.AnimationMixer(model);
            // Store animations/actions for playback later
            model.userData.animations = gltf.animations; // Store animations raw data
            model.userData.mixer = mixer;
            model.userData.actions = {};
            
            gltf.animations.forEach(clip => {
                // Rename the clips to standardized names for better matching
                let clipName = clip.name.toLowerCase();
                let standardName = clip.name;
                
                if (clipName.includes('idle')) standardName = 'idle';
                else if (clipName.includes('walk')) standardName = 'walk';
                else if (clipName.includes('run')) standardName = 'run';
                else if (clipName.includes('jump')) {
                    if (clipName.includes('start')) standardName = 'jump_start';
                    else if (clipName.includes('fall')) standardName = 'jump_fall';
                    else standardName = 'jump';
                }
                
                const action = mixer.clipAction(clip);
                action.setLoop(THREE.LoopRepeat, Infinity);
                model.userData.actions[standardName] = action;
                console.log(`Animation loaded for remote player: ${standardName}`);
            });
            
            // Start idle animation by default
            if (model.userData.actions['idle']) {
                model.userData.actions['idle'].play();
            }
        }

        model.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        ctx.three.scene.add(model);
        ctx.maps.mesh.set(eid, model); // Link entity ID to the model
        console.log(`Model added for remote player ${networkId} (Entity ${eid})`);

    } catch (error) {
        console.error(`Failed to load model for remote player ${networkId}:`, error);
        // Optionally add a placeholder mesh on error
        const placeholder = new THREE.Mesh(
            new THREE.BoxGeometry(0.6, 1.8, 0.6),
            new THREE.MeshStandardMaterial({ color: 0xcccccc })
        );
        placeholder.position.y = 0.9;
        ctx.three.scene.add(placeholder);
        ctx.maps.mesh.set(eid, placeholder);
    }
}

function removeRemotePlayer(world: ECS, ctx: ECSContext, eid: number) {
    const mesh = ctx.maps.mesh.get(eid);
    if (mesh) {
        // Properly dispose of mesh resources
        mesh.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                child.geometry?.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach((mat) => mat.dispose());
                    } else {
                        child.material.dispose();
                    }
                }
            }
        });
        ctx.three.scene.remove(mesh);
        ctx.maps.mesh.delete(eid);
    }
    
    // Remove Rapier body if it exists (remote players might not have one client-side)
    const rb = ctx.maps.rb.get(eid);
    if (rb) {
        ctx.physics.removeRigidBody(rb);
        ctx.maps.rb.delete(eid);
        if (ctx.entityHandleMap) {
            ctx.entityHandleMap.delete(rb.handle);
        }
    }

    // Remove the entity itself if it still exists
    if (hasComponent(world, NetworkId, eid)) { // Check if entity might have been removed already
        removeEntity(world, eid);
        console.log(`Removed remote player entity ${eid}`);
    } else {
        console.log(`Entity ${eid} already removed or invalid.`);
    }
}