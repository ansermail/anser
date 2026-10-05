import type { ComponentProps, ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

const empty = "__yanxin_empty_option__";
const encode = (value: string | number) => String(value) || empty;

export function SelectField({
  value,
  onValueChange,
  children,
  disabled,
  className,
  ...props
}: Omit<ComponentProps<"button">, "value" | "onChange" | "children"> & {
  value: string | number;
  onValueChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <Select
      value={encode(value)}
      onValueChange={(next) => onValueChange(next === empty ? "" : next)}
      disabled={disabled}
    >
      <SelectTrigger className={`select-field ${className || ""}`} {...props}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {children}
      </SelectContent>
    </Select>
  );
}
export function SelectOption({
  value,
  ...props
}: Omit<ComponentProps<typeof SelectItem>, "value"> & {
  value: string | number;
}) {
  return <SelectItem value={encode(value)} {...props} />;
}
