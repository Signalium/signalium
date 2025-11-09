/**
 * NetworkManager - Tracks network connectivity status
 *
 * Features:
 * - Signal-based reactivity for online/offline status
 * - Automatic detection using navigator.onLine and events
 * - Manual override capability for testing and custom scenarios
 * - Platform-agnostic (works in browser and React Native)
 */

import { signal, Signal, context, Context } from 'signalium';

export class NetworkManager {
  private onlineSignal: Signal<boolean>;
  private manualOverride: boolean | undefined = undefined;
  private eventListenersAttached = false;

  constructor(initialStatus?: boolean) {
    // Initialize with manual status if provided, otherwise detect from environment
    const initialOnlineStatus = initialStatus ?? this.detectOnlineStatus();
    this.onlineSignal = signal(initialOnlineStatus);

    // Automatically attach event listeners if in browser/React Native environment
    if (this.canAttachListeners()) {
      this.attachEventListeners();
    }
  }

  /**
   * Returns true if the network is currently online
   */
  get isOnline(): boolean {
    // Manual override takes precedence
    if (this.manualOverride !== undefined) {
      return this.manualOverride;
    }

    return this.onlineSignal.value;
  }

  /**
   * Manually set the network status (useful for testing)
   */
  setNetworkStatus(online: boolean): void {
    this.manualOverride = online;
    this.onlineSignal.value = online;
  }

  /**
   * Clear manual override and return to automatic detection
   */
  clearManualOverride(): void {
    this.manualOverride = undefined;
    this.onlineSignal.value = this.detectOnlineStatus();
  }

  /**
   * Get the reactive signal for online status
   * This allows reactive functions to depend on network status
   */
  getOnlineSignal(): Signal<boolean> {
    return this.onlineSignal;
  }

  /**
   * Detect current online status from the environment
   */
  private detectOnlineStatus(): boolean {
    // Check if we're in a browser or React Native environment
    if (typeof navigator !== 'undefined' && 'onLine' in navigator) {
      return navigator.onLine;
    }

    // Default to online if we can't detect (e.g., Node.js/SSR)
    return true;
  }

  /**
   * Check if we can attach event listeners (browser or React Native)
   */
  private canAttachListeners(): boolean {
    return typeof window !== 'undefined' && typeof window.addEventListener === 'function';
  }

  /**
   * Attach event listeners for online/offline events
   */
  private attachEventListeners(): void {
    if (this.eventListenersAttached) {
      return;
    }

    const handleOnline = () => {
      if (this.manualOverride === undefined) {
        this.onlineSignal.value = true;
      }
    };

    const handleOffline = () => {
      if (this.manualOverride === undefined) {
        this.onlineSignal.value = false;
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    this.eventListenersAttached = true;

    // Note: In a real production app, you might want to provide a cleanup method
    // to remove these listeners, but for a singleton that lives for the app lifetime,
    // it's not critical
  }
}

// Default singleton instance for convenience
export const defaultNetworkManager = new NetworkManager();

// Context for dependency injection
export const NetworkManagerContext: Context<NetworkManager> = context<NetworkManager>(defaultNetworkManager);
