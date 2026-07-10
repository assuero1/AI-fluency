"use client";

import { useEffect, useRef, useState } from "react";

export function PwaRegistration() {
  const [online, setOnline] = useState(true);
  const [updateReady, setUpdateReady] = useState(false);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    setOnline(navigator.onLine);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    if (!("serviceWorker" in navigator)) {
      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      };
    }

    let reloading = false;
    let disposed = false;
    let registrationWithListener: ServiceWorkerRegistration | null = null;
    let installingWorker: ServiceWorker | null = null;
    const handleControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    const handleWorkerStateChange = () => {
      if (!disposed && installingWorker?.state === "installed" && navigator.serviceWorker.controller) setUpdateReady(true);
    };
    const handleUpdateFound = () => {
      installingWorker?.removeEventListener("statechange", handleWorkerStateChange);
      installingWorker = registrationWithListener?.installing ?? null;
      installingWorker?.addEventListener("statechange", handleWorkerStateChange);
    };
    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    navigator.serviceWorker.register("/sw.js").then((registration) => {
      if (disposed) return;
      registrationRef.current = registration;
      if (registration.waiting && navigator.serviceWorker.controller) setUpdateReady(true);
      registrationWithListener = registration;
      registration.addEventListener("updatefound", handleUpdateFound);
    }).catch(() => {
      // The app remains usable online if service-worker registration is unavailable.
    });

    return () => {
      disposed = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
      registrationWithListener?.removeEventListener("updatefound", handleUpdateFound);
      installingWorker?.removeEventListener("statechange", handleWorkerStateChange);
    };
  }, []);

  function applyUpdate() {
    registrationRef.current?.waiting?.postMessage({ type: "SKIP_WAITING" });
  }

  if (!online) {
    return <div className="connectivity-banner" role="status">Sem conexão. Mensagens não enviadas não são salvas offline.</div>;
  }

  if (updateReady) {
    return (
      <div className="connectivity-banner update-banner" role="status">
        <span>Uma atualização do app está pronta.</span>
        <button onClick={applyUpdate} type="button">Atualizar agora</button>
      </div>
    );
  }

  return null;
}
