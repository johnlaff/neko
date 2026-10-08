import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "./api.ts";
import { BrandMark } from "./BrandMark.tsx";

interface Gis {
  accounts: {
    id: {
      initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
      renderButton: (el: HTMLElement, o: Record<string, string>) => void;
    };
  };
}

const loadGis = () =>
  new Promise<Gis>((resolve, reject) => {
    const w = window as unknown as { google?: Gis };
    if (w.google) return resolve(w.google);
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = () => (w.google ? resolve(w.google) : reject(new Error("gis")));
    s.onerror = reject;
    document.head.append(s);
  });

/** The invite token arrives as ?convite=… in the link sent to the owner. */
const inviteFromUrl = () => new URLSearchParams(window.location.search).get("convite");

const passkeyError = (e: unknown, creating: boolean) => {
  if (e instanceof Error && e.name === "NotAllowedError")
    return "Cancelado. Tente de novo quando quiser.";
  if (e instanceof ApiError && e.code === "invite-invalid")
    return "Este convite expirou ou já foi usado. Peça um novo.";
  if (e instanceof ApiError && e.code === "passkey-rejected")
    return creating
      ? "Não deu para salvar a passkey. Tente de novo."
      : "Esta passkey não tem acesso ao Neko.";
  return "Não deu para entrar agora. Confira a conexão e tente de novo.";
};

const GoogleButton = ({
  clientId,
  onError,
}: {
  clientId: string;
  onError: (m: string) => void;
}) => {
  const button = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!button.current) return;
    const el = button.current;
    loadGis()
      .then((g) => {
        g.accounts.id.initialize({
          client_id: clientId,
          callback: ({ credential }) =>
            api
              .login(credential)
              .then(() => queryClient.invalidateQueries({ queryKey: ["me"] }))
              .catch(() => onError("Essa conta não tem acesso ao Neko.")),
        });
        g.accounts.id.renderButton(el, {
          theme: "filled_black",
          size: "large",
          shape: "pill",
          text: "signin_with",
          locale: "pt-BR",
        });
      })
      .catch(() => onError("Não consegui carregar o login do Google."));
  }, [clientId, queryClient, onError]);
  return <div ref={button} />;
};

export const Login = () => {
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });
  const queryClient = useQueryClient();
  const [invite, setInvite] = useState(inviteFromUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientId = config.data?.googleClientId;

  const signedIn = async () => {
    window.history.replaceState(null, "", "/");
    setInvite(null);
    await queryClient.invalidateQueries({ queryKey: ["me"] });
  };

  const run = async (creating: boolean, task: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await task();
      await signedIn();
    } catch (e) {
      setError(passkeyError(e, creating));
    } finally {
      setBusy(false);
    }
  };

  const create = (token: string) =>
    run(true, async () => {
      const optionsJSON = await api.passkeyRegisterOptions(token);
      await api.passkeyRegister(token, await startRegistration({ optionsJSON }));
    });

  const enter = () =>
    run(false, async () => {
      const optionsJSON = await api.passkeyLoginOptions();
      await api.passkeyLogin(await startAuthentication({ optionsJSON }));
    });

  return (
    <main className="center login">
      <div className="login-mark">
        <BrandMark />
        <h1 className="login-name">Neko</h1>
      </div>
      {invite ? (
        <>
          <p className="muted">
            Crie uma passkey neste aparelho. Depois, você entra com o desbloqueio do celular, sem
            senha.
          </p>
          <button type="button" disabled={busy} onClick={() => create(invite)}>
            {busy ? "Aguardando o aparelho…" : "Criar passkey"}
          </button>
        </>
      ) : (
        <>
          <p className="muted">Sua planilha, lida todo dia.</p>
          <button type="button" disabled={busy} onClick={enter}>
            {busy ? "Aguardando o aparelho…" : "Entrar com passkey"}
          </button>
          {clientId && <GoogleButton clientId={clientId} onError={setError} />}
        </>
      )}
      {error && (
        <p className="warn" role="alert">
          {error}
        </p>
      )}
      <p className="footnote">Só leitura: o Neko nunca altera a sua planilha.</p>
    </main>
  );
};
