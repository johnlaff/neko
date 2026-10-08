import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type BanksResponse, type UserSettings } from "./api.ts";
import { shortDate } from "./format.ts";

const MAX_BANKS = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type BankCards = UserSettings["bankCards"];
type Item = BanksResponse["items"][number];

const status = (i: Item) =>
  i.error
    ? "Não leu da última vez"
    : i.syncedAt
      ? `Lido ${shortDate(i.syncedAt.slice(0, 10))}`
      : "Ainda não lido";

/** The sheet's name for a bank card, or for one physical card on it; "" when not tied. */
const tiedTo = (cards: BankCards, accountId: string, number: string | null) =>
  cards.find((c) => c.accountId === accountId && c.cardNumber === number)?.card ?? "";

const tie = (cards: BankCards, accountId: string, number: string | null, card: string) => [
  ...cards.filter((c) => !(c.accountId === accountId && c.cardNumber === number)),
  ...(card ? [{ accountId, cardNumber: number, card }] : []),
];

/**
 * Ajustes › Bancos (specs/003-open-finance): the banks linked in Meu Pluggy, when each was read,
 * and which card of the sheet each bank card is. Hidden until the Pluggy keys are set.
 */
export const Banks = ({ sheetCards }: { sheetCards: readonly string[] }) => {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["banks"], queryFn: api.banks });
  const done = () => queryClient.invalidateQueries();
  const items = useMutation({ mutationFn: api.saveBanks, onSuccess: done });
  const cards = useMutation({ mutationFn: api.saveBankCards, onSuccess: done });
  const [label, setLabel] = useState("");
  const [itemId, setItemId] = useState("");
  const data = list.data;
  if (!data?.items || (!data.configured && data.items.length === 0)) return null;

  const linked = data.items.map((i) => ({ itemId: i.itemId, label: i.label }));
  const valid = label.trim() !== "" && UUID.test(itemId.trim());
  const pick = (accountId: string, number: string | null, card: string) =>
    cards.mutate(tie(data.cards, accountId, number, card));
  const options = (empty: string) => (
    <>
      <option value="">{empty}</option>
      {sheetCards.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </>
  );

  return (
    <section className="group" aria-labelledby="g-banks">
      <h2 id="g-banks">Bancos</h2>
      <ul className="panel list banks">
        {data.items.map((i) => (
          <li key={i.itemId} className="bank">
            <div className="setting">
              <span className="label">
                {i.label}
                <span className={i.error ? "sub error" : "sub"}>{status(i)}</span>
              </span>
              <button
                type="button"
                className="ghost small"
                disabled={items.isPending}
                aria-label={`Desligar ${i.label}`}
                onClick={() => items.mutate(linked.filter((l) => l.itemId !== i.itemId))}
              >
                Desligar
              </button>
            </div>
            {i.accounts
              .filter((a) => a.card)
              .flatMap((a) =>
                // One line for the card account, and one per physical card when it has more.
                [null, ...(a.cardNumbers.length > 1 ? a.cardNumbers : [])].map((n) => (
                  <label key={`${a.id}-${n}`} className="setting nested">
                    <span className="label">
                      {n ? `Final ${n}` : a.name}
                      <span className="sub">
                        {n ? "Cartão adicional ou titular" : "Cartão na planilha"}
                      </span>
                    </span>
                    <select
                      value={tiedTo(data.cards, a.id, n)}
                      disabled={cards.isPending}
                      onChange={(e) => pick(a.id, n, e.target.value)}
                    >
                      {options(n ? "Igual ao cartão" : "Não ligar")}
                    </select>
                  </label>
                )),
              )}
          </li>
        ))}
        {data.items.length < MAX_BANKS && (
          <li>
            <form
              className="setting bank-add"
              onSubmit={(e) => {
                e.preventDefault();
                if (!valid) return;
                items.mutate([...linked, { itemId: itemId.trim(), label: label.trim() }], {
                  onSuccess: () => {
                    setLabel("");
                    setItemId("");
                  },
                });
              }}
            >
              <input
                aria-label="Nome do banco"
                placeholder="Banco"
                value={label}
                maxLength={40}
                onChange={(e) => setLabel(e.target.value)}
              />
              <input
                aria-label="Item ID do Meu Pluggy"
                placeholder="Item ID"
                value={itemId}
                spellCheck={false}
                aria-invalid={itemId.trim() !== "" && !UUID.test(itemId.trim())}
                onChange={(e) => setItemId(e.target.value)}
              />
              <button type="submit" className="ghost small" disabled={!valid || items.isPending}>
                Ligar
              </button>
            </form>
          </li>
        )}
      </ul>
      <p className="footnote">
        O Neko só lê o banco e nunca muda a planilha. O Item ID está no Dashboard da Pluggy, em
        Connected Items.
      </p>
    </section>
  );
};
