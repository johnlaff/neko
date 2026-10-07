import { useEffect, useState } from "react";
import { api } from "./api.ts";

type State = "loading" | "unsupported" | "denied" | "off" | "on" | "busy";

const fromBase64Url = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

const registration = () =>
  "serviceWorker" in navigator && "PushManager" in window
    ? navigator.serviceWorker.ready
    : Promise.resolve(null);

/**
 * Re-sends this device's subscription once per visit. It ties the reminders to the signed-in
 * device (older subscriptions were saved without it), so signing it out stops them too.
 */
export const syncPush = () => {
  registration()
    .then((reg) => reg?.pushManager.getSubscription())
    .then((sub) => sub && api.subscribePush(sub.toJSON()))
    .catch(() => {});
};

/** Opt-in for the 08:00 and 21:00 notifications, on this device only. */
export const Reminders = () => {
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    registration().then(async (reg) => {
      if (!reg) return setState("unsupported");
      if (Notification.permission === "denied") return setState("denied");
      setState((await reg.pushManager.getSubscription()) ? "on" : "off");
    });
  }, []);

  const toggle = async () => {
    setError(null);
    const reg = await registration();
    if (!reg) return;
    setState("busy");
    try {
      const current = await reg.pushManager.getSubscription();
      if (current) {
        await api.unsubscribePush(current.endpoint);
        await current.unsubscribe();
        return setState("off");
      }
      const { publicKey } = await api.pushKey();
      if (!publicKey) throw new Error("Lembretes ainda não configurados no servidor.");
      if ((await Notification.requestPermission()) !== "granted") return setState("denied");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: fromBase64Url(publicKey),
      });
      await api.subscribePush(sub.toJSON());
      setState("on");
    } catch (e) {
      // Browser push errors come in English and name internals; say what to do instead.
      setError(
        e instanceof Error && e.message.startsWith("Lembretes")
          ? e.message
          : "Não deu para ativar agora. Confira a conexão e tente de novo.",
      );
      setState("off");
    }
  };

  const sub =
    error ??
    (state === "unsupported"
      ? "Instale o Neko na tela inicial primeiro"
      : state === "denied"
        ? "Bloqueadas no navegador. Libere nos ajustes dele"
        : "Às 8h, quanto cabe. Às 21h, hora de lançar");
  const on = state === "on";
  return (
    <label className="setting">
      <span className="label">
        Lembretes
        <span className={error ? "sub error" : "sub"}>{sub}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        className="switch"
        aria-checked={on}
        checked={on}
        onChange={toggle}
        disabled={state !== "on" && state !== "off"}
      />
    </label>
  );
};
