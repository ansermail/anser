import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { t } from "@/lib/i18n";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "./ui/input-group";

export function PasswordInput({
  className,
  disabled,
  ...props
}: Omit<React.ComponentProps<"input">, "type">) {
  const [visible, setVisible] = React.useState(false);
  return (
    <InputGroup data-disabled={disabled || undefined} className={className}>
      <InputGroupInput
        {...props}
        disabled={disabled}
        type={visible ? "text" : "password"}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          size="icon-xs"
          disabled={disabled}
          aria-label={visible ? t("Hide password") : t("Show password")}
          title={visible ? t("Hide password") : t("Show password")}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff /> : <Eye />}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}
