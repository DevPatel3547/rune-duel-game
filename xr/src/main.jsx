import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import { initNative } from './native.js';
import { initAccount } from './account.js';

// THE PRODUCT: the 3D first-person arena duel — draw runes with mouse/touch to
// cast spells at the wizard across the arena. Flat-screen first (desktop Safari,
// PC, Android, iOS); VR is optional and only surfaces if a headset is detected.
// (The older lane battle lives in ./lane/LaneApp.jsx — not the game we ship.)
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Status bar, launch splash and app lifecycle when running as the iOS app.
initNative();
// Restores a signed-in session, if accounts are configured for this build.
initAccount();
