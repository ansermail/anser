import { Fragment } from "react";
import { t } from "@/lib/i18n";
import { addressTokens, parseAddresses } from "@/lib/addresses";
import type { Address } from "@/lib/types";
import { ContactAddress } from "./contact-address";

/** Split a stored header into independently actionable address chips. */
export function RecipientAddresses({
  value,
  onComposeAddress,
  onAddContact,
}: {
  value: string;
  onComposeAddress?: (address: Address) => void;
  onAddContact?: (address: Address) => void;
}) {
  const tokens = addressTokens(value).filter(Boolean);
  return tokens.map((token, index) => {
    const address = parseAddresses(token)[0];
    return (
      <Fragment key={`${index}:${token}`}>
        {index > 0 && <span className="address-separator">, </span>}
        {address ? (
          <ContactAddress
            address={address}
            className={index === 0 ? "contact-address-start" : undefined}
            onComposeAddress={onComposeAddress}
            onAddContact={onAddContact}
          />
        ) : (
          <span className="address-unparsed">{token}</span>
        )}
      </Fragment>
    );
  });
}

/** One aligned row per header field; empty Cc/Bcc rows stay hidden. */
export function MailRecipients({
  to,
  cc,
  bcc,
  onComposeAddress,
  onAddContact,
}: {
  to?: string;
  cc?: string;
  bcc?: string;
  onComposeAddress?: (address: Address) => void;
  onAddContact?: (address: Address) => void;
}) {
  const rows = [
    { label: t("To: "), value: to?.trim() ?? "" },
    { label: t("Cc: "), value: cc?.trim() ?? "" },
    { label: t("Bcc: "), value: bcc?.trim() ?? "" },
  ].filter((row) => row.value);
  if (!rows.length) return null;
  return (
    <dl className="recipient-fields">
      {rows.map((row) => (
        <Fragment key={row.label}>
          <dt>{row.label}</dt>
          <dd title={row.value} aria-label={row.value}>
            <RecipientAddresses
              value={row.value}
              onComposeAddress={onComposeAddress}
              onAddContact={onAddContact}
            />
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}
