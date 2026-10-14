// The thin layer between the web game and the native iOS app (Capacitor).
// Everything here is a no-op in a browser, so the web build is unchanged.
import { Capacitor } from '@capacitor/core';
import { useGame } from './store.js';

export const IS_NATIVE = Capacitor.isNativePlatform();

let Haptics = null;
let ImpactStyle = null;

export async function initNative() {
  if (!IS_NATIVE) return;
  const [{ StatusBar }, { SplashScreen }, { App }, haptics] = await Promise.all([
    import('@capacitor/status-bar'),
    import('@capacitor/splash-screen'),
    import('@capacitor/app'),
    import('@capacitor/haptics'),
  ]);
  Haptics = haptics.Haptics;
  ImpactStyle = haptics.ImpactStyle;

  // A duel is full-screen; the clock and battery icons only cover the HUD.
  StatusBar.hide().catch(() => {});

  // The launch splash stays up until the page has painted, so the player never
  // sees a blank white web view between the two.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    SplashScreen.hide({ fadeOutDuration: 250 }).catch(() => {});
  }));

  // iOS suspends the app's network while it is in the background. Reconnect the
  // moment it returns rather than waiting out socket.io's retry backoff, so a
  // player who glanced at a notification is back inside the grace period.
  App.addListener('appStateChange', ({ isActive }) => {
    const socket = useGame.getState().driver?.socket;
    if (isActive && socket && !socket.connected) socket.connect();
  });
}

// A physical thump when a spell hits you, scaled 0..1. iOS Safari has no
// vibration API at all, so on iPhone only the native app can do this.
export function haptic(strength = 0.5) {
  if (IS_NATIVE) {
    if (!Haptics) return;
    const style = strength > 0.75 ? ImpactStyle.Heavy : strength > 0.4 ? ImpactStyle.Medium : ImpactStyle.Light;
    Haptics.impact({ style }).catch(() => {});
    return;
  }
  navigator.vibrate?.(Math.round(20 + strength * 40));
}
