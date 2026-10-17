if (!globalThis.crypto?.randomUUID) {
  // @ts-ignore
  globalThis.crypto = globalThis.crypto || {};
  // @ts-ignore
  globalThis.crypto.randomUUID = () => {
    // If getRandomValues is missing, using Math.random fallback (which is less secure but fine for this fallback)
    const getRandomValues = globalThis.crypto.getRandomValues ? 
      globalThis.crypto.getRandomValues.bind(globalThis.crypto) : 
      (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) {
          arr[i] = Math.floor(Math.random() * 256);
        }
        return arr;
      };

    return ('10000000-1000-4000-8000-100000000000').replace(/[018]/g, (c: any) =>
      (c ^ (getRandomValues(new Uint8Array(1))[0] & 15) >> (c / 4)).toString(16)
    );
  };
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);