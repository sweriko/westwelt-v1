import { WebSocketServer } from 'ws';
import * as RAPIER from '@dimforge/rapier3d-compat'; // Import Rapier for server-side logic if needed

console.log("Initializing Rapier on the server...");
await RAPIER.init();
console.log("Rapier initialized.");

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

const players = new Map(); // playerId -> { ws, state }
let nextPlayerId = 1;

const TICK_RATE = 60; // Send updates 60 times per second
const SERVER_DT = 1 / TICK_RATE;

// --- Server-Side Rapier World (Optional but Recommended for Authority) ---
// If you want authoritative physics, uncomment and configure this.
// For this initial setup, we'll rely more on client state reporting + validation.
/*
const physicsWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const playerBodies = new Map(); // playerId -> Rapier RigidBody
*/
// --- End Server-Side Physics ---

console.log(`WebSocket server started on port ${PORT}`);

wss.on('connection', (ws) => {
    const playerId = nextPlayerId++;
    console.log(`Player ${playerId} connected.`);

    const initialState = {
        id: playerId,
        position: { x: 0, y: 5, z: 0 }, // Initial spawn position
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        animationState: 0, // e.g., Idle
        health: 100,
        maxHealth: 100,
        lastUpdateTime: Date.now()
    };
    players.set(playerId, { ws, state: initialState });

    // --- Server-Side Physics Body (Optional) ---
    /*
    const playerBodyDesc = RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(initialState.position.x, initialState.position.y, initialState.position.z)
        .setAdditionalMass(1.0); // Give players mass
    const playerBody = physicsWorld.createRigidBody(playerBodyDesc);
    const playerColliderDesc = RAPIER.ColliderDesc.capsule(0.9, 0.3); // Match client collider
    physicsWorld.createCollider(playerColliderDesc, playerBody);
    playerBodies.set(playerId, playerBody);
    */
    // --- End Server-Side Physics Body ---

    // Send init data to the new player
    ws.send(JSON.stringify({
        type: 'init',
        playerId: playerId,
        initialState: initialState,
        // Send state of all other currently connected players
        players: Array.from(players.values())
                       .filter(p => p.state.id !== playerId) // Exclude self
                       .map(p => p.state)
    }));

    // Notify other players about the new player
    broadcast({
        type: 'playerJoined',
        playerState: initialState
    }, ws); // Exclude the new player itself

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message.toString());
            const player = players.get(playerId);
            if (!player) return;

            player.state.lastUpdateTime = Date.now(); // Keep track of activity

            switch (data.type) {
                case 'playerUpdate':
                    // Basic validation (more can be added)
                    if (isValidState(data.state)) {
                        // Update server state directly for now
                        player.state = { ...player.state, ...data.state };

                        // --- Server-Side Physics Update (Optional) ---
                        /*
                        const body = playerBodies.get(playerId);
                        if (body && data.state.position && data.state.rotation) {
                            // Apply position/rotation updates to the server-side body
                            // Add checks to prevent cheating (e.g., teleporting)
                            body.setTranslation(data.state.position, true);
                            body.setRotation(data.state.rotation, true);
                            // Or apply forces/velocities based on input in data.state
                        }
                        */
                        // --- End Server-Side Physics Update ---

                        // Don't broadcast immediately, wait for server tick
                    } else {
                        console.warn(`Invalid state update received from player ${playerId}`);
                    }
                    break;

                case 'shoot':
                    // Validate shoot request (e.g., cooldown, ammo)
                    console.log(`Player ${playerId} shot`);
                    // Broadcast the shoot event to other players
                    broadcast({
                        type: 'playerShoot',
                        playerId: playerId,
                        position: data.position,
                        direction: data.direction
                    }, ws); // Exclude shooter
                    break;

                case 'playerHit': // Message from shooter reporting they hit someone
                    const targetPlayer = players.get(data.targetId);
                    const sourcePlayer = players.get(playerId);

                    if (targetPlayer && sourcePlayer) {
                        // SERVER-AUTHORITATIVE HIT VALIDATION NEEDED HERE
                        // 1. Raycast from sourcePlayer's validated position/direction
                        // 2. Check distance, line of sight, timing, etc.
                        // 3. If valid, apply damage and broadcast

                        // --- Simplified Hit Processing (Trusting Client - NOT SECURE) ---
                        console.log(`Player ${playerId} reported hitting player ${data.targetId} on zone ${data.hitZone}`);
                        targetPlayer.state.health = Math.max(0, targetPlayer.state.health - data.damage);

                        // Notify the hit player
                        if (targetPlayer.ws.readyState === WebSocket.OPEN) {
                            targetPlayer.ws.send(JSON.stringify({
                                type: 'playerDamaged',
                                sourceId: playerId,
                                damage: data.damage,
                                hitZone: data.hitZone,
                                newHealth: targetPlayer.state.health
                            }));
                        }

                        // Confirm the hit back to the shooter
                        if (sourcePlayer.ws.readyState === WebSocket.OPEN) {
                           sourcePlayer.ws.send(JSON.stringify({
                                type: 'hitConfirmed',
                                targetId: data.targetId,
                                newHealth: targetPlayer.state.health
                           }));
                        }

                         // Broadcast health update for the target player
                        broadcast({
                            type: 'healthUpdate',
                            playerId: data.targetId,
                            health: targetPlayer.state.health
                        });


                        if (targetPlayer.state.health <= 0) {
                            console.log(`Player ${data.targetId} defeated by Player ${playerId}`);
                            // Handle player defeat (e.g., respawn logic)
                             handlePlayerDefeat(data.targetId, playerId);
                        }
                        // --- End Simplified Hit Processing ---
                    }
                    break;

                case 'pong':
                    // Client responded to ping, update last activity time
                    player.state.lastUpdateTime = Date.now();
                    break;

                default:
                    console.log(`Received unknown message type: ${data.type}`);
            }
        } catch (error) {
            console.error(`Failed to process message: ${error}`);
        }
    });

    ws.on('close', () => {
        console.log(`Player ${playerId} disconnected.`);
        const player = players.get(playerId);

        // --- Server-Side Physics Cleanup (Optional) ---
        /*
        const body = playerBodies.get(playerId);
        if (body) {
            physicsWorld.removeRigidBody(body);
            playerBodies.delete(playerId);
        }
        */
        // --- End Server-Side Physics Cleanup ---

        players.delete(playerId);
        broadcast({ type: 'playerLeft', playerId });
    });

    ws.on('error', (error) => {
        console.error(`WebSocket error for player ${playerId}: ${error}`);
        ws.close(); // Force close on error
        // Cleanup is handled by the 'close' event
    });
});

