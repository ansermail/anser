import { useId } from "react";
import { Paperclip, SlidersHorizontal, Star } from "lucide-react";
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
  "starredOnly" | "attachmentsOnly" | "searchField" | "dateFrom" | "dateBefore"
>;

export function MailFilters({
  query,
  onChange,
}: {
  query: Filters;
  onChange: (filters: Partial<Filters>) => void;
}) {
  const id = useId();
  const active = !!(
    query.starredOnly ||
    query.attachmentsOnly ||
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
          aria-label="筛选邮件"
          title={active ? "筛选邮件（已启用）" : "筛选邮件"}
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
            <PopoverTitle id={`${id}-title`}>邮件筛选</PopoverTitle>
            <PopoverDescription>组合条件会同时生效。</PopoverDescription>
          </PopoverHeader>
          <FieldSet>
            <FieldLegend className="sr-only">筛选条件</FieldLegend>
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
                  星标邮件
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
                  有附件
                </FieldLabel>
              </Field>
            </FieldGroup>
          </FieldSet>
          <Separator />
          <Field>
            <FieldLabel htmlFor={`${id}-search`}>搜索字段</FieldLabel>
            <SelectField
              id={`${id}-search`}
              aria-label="搜索字段"
              value={query.searchField || ""}
              onValueChange={(searchField) => onChange({ searchField })}
            >
              <SelectGroup>
                {[
                  ["", "全部字段"],
                  ["subject", "主题"],
                  ["sender", "发件人"],
                  ["recipients", "收件人"],
                  ["body", "正文"],
                ].map(([value, label]) => (
                  <SelectOption value={value} key={value}>
                    {label}
                  </SelectOption>
                ))}
              </SelectGroup>
            </SelectField>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-date`}>时间范围</FieldLabel>
            <MailDateFilter
              id={`${id}-date`}
              placeholder="不限时间"
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
