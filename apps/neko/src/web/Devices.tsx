import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Device } from "./api.ts";
import { IconLaptop, IconPhone } from "./icons.tsx";

const MOBILE = /iPhone|iPad|Android/;

/** "Usado hoje", "Usado ontem", "Usado há 12 dias", from the device's own clock. */
const lastUsed = (iso: string) => {
  const day = (d: Date) => Math.floor((d.getTime() - d.getTimezoneOffset() * 60_000) / 86_400_000);
  const diff = day(new Date()) - day(new Date(iso));
  return diff <= 0 ? "Usado hoje" : diff === 1 ? "Usado ontem" : `Usado há ${diff} dias`;
};

/** Where Neko is signed in, with a way to sign any other browser out. */
export const Devices = () => {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["sessions"], queryFn: api.sessions });
  const done = () => queryClient.invalidateQueries({ queryKey: ["sessions"] });
  const end = useMutation({ mutationFn: api.endSession, onSuccess: done });
  const endOthers = useMutation({ mutationFn: api.endOtherSessions, onSuccess: done });
  if (!list.data) return null;
  const others = list.data.filter((d) => !d.current).length;

  return (
    <section className="group" aria-labelledby="g-devices">
      <h2 id="g-devices">Aparelhos conectados</h2>
      <ul className="panel list devices">
        {list.data.map((d: Device) => (
          <li key={d.id} className="setting">
            <span className="device-icon">
              {MOBILE.test(d.device) ? <IconPhone /> : <IconLaptop />}
            </span>
            <span className="label">
              {d.device}
              <span className={d.current ? "sub here" : "sub"}>
                {d.current ? "Este aparelho" : lastUsed(d.lastSeenAt)}
              </span>
            </span>
            {!d.current && (
              <button
                type="button"
                className="ghost small"
                disabled={end.isPending}
                aria-label={`Sair do ${d.device}`}
                onClick={() => end.mutate(d.id)}
              >
                Sair
              </button>
            )}
          </li>
        ))}
        {others > 1 && (
          <li>
            <button
              type="button"
              className="setting danger"
              disabled={endOthers.isPending}
              onClick={() => endOthers.mutate()}
            >
              Sair dos outros {others} aparelhos
            </button>
          </li>
        )}
      </ul>
    </section>
  );
};
