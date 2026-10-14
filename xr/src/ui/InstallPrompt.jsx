import { useEffect, useState } from 'react';
import { IS_NATIVE } from '../native.js';

// Cross-platform "install this as an app" affordance.
// • Android / desktop Chrome/Edge: capture `beforeinstallprompt`, show an
//   Install button that fires the native prompt.
// • iOS Safari (no such event): show a one-line "Add to Home Screen" hint,
//   since Apple only supports manual A2HS.
// Hidden entirely once the app is already running standalone (installed).
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  // iPadOS 13+ reports as Mac; sniff touch to disambiguate
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [show, setShow] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    // Already an app: installed from the App Store, or added to the home screen.
    if (IS_NATIVE || isStandalone() || sessionStorage.getItem('rd-install-dismissed')) return;

    const onPrompt = (e) => {
      e.preventDefault();
      setDeferred(e);
      setShow(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', () => setShow(false));

    // iOS never fires beforeinstallprompt → offer the manual hint instead.
    if (isIOS() && !isStandalone()) {
      const t = setTimeout(() => { setIosHint(true); setShow(true); }, 1200);
      return () => { clearTimeout(t); window.removeEventListener('beforeinstallprompt', onPrompt); };
    }
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (!show) return null;

  const dismiss = () => { setShow(false); sessionStorage.setItem('rd-install-dismissed', '1'); };
  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch {}
    setDeferred(null);
    setShow(false);
  };

  return (
    <div className="install">
      <span className="installIcon">⚡</span>
      {iosHint ? (
        <span className="installTxt">Install: tap <b>Share</b> <span className="sh">⎋</span> → <b>Add to Home Screen</b></span>
      ) : (
        <span className="installTxt">Play it like an app — install Rune Duel.</span>
      )}
      {!iosHint && <button className="installBtn" onClick={install}>Install</button>}
      <button className="installX" onClick={dismiss} aria-label="Dismiss">✕</button>
    </div>
  );
}