// Basic state validation
function isValidState(state) {
    if (!state) return false;
    // Add more checks: position bounds, rotation validity, etc.
    if (state.position && (isNaN(state.position.x) || isNaN(state.position.y) || isNaN(state.position.z))) return false;
    if (state.rotation && (isNaN(state.rotation.x) || isNaN(state.rotation.y) || isNaN(state.rotation.z) || isNaN(state.rotation.w))) return false;
    if (state.health && (isNaN(state.health) || state.health < 0)) return false; // Health shouldn't be NaN or negative before server processes death
    if (state.animationState && isNaN(state.animationState)) return false;
    return true;
}

// Function to broadcast messages to all connected clients (optionally excluding one)
function broadcast(data, senderWs = null) {
    const message = JSON.stringify(data);
    players.forEach((player) => {
        if (player.ws !== senderWs && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(message);
        }
    });
}

function handlePlayerDefeat(defeatedPlayerId, killerPlayerId) {
    // Notify everyone about the defeat
    broadcast({ type: 'playerDefeated', defeatedId: defeatedPlayerId, killerId: killerPlayerId });

    // Schedule respawn
    setTimeout(() => {
        const player = players.get(defeatedPlayerId);
        if (player && player.ws.readyState === WebSocket.OPEN) { // Check if player still connected
            // Reset state and assign new spawn position
            const spawnPosition = { x: (Math.random() - 0.5) * 20, y: 5, z: (Math.random() - 0.5) * 20 }; // Example random spawn
            player.state.position = spawnPosition;
            player.state.health = player.state.maxHealth;
            player.state.animationState = 0; // Reset to Idle

            // --- Server-Side Physics Reset (Optional) ---
            /*
            const body = playerBodies.get(defeatedPlayerId);
            if (body) {
                body.setTranslation(spawnPosition, true);
                body.setLinvel({ x: 0, y: 0, z: 0 }, true);
                body.setAngvel({ x: 0, y: 0, z: 0 }, true);
            }
            */
           // --- End Server-Side Physics Reset ---


            console.log(`Player ${defeatedPlayerId} respawning.`);

            // Notify the respawned player
            player.ws.send(JSON.stringify({
                type: 'respawn',
                newState: player.state
            }));

            // Notify others about the respawn (sends the full new state)
             broadcast({
                 type: 'playerRespawned',
                 playerState: player.state
             }, player.ws);

        } else {
             console.log(`Player ${defeatedPlayerId} disconnected before respawn.`);
        }
    }, 3000); // 3-second respawn delay
}

// Server-side game loop for physics and state broadcasting
let lastTickTime = Date.now();
function gameLoop() {
    const now = Date.now();
    const delta = (now - lastTickTime) / 1000; // Delta time in seconds
    lastTickTime = now;

    // --- Server-Side Physics Step (Optional) ---
    // physicsWorld.step();
    // --- End Server-Side Physics Step ---

    // Gather current state of all players
    const worldState = {
        type: 'worldState',
        timestamp: Date.now(),
        players: []
    };

    players.forEach((player, playerId) => {
         // --- Update player state from physics world (Optional) ---
         /*
         const body = playerBodies.get(playerId);
         if (body) {
             const pos = body.translation();
             const rot = body.rotation();
             player.state.position = { x: pos.x, y: pos.y, z: pos.z };
             player.state.rotation = { x: rot.x, y: rot.y, z: rot.z, w: rot.w };
             // You might also derive animationState from velocity here
         }
         */
        // --- End Update from physics ---
        worldState.players.push(player.state);
    });

    // Broadcast the world state to all players
    if (worldState.players.length > 0) {
        broadcast(worldState);
    }

     // Heartbeat / Keep-alive ping
    players.forEach((player) => {
        if (player.ws.readyState === WebSocket.OPEN) {
             if (now - player.state.lastUpdateTime > 10000) { // Check for inactivity (e.g., 10 seconds)
                 player.ws.ping(); // Send WebSocket ping
             }
        }
    });

}

setInterval(gameLoop, 1000 / TICK_RATE); // Run game loop at TICK_RATE Hz

// Basic keep-alive/timeout check
setInterval(() => {
    const now = Date.now();
    players.forEach((player, playerId) => {
        if (now - player.state.lastUpdateTime > 30000) { // 30 seconds timeout
            console.log(`Player ${playerId} timed out.`);
            player.ws.terminate(); // Force close connection
            // Cleanup is handled by the 'close' event
        }
    });
}, 10000); // Check every 10 seconds