import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import type { OwedView } from "../../shared/screens.ts";
import { api } from "../api.ts";
import { Board } from "../Board.tsx";
import { CardAvatar } from "../CardAvatar.tsx";
import { CategoryIcon } from "../CategoryIcon.tsx";
import { BigMoney } from "../Figures.tsx";
import { bankLineName, capitalize, money, plainMoney, shortDate } from "../format.ts";
import { IconChevron, IconReceipt } from "../icons.tsx";
import { Sheet } from "../Sheet.tsx";
import { OwnerForm } from "./Owner.tsx";
import { monthOf, monthYear, plural } from "./text.ts";

type Item = OwedView["items"][number];

const IconShare = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M12 3.5v11M7.5 8 12 3.5 16.5 8M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5" />
  </svg>
);

const split = (i: Item) => i.part < i.amount;

/** `metade de R$ 450,00`: how much of the purchase is theirs, in words when it is a plain share. */
const shareOf = (i: Item) =>
  `${i.part === Math.round(i.amount / 2) ? "metade" : i.part === Math.round(i.amount / 3) ? "um terço" : "parte"} de ${money(i.amount)}`;

const itemWhen = (i: Item) =>
  i.installment !== null && i.installments !== null && i.installments > 1
    ? `parcela ${i.installment} de ${i.installments}${i.later > 0 ? ` · faltam ${money(i.later)}` : " · última"}`
    : i.date
      ? shortDate(i.date)
      : null;

/** `12/12`, the way a message writes a day. */
const slashDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * What the owner sends the person, word for word: each line of the month with its value, and the
 * total. Plain amounts even while the screen hides them: he chose to send it.
 */
const messageOf = (o: OwedView, month: string, cash = plainMoney) =>
  [
    `Oi, ${o.person}! Sua parte nas faturas de ${monthOf(month)}:`,
    ...(o.card
      ? [`• ${o.card.card}: ${cash(o.card.amount)} (vence ${slashDate(o.card.due)})`]
      : []),
    ...o.items.map((i) => {
      const what =
        i.installment !== null && i.installments !== null && i.installments > 1
          ? ` (parcela ${i.installment} de ${i.installments})`
          : split(i)
            ? ` (sua parte de ${cash(i.amount)})`
            : "";
      return `• ${bankLineName(i)}${what}: ${cash(i.part)}`;
    }),
    `Total: ${cash(o.total)}`,
  ].join("\n");

/**
 * One person's month on the owner's bills (Faturas › A receber › a person), as Splitwise shows a
 * friend's balance: their own card's bill on its own line, their purchases on the owner's cards
 * below, the parcels still to come, and a message to send them. Neko sends nothing by itself: the
 * phone's share sheet does, on the owner's tap.
 */
