import { useState } from "react";
import { providers } from "@/lib/providers";
import { Field, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

// Only the address entry is split; account data and server login keep the full address.
export function AccountEmailField({
  provider,
  value,
  disabled,
  onChange,
}: {
  provider: string;
  value: string;
  disabled: boolean;
  onChange: (email: string) => void;
}) {
  const preset = providers.find((p) => p.id === provider)?.domain || "";
  const domains =
    provider === "netease"
      ? ["163.com", "126.com", "yeah.net"]
      : preset
        ? [preset]
        : [];
  const [domain, setDomain] = useState(preset);
  const local =
    domain && value.endsWith(`@${domain}`)
      ? value.slice(0, -(domain.length + 1))
      : value;
  function changeValue(text: string) {
    const full = text.trim().match(/^([^@\s]+)@([^@\s]+\.[^@\s]+)$/);
    if (full) {
      const pastedDomain = full[2].toLowerCase();
      setDomain(domains.includes(pastedDomain) ? pastedDomain : "");
      onChange(`${full[1]}@${pastedDomain}`);
    } else {
      onChange(text && domain ? `${text}@${domain}` : text);
    }
  }
  function changeDomain(next: string) {
    const selected = next === "custom" ? "" : next;
    setDomain(selected);
    if (selected) {
      const name = value.includes("@")
        ? value.slice(0, value.lastIndexOf("@"))
        : value;
      onChange(name ? `${name}@${selected}` : "");
    }
  }
  if (disabled || !preset) {
    return (
      <Field className="field">
        <FieldLabel htmlFor="email">邮箱地址</FieldLabel>
        <Input
          id="email"
          type="email"
          placeholder="you@example.com"
          value={value}
          required
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
    );
  }
  return (
    <Field className="field">
      <FieldLabel htmlFor="email">邮箱地址</FieldLabel>
      <InputGroup>
        <InputGroupInput
          id="email"
          type={domain ? "text" : "email"}
          inputMode="email"
          autoCapitalize="none"
          autoComplete="username"
          spellCheck={false}
          placeholder={domain ? "填写邮箱账号" : "you@example.com"}
          pattern={domain ? "[^\\s@]+" : undefined}
          title={
            domain ? "填写 @ 前面的邮箱账号，或粘贴完整邮箱地址" : undefined
          }
          aria-describedby={domain ? "email-domain" : undefined}
          value={local}
          required
          onChange={(e) => changeValue(e.target.value)}
        />
        <InputGroupAddon align="inline-end">
          <Select value={domain || "custom"} onValueChange={changeDomain}>
            <SelectTrigger
              id="email-domain"
              aria-label="邮箱后缀"
              className="w-auto border-0 shadow-none"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {domains.map((name) => (
                  <SelectItem key={name} value={name}>
                    @{name}
                  </SelectItem>
                ))}
                <SelectItem value="custom">完整地址</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </InputGroupAddon>
      </InputGroup>
    </Field>
  );
}
