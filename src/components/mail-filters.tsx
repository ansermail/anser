import { t } from "@/lib/i18n";
import { useId } from "react";
import { Paperclip, Send, SlidersHorizontal, Star } from "lucide-react";
import type { Query } from "@/lib/types";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "./ui/field";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "./ui/popover";
import { SelectGroup } from "./ui/select";
import { SelectField, SelectOption } from "./ui/select-field";
import { Separator } from "./ui/separator";
import { MailDateFilter } from "./mail-date-filter";

type Filters = Pick<
  Query,
  | "starredOnly"
  | "attachmentsOnly"
  | "excludeSent"
  | "searchField"
  | "dateFrom"
  | "dateBefore"
>;

export function MailFilters({
  query,
  onChange,
}: {
  query: Filters;
  onChange: (filters: Partial<Filters>) => void;
}) {
  const id = useId();
  const excludeSent = query.excludeSent !== false;
  const active = !!(
    query.starredOnly ||
    query.attachmentsOnly ||
    !excludeSent ||
    query.searchField ||
    query.dateFrom ||
    query.dateBefore
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={active ? "secondary" : "ghost"}
          size="icon-lg"
          aria-label={t("Filter mail")}
          title={active ? t("Filter mail (active)") : t("Filter mail")}
        >
          <SlidersHorizontal />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 max-h-[var(--radix-popover-content-available-height)] overflow-y-auto"
        aria-labelledby={`${id}-title`}
      >
        <FieldGroup className="gap-4">
          <PopoverHeader>
            <PopoverTitle id={`${id}-title`}>{t("Mail filters")}</PopoverTitle>
            <PopoverDescription>
              {t("All selected conditions apply together.")}
            </PopoverDescription>
          </PopoverHeader>
          <FieldSet>
            <FieldLegend className="sr-only">
              {t("Filter conditions")}
            </FieldLegend>
            <FieldGroup data-slot="checkbox-group">
              <Field orientation="horizontal">
                <Checkbox
                  id={`${id}-star`}
                  checked={!!query.starredOnly}
                  onCheckedChange={(checked) =>
                    onChange({ starredOnly: checked === true })
                  }
                />
                <FieldLabel htmlFor={`${id}-star`}>
                  <Star className="size-4" />
                  {t("Starred mail")}
                </FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id={`${id}-attachment`}
                  checked={!!query.attachmentsOnly}
                  onCheckedChange={(checked) =>
                    onChange({ attachmentsOnly: checked === true })
                  }
                />
                <FieldLabel htmlFor={`${id}-attachment`}>
                  <Paperclip className="size-4" />
                  {t("Has attachments")}
                </FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id={`${id}-exclude-sent`}
                  checked={excludeSent}
                  onCheckedChange={(checked) =>
                    onChange({ excludeSent: checked === true })
                  }
                />
                <FieldLabel htmlFor={`${id}-exclude-sent`}>
                  <Send className="size-4" />
                  {t("Exclude sent mail")}
                </FieldLabel>
              </Field>
            </FieldGroup>
          </FieldSet>
          <Separator />
          <Field>
            <FieldLabel htmlFor={`${id}-search`}>
              {t("Search field")}
            </FieldLabel>
            <SelectField
              id={`${id}-search`}
              aria-label={t("Search field")}
              value={query.searchField || ""}
              onValueChange={(searchField) => onChange({ searchField })}
            >
              <SelectGroup>
                {[
                  ["", t("All fields")],
                  ["subject", t("Subject")],
                  ["sender", t("From")],
                  ["recipients", t("To")],
                  ["body", t("Body")],
                ].map(([value, label]) => (
                  <SelectOption value={value} key={value}>
                    {label}
                  </SelectOption>
                ))}
              </SelectGroup>
            </SelectField>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-date`}>{t("Date range")}</FieldLabel>
            <MailDateFilter
              id={`${id}-date`}
              placeholder={t("Any time")}
              dateFrom={query.dateFrom}
              dateBefore={query.dateBefore}
              onChange={onChange}
            />
          </Field>
        </FieldGroup>
      </PopoverContent>
    </Popover>
  );
}