export const Person = ({
  o,
  month,
  people,
  waits,
}: {
  o: OwedView;
  month: string;
  people: readonly string[];
  waits: readonly string[];
}) => {
  const id = useId();
  const queryClient = useQueryClient();
  const title = useRef<HTMLHeadingElement>(null);
  const [picked, setPicked] = useState<Item | null>(null);
  // After a tap with no share sheet: the text was copied, or it is shown to copy by hand.
  const [sent, setSent] = useState<"copied" | "by-hand" | null>(null);
  useEffect(() => title.current?.focus({ preventScroll: true }), []);
  const when = useMutation({
    mutationFn: (onArrival: boolean) => api.markPerson(o.person, onArrival),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["projection"] }),
  });
  const onArrival = when.isPending ? when.variables : o.onArrival;
  const send = async () => {
    const text = messageOf(o, month);
    setSent(null);
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setSent("copied");
    } catch (e) {
      // Closing the share sheet is not a failure; anything else shows the text to copy by hand.
      if (!(e instanceof DOMException && e.name === "AbortError")) setSent("by-hand");
    }
  };
  const head = (
    <section className="panel person-head">
      <div className="sheet-item">
        <span className="avatar person" aria-hidden="true">
          {o.person.slice(0, 1).toUpperCase()}
        </span>
        <h2 className="name" ref={title} tabIndex={-1}>
          {o.person}
        </h2>
        <span className="meta">Nas faturas de {monthOf(month)}</span>
      </div>
      <BigMoney cents={o.total} tone="plain" />
      {o.later > 0 && (
        <p className="hint">
          Depois de {monthOf(month)} ainda vêm {money(o.later)} em parcelas
          {o.until ? `, até ${monthYear(o.until)}` : ""}.
        </p>
      )}
      <button type="button" className="send" onClick={send}>
        <IconShare />
        Mandar para {o.person}
      </button>
      <div aria-live="polite">
        {sent && (
          <p className="hint">
            {sent === "copied"
              ? "Mensagem copiada. Cole no WhatsApp ou onde preferir."
              : "Não deu para abrir o compartilhar. Copie a mensagem abaixo."}
          </p>
        )}
      </div>
      <details className="formula person-message" open={sent === "by-hand" || undefined}>
        <summary>
          Ver a mensagem
          <IconChevron />
        </summary>
        <pre className="message">{messageOf(o, month, money)}</pre>
      </details>
      <p className="hint">O Neko não manda nada sozinho: você escolhe para onde a mensagem vai.</p>
    </section>
  );
  const lines = (
    <section className="panel person-lines">
      {o.card && (
        <ul className="rows lead">
          <li className="bill">
            <CardAvatar name={o.card.card} />
            <span className="name">{o.card.card}</span>
            <span className="value">{money(o.card.amount)}</span>
            <span className="meta">Fatura inteira · vence {shortDate(o.card.due)}</span>
          </li>
        </ul>
      )}
      {o.items.length > 0 && (
        <>
          {o.card && <div className="divider" />}
          <div className="panel-head">
            <h3>Nos seus cartões</h3>
            <span className="meta">{plural(o.items.length, "compra", "compras")}</span>
          </div>
          <ul className="rows lead">
            {o.items.map((i) => (
              <li key={`${i.key}|${i.card}|${i.description}|${i.date}`} className="bill">
                <button
                  type="button"
                  className="row-link"
                  aria-haspopup="dialog"
                  aria-label={`${bankLineName(i)}, ${money(i.part)}: de quem é`}
                  onClick={() => setPicked(i)}
                >
                  <span className="avatar" aria-hidden="true">
                    <CategoryIcon text={i.description} fallback={<IconReceipt />} />
                  </span>
                  <span className="name">{bankLineName(i)}</span>
                  <span className="value">
                    {money(i.part)}
                    <IconChevron />
                  </span>
                  <span className="meta">
                    {[i.card, itemWhen(i), split(i) ? shareOf(i) : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="divider" />
      <fieldset className="chip-radios person-when">
        <legend>Quando a parte de {o.person} entra na planilha</legend>
        {(
          [
            [false, "No vencimento"],
            [true, "Quando o Pix cair"],
          ] as const
        ).map(([k, label]) => (
          <label key={label} className="chip-radio">
            <input
              type="radio"
              name={`${id}-when`}
              checked={onArrival === k}
              aria-disabled={when.isPending || undefined}
              onChange={() => {
                if (!when.isPending) when.mutate(k);
              }}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <p className="hint">
        {onArrival
          ? `Nada fica planejado: quando o Pix de ${o.person} cair, ele aparece em Para lançar como Entrada.`
          : `Cada parte aparece em Para lançar como Entrada no dia em que a fatura vence. Um Pix adiantado de ${o.person} diminui essa Entrada.`}
      </p>
      {when.isError && (
        <p className="warn" role="alert">
          Não salvou.{" "}
          <button type="button" className="text-link" onClick={() => when.mutate(when.variables)}>
            Tentar de novo
          </button>
        </p>
      )}
    </section>
  );
  return (
    <>
      <Board panels={{ head, lines }} two={[["head"], ["lines"]]} />
      <Sheet open={picked !== null} title="De quem é?" onClose={() => setPicked(null)}>
        {picked && (
          <>
            <div className="sheet-item">
              <span className="avatar" aria-hidden="true">
                <CategoryIcon text={picked.description} fallback={<IconReceipt />} />
              </span>
              <span className="name">{bankLineName(picked)}</span>
              <span className="value">{money(picked.amount)}</span>
              <span className="meta">
                {[picked.card, capitalize(itemWhen(picked) ?? "")].filter(Boolean).join(" · ")}
              </span>
            </div>
            <OwnerForm
              markKey={picked.key}
              amount={picked.amount}
              current={{ person: o.person, share: split(picked) ? picked.part : null }}
              installments={picked.installments}
              due={picked.due}
              monthly={picked.key.endsWith("|mensal")}
              people={people}
              waits={waits}
              onDone={() => setPicked(null)}
            />
          </>
        )}
      </Sheet>
    </>
  );
};
