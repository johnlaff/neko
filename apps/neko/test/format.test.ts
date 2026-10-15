import { describe, expect, it } from "vitest";
import { bankLineName, bankText, closesIn, merchantName } from "../src/web/format.ts";

describe("closesIn", () => {
  it("counts today in closesInDays: 1 is today, 2 tomorrow", () => {
    expect(closesIn(1)).toBe("Fecha hoje");
    expect(closesIn(2)).toBe("Fecha amanhã");
    expect(closesIn(4)).toBe("Fecha em 3 dias");
  });
});

describe("bankText", () => {
  it("reads a bank's capitals as a name, keeping small words and codes", () => {
    expect(bankText("PIX FEIRA DO BAIRRO")).toBe("Pix Feira do Bairro");
    expect(bankText("PIX RECEBIDO ANA")).toBe("Pix Recebido Ana");
    expect(bankText("PAG*LOJA 123 SÃO PAULO")).toBe("Pag*loja 123 São Paulo");
  });

  it("leaves text that already has lowercase as sent", () => {
    expect(bankText("Uber *Trip")).toBe("Uber *Trip");
  });
});

describe("merchantName", () => {
  it("drops the payment company and the bank's padding, as a bank app shows the store", () => {
    expect(merchantName("DL      *UberRides")).toBe("UberRides");
    expect(merchantName("MP*MERCADOLIVRE")).toBe("MERCADOLIVRE");
    expect(merchantName("PAYPAL *NETFLIX")).toBe("NETFLIX");
    // A store's own name before the star stays: only payment companies go.
    expect(merchantName("UBER  *TRIP")).toBe("UBER *TRIP");
    expect(merchantName("DL *")).toBe("DL *");
  });

  it("reads a parcel's store the same way", () => {
    expect(bankLineName({ description: "PG *LOJA DO ZE PARC 02/06", installment: 2 })).toBe(
      "Loja do Ze",
    );
  });
});
