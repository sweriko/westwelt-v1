/**
 * Event utility functions for proper listener management
 */

// Track attached listeners for cleanup
const attachedListeners: Array<{
  target: EventTarget;
  type: string;
  listener: EventListenerOrEventListenerObject;
  options?: boolean | AddEventListenerOptions;
}> = [];

/**
 * Safely attach an event listener with tracking for easy cleanup
 * @param target The EventTarget to attach to (window, document, etc.)
 * @param type Event type (click, keydown, etc.)
 * @param listener The event listener function
 * @param options Optional addEventListener options
 */
export function safeAddEventListener(
  target: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions
): void {
  target.addEventListener(type, listener, options);
  attachedListeners.push({ target, type, listener, options });
}

/**
 * Remove all previously attached event listeners
 */
export function removeAllEventListeners(): void {
  for (const { target, type, listener, options } of attachedListeners) {
    target.removeEventListener(type, listener, options);
  }
  attachedListeners.length = 0;
}

/**
 * Setup handlers to clean up event listeners on page unload
 */
export function setupEventCleanup(): void {
  // Only set up once
  if ((window as any).__eventCleanupInitialized) return;
  
  window.addEventListener('beforeunload', removeAllEventListeners);
  (window as any).__eventCleanupInitialized = true;
} 