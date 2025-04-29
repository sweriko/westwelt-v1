import { addComponent, addEntity } from 'bitecs';
import { DebugVis } from '../components';
import { ECS } from '../world';
import { safeAddEventListener, setupEventCleanup } from '../utils/eventUtils';

// Add property to Window interface
declare global {
  interface Window {
    listenersAttached?: boolean;
  }
}

export interface InputState {
  fw: boolean; bk: boolean; lf: boolean; rt: boolean;
  sprint: boolean;
  shoot: boolean; jump: boolean;
  pointerLocked: boolean;
  dx: number; dy: number;
  debugActive: boolean;
}

export function initInputSystem(world: ECS) {
  const state: InputState = {
    fw: false, bk: false, lf: false, rt: false,
    sprint: false,
    shoot: false, jump: false,
    pointerLocked: false,
    dx: 0, dy: 0,
    debugActive: false
  };
  
  // Keep track of whether V was pressed last frame
  let vWasPressed = false;
  
  // Create a singleton debug entity and add the component to it
  const debugId = addEntity(world); // Create a new entity, don't assume ID 0
  addComponent(world, DebugVis, debugId);
  DebugVis.active[debugId] = 0; // 0 = off, 1 = on

  /* keyboard ------------------------------------------------------- */
  const key = (code: string, v: boolean) => {
    if (code === 'KeyW' || code === 'ArrowUp')    state.fw     = v;
    if (code === 'KeyS' || code === 'ArrowDown')  state.bk     = v;
    if (code === 'KeyA' || code === 'ArrowLeft')  state.lf     = v;
    if (code === 'KeyD' || code === 'ArrowRight') state.rt     = v;
    if (code === 'Space')                         state.jump   = v;
    if (code === 'ShiftLeft' || code === 'ShiftRight') state.sprint = v;
    
    // Handle V key press for debug visualization toggle
    if (code === 'KeyV') {
      // Toggle on key down only
      if (v && !vWasPressed) {
        // Toggle debug state
        const newState = DebugVis.active[debugId] === 0 ? 1 : 0;
        DebugVis.active[debugId] = newState;
        state.debugActive = newState === 1;
        console.log(`Debug visualization: ${state.debugActive ? 'ON' : 'OFF'}`);
      }
      vWasPressed = v;
    }
  };
  
  // Only attach event listeners once
  if (!window.listenersAttached) {
    safeAddEventListener(window, 'keydown', e => key((e as KeyboardEvent).code, true));
    safeAddEventListener(window, 'keyup',   e => key((e as KeyboardEvent).code, false));

    /* mouse ---------------------------------------------------------- */
    const canvas = document.getElementById('c') as HTMLCanvasElement;
    safeAddEventListener(canvas, 'click', () => canvas.requestPointerLock());

    safeAddEventListener(document, 'pointerlockchange', () => {
      state.pointerLocked = !!document.pointerLockElement;
    });

    safeAddEventListener(window, 'mousemove', e => {
      if (!state.pointerLocked) return;
      state.dx += (e as MouseEvent).movementX;
      state.dy += (e as MouseEvent).movementY;
    });

    safeAddEventListener(window, 'mousedown', e => { if ((e as MouseEvent).button === 0) state.shoot = true; });
    safeAddEventListener(window, 'mouseup',   e => { if ((e as MouseEvent).button === 0) state.shoot = false; });
    
    // Set up event cleanup
    setupEventCleanup();
    
    // Mark listeners as attached
    window.listenersAttached = true;
  }

  return (w: ECS) => { 
    // Set the input state on the world
    w.input = state;
    return w;
  };
}
