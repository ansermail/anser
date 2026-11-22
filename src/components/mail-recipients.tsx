import { Fragment, useState } from "react";
import { t } from "@/lib/i18n";
import { addressTokens, parseAddresses } from "@/lib/addresses";
import type { Address } from "@/lib/types";
import { Button } from "./ui/button";
import { ContactAddress } from "./contact-address";

const VISIBLE_RECIPIENTS = 3;

function AddressTokenList({
  tokens,
  onComposeAddress,
  onAddContact,
}: {
  tokens: string[];
  onComposeAddress?: (address: Address) => void;
  onAddContact?: (address: Address) => void;
}) {
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
  return (
    <AddressTokenList
      tokens={tokens}
      onComposeAddress={onComposeAddress}
      onAddContact={onAddContact}
    />
  );
}

export function RecipientAddressSummary({
  value,
  onComposeAddress,
  onAddContact,
}: {
  value: string;
  onComposeAddress?: (address: Address) => void;
  onAddContact?: (address: Address) => void;
}) {
  const tokens = addressTokens(value).filter(Boolean);
  const [expanded, setExpanded] = useState(false);
  const remaining = tokens.length - VISIBLE_RECIPIENTS;
  const visibleTokens =
    expanded || tokens.length <= VISIBLE_RECIPIENTS
      ? tokens
      : tokens.slice(0, VISIBLE_RECIPIENTS);
  return (
    <div
      className={`recipient-address-summary${expanded ? " is-expanded" : ""}`}
    >
      <span className="recipient-address-list">
        <AddressTokenList
          tokens={visibleTokens}
          onComposeAddress={onComposeAddress}
          onAddContact={onAddContact}
        />
      </span>
      {tokens.length > VISIBLE_RECIPIENTS && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className={`recipient-overflow-control${expanded ? " recipient-overflow-toggle" : ""}`}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? t("Collapse")
              : t("Show {value0} more recipients", {
                  value0: String(remaining),
                })
          }
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? t("Collapse") : `+${remaining}`}
        </Button>
      )}
    </div>
  );
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
          <dd>
            <RecipientAddressSummary
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
