import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { api } from "../api.ts";
import { capitalize, money, shortDate, toCents } from "../format.ts";
import { IconChevron } from "../icons.tsx";

/** How someone's part is picked: half, a third, or a value typed in. */
type Mode = "half" | "third" | "other";

const NEW = "\u0000nova";

/**
 * Whose a purchase is (Faturas › De quem é?): the owner's, someone named before, or a new name;
 * and, for someone else, all of it or a part ("Você paga uma parte": half to start, as Splitwise and
 * Monarch open, a third, or another value). A parcel takes its whole plan along and a
 * subscription every month of the same value, so later bills follow. Only the owner's part counts
 * in the ceiling; the other part waits in Para lançar as an Entrada.
 */
export const OwnerForm = ({
  markKey,
  amount,
  current,
  installments,
  due,
  monthly,
  people,
  waits,
  onDone,
}: {
  /** The mark it is saved under (engine `ownerKey`, or `monthlyKey` for a subscription). */
  markKey: string;
  /** One charge, in cents. */
  amount: number;
  current: { readonly person: string; readonly share: number | null } | null;
  /** The plan's length, for a parcel. */
  installments: number | null;
  /** The bill's due day, when known: when the other part enters as an Entrada. */
  due: string | null;
  /** A subscription: the mark holds for every month it charges this value. */
  monthly: boolean;
  people: readonly string[];
  /** People whose part goes in when their Pix lands, not on the due day. */
  waits: readonly string[];
  onDone: () => void;
}) => {
  const id = useId();
  const queryClient = useQueryClient();
  const known = current?.share != null && current.share < amount ? current.share : null;
  const [who, setWho] = useState<string | null>(current?.person ?? null);
  const [name, setName] = useState("");
  const [split, setSplit] = useState(known !== null);
  const [mode, setMode] = useState<Mode>(
    known === null || known === Math.round(amount / 2)
      ? "half"
      : known === Math.round(amount / 3)
        ? "third"
        : "other",
  );
  const [typed, setTyped] = useState(
    known !== null ? (known / 100).toFixed(2).replace(".", ",") : "",
  );
  const save = useMutation({
    mutationFn: ({ person, share }: { person: string | null; share: number | null }) =>
      api.markOwner(markKey, person, share),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projection"] });
      onDone();
    },
  });

  const person = who === NEW ? name.trim() || null : who;
  const typedCents = toCents(typed);
  const part = !split
    ? amount
    : mode === "half"
      ? Math.round(amount / 2)
      : mode === "third"
        ? Math.round(amount / 3)
        : typedCents;
  const tooBig = split && mode === "other" && typedCents !== null && typedCents >= amount;
  const valid =
    who === null ||
    (person !== null && part !== null && part > 0 && (!split || part < amount) && !tooBig);
  const plan = (installments ?? 1) > 1;
  const later = person !== null && waits.some((w) => w.toLowerCase() === person.toLowerCase());
  const pick = (next: string | null) => {
    setWho(next);
    // A subscription is split more often than given away: it starts split, as the card offers.
    if (next !== null && who === null) setSplit(monthly);
  };

  return (
    <form
      className="owner-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || save.isPending) return;
        if (who === null) {
          if (current === null) onDone();
          else save.mutate({ person: null, share: null });
          return;
        }
        const share = split ? part : null;
        if (current && person === current.person && share === known) onDone();
        else save.mutate({ person, share });
      }}
    >
      <fieldset className="chip-radios owner-who">
        <legend className="sr-only">De quem é</legend>
        {[null, ...people, NEW].map((p) => (
          <label key={p ?? "mine"} className="chip-radio">
            <input type="radio" name={`${id}-who`} checked={who === p} onChange={() => pick(p)} />
            {p === null ? "Minha" : p === NEW ? "Outra pessoa" : p}
          </label>
        ))}
      </fieldset>
      {who === NEW && (
        <input
          aria-label="Nome da pessoa"
          placeholder="Nome da pessoa"
          autoCapitalize="words"
          autoComplete="off"
          maxLength={40}
          // biome-ignore lint/a11y/noAutofocus: the name is the next thing to type after "Outra pessoa".
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      )}
      {who !== null && (
        <label className="setting owner-split">
          {/* Off, the person pays it all; on, the owner keeps a part. */}
          <span className="label">Você paga uma parte</span>
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={split}
            aria-checked={split}
            onChange={(e) => setSplit(e.target.checked)}
          />
        </label>
      )}
      {who !== null && split && (
        <div className="owner-parts">
          <fieldset className="chip-radios owner-modes">
            <legend className="sr-only">Quanto {person ?? "a outra pessoa"} paga</legend>
            {(
              [
                ["half", "Metade"],
                ["third", "Um terço"],
                ["other", "Outro valor"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="chip-radio">
                <input
                  type="radio"
                  name={`${id}-mode`}
                  checked={mode === k}
                  onChange={() => setMode(k)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          {mode === "other" && (
            <label className="owner-amount">
              <span>{person ?? "A pessoa"} paga</span>
              <span className="affix">
                R$
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0,00"
                  aria-invalid={tooBig || undefined}
                  aria-describedby={tooBig ? `${id}-big` : undefined}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                />
              </span>
            </label>
          )}
          {tooBig && (
            <p id={`${id}-big`} className="hint error">
              A parte precisa ser menor que {money(amount)}.
            </p>
          )}
          {part !== null && part > 0 && part < amount && (
            <>
              <div
                className="split-bar"
                role="img"
                aria-label={`Você paga ${money(amount - part)}, ${person ?? "a outra pessoa"} paga ${money(part)}`}
              >
                <i style={{ flexGrow: amount - part }} />
                <i className="them" style={{ flexGrow: part }} />
              </div>
              <dl className="owner-kv">
                <dt>{person ?? "A pessoa"} paga</dt>
                <dd className="them">{money(part)}</dd>
                <dt>Você paga</dt>
                <dd>{money(amount - part)}</dd>
              </dl>
            </>
          )}
        </div>
      )}
      {/* One line of what the choice does; when the other part enters the sheet, one tap away. */}
      <p className="hint owner-note">
        {who === null
          ? "Conta inteira no seu teto."
          : capitalize(
              [
                plan ? `vale para as ${installments} parcelas` : null,
                monthly ? `vale para todo mês em que cobrar ${money(amount)}` : null,
                split ? "só a sua parte conta no teto" : "fica fora do seu teto",
              ]
                .filter(Boolean)
                .join(" · "),
            ) + "."}
      </p>
      {person && (
        <details className="formula owner-how">
          <summary>
            Como funciona
            <IconChevron />
          </summary>
          <p>
            {later
              ? `A parte de ${person} entra na planilha quando o Pix cair, em Para lançar.`
              : `A parte de ${person} aparece em Para lançar como Entrada ${due && !monthly && !plan ? `em ${shortDate(due)}, quando a fatura vence` : "em cada fatura que ainda vai vencer"}, e só vai para a planilha quando você tocar em Lançar.`}
          </p>
        </details>
      )}
      <button type="submit" disabled={!valid || save.isPending}>
        {save.isPending ? "Salvando…" : "Salvar"}
      </button>
      {save.isError && (
        <p className="warn" role="alert">
          Não salvou. Toque em Salvar de novo.
        </p>
      )}
    </form>
  );
};
