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
 * which card of the sheet each bank card is, and whether each account keeps savings. Hidden until
 * the Pluggy keys are set.
 */
export const Banks = ({ sheetCards }: { sheetCards: readonly string[] }) => {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["banks"], queryFn: api.banks });
  const done = () => queryClient.invalidateQueries();
  const items = useMutation({ mutationFn: api.saveBanks, onSuccess: done });
  const cards = useMutation({ mutationFn: api.saveBankCards, onSuccess: done });
  const uses = useMutation({
    mutationFn: ({ id, use }: { id: string; use: "guardado" | "corrente" }) =>
      api.accountUse(id, use),
    onSuccess: done,
  });
  const [label, setLabel] = useState("");
  const [itemId, setItemId] = useState("");
  const [unlinking, setUnlinking] = useState<string | null>(null);
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
                {unlinking === i.itemId ? (
                  <span className="sub" role="status">
                    Desligar? Para ligar de novo, cole o código outra vez.
                  </span>
                ) : (
                  <span className={i.error ? "sub error" : "sub"}>{status(i)}</span>
                )}
              </span>
              {/* Unlinking asks once more in place: getting the bank back means finding its code again. */}
              {unlinking === i.itemId ? (
                <span className="confirm">
                  <button type="button" className="ghost small" onClick={() => setUnlinking(null)}>
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="ghost small danger"
                    disabled={items.isPending}
                    aria-label={`Desligar ${i.label}`}
                    onClick={() =>
                      items.mutate(
                        linked.filter((l) => l.itemId !== i.itemId),
                        { onSuccess: () => setUnlinking(null) },
                      )
                    }
                  >
                    Desligar
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="ghost small"
                  disabled={items.isPending}
                  aria-label={`Desligar ${i.label}`}
                  onClick={() => setUnlinking(i.itemId)}
                >
                  Desligar
                </button>
              )}
            </div>
            {i.accounts
              .filter((a) => !a.card)
              .map((a) => (
                // The answer to "guarda ou dia a dia", changeable here after Para lançar asked it.
                <label key={a.id} className="setting nested">
                  <span className="label">
                    {a.name}
                    <span className="sub">
                      {a.use === "guardado"
                        ? "O que vai para ela entra na Economia"
                        : "Conta do banco"}
                    </span>
                  </span>
                  <select
                    value={a.use ?? ""}
                    disabled={uses.isPending}
                    onChange={(e) =>
                      uses.mutate({ id: a.id, use: e.target.value as "guardado" | "corrente" })
                    }
                  >
                    {a.use === null && (
                      <option value="" disabled>
                        Não respondido
                      </option>
                    )}
                    <option value="corrente">Dia a dia</option>
                    <option value="guardado">Guarda dinheiro</option>
                  </select>
                </label>
              ))}
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
              {/* Labels stay visible above the fields, so they are still named once filled. */}
              <label>
                <span>Banco</span>
                <input
                  aria-label="Nome do banco"
                  value={label}
                  maxLength={40}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </label>
              <label>
                <span>Código</span>
                <input
                  aria-label="Código da conexão no Meu Pluggy"
                  value={itemId}
                  spellCheck={false}
                  aria-invalid={itemId.trim() !== "" && !UUID.test(itemId.trim())}
                  onChange={(e) => setItemId(e.target.value)}
                />
              </label>
              <button type="submit" className="ghost small" disabled={!valid || items.isPending}>
                Ligar
              </button>
            </form>
          </li>
        )}
      </ul>
      <p className="footnote">
        O banco só sugere itens em Para lançar; nada vai para a planilha sem você tocar em Lançar. O
        código da conexão fica no Meu Pluggy, na lista das suas conexões.
      </p>
    </section>
  );
};
