import { defineQuery, hasComponent, removeEntity } from "bitecs";
import { Health, LocalPlayer, NetworkId, RemotePlayer } from "../components";
import { ECS } from "../world";
import { network } from "./network/client"; // Assuming network client is accessible

export function initHealthSystem(world: ECS) {
    const playerQuery = defineQuery([Health, NetworkId]); // Query players with health and network ID

    return (w: ECS) => {
        const entities = playerQuery(w);

        for (const eid of entities) {
            if (Health.current[eid] <= 0) {
                // Player is defeated
                if (hasComponent(w, LocalPlayer, eid)) {
                    // Handle local player death (e.g., show death screen, disable input)
                    // The server will send the actual respawn command
                    if (!w.ctx.localPlayerDefeated) { // Prevent multiple death triggers
                        console.log("Local player defeated! Waiting for server respawn...");
                        w.ctx.localPlayerDefeated = true; // Flag to prevent re-triggering
                        // Optionally disable local player controls here
                        // The 'respawn' message from the server will re-enable things
                    }
                } else if (hasComponent(w, RemotePlayer, eid)) {
                    // Handle remote player death visual/sound (optional)
                    // Server handles actual removal/respawn logic
                     // console.log(`Remote player ${NetworkId.id[eid]} visually defeated.`);
                     // Potentially trigger death animation here if not handled by worldState update
                     // Note: Server might remove the player entity shortly after defeat broadcast
                }

                // Note: Don't remove the entity here. The server controls entity lifetime.
                // The server will either send a respawn update or a playerLeft message.
            } else {
                 // If player was defeated but now has health > 0 (likely respawned)
                 if (hasComponent(w, LocalPlayer, eid) && w.ctx.localPlayerDefeated) {
                     console.log("Local player respawned.");
                     w.ctx.localPlayerDefeated = false; // Reset defeated flag
                     // Re-enable controls if they were disabled
                 }
            }
        }

        // Reset local player defeated flag if the entity is removed (e.g., disconnect)
        if (w.ctx.localPlayerDefeated && !entities.includes(world.players.get(world.ctx.localPlayerId!)!)) {
             w.ctx.localPlayerDefeated = false;
        }


        return w;
    };
}

// Add localPlayerDefeated flag to ECSContext interface in world.ts
declare module '../world' {
    interface ECSContext {
        localPlayerDefeated?: boolean;
    }
}