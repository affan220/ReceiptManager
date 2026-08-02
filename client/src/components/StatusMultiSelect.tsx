import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type StatusFilterValue = "paid" | "unpaid" | "pending" | "hold";

type StatusOption = {
  value: StatusFilterValue;
  label: string;
};

type StatusMultiSelectProps = {
  value: StatusFilterValue[];
  onValueChange: (value: StatusFilterValue[]) => void;
  className?: string;
  allLabel?: string;
  options?: StatusOption[];
};

const DEFAULT_OPTIONS: StatusOption[] = [
  { value: "paid", label: "Paid" },
  { value: "unpaid", label: "Unpaid" },
  { value: "pending", label: "Pending" },
  { value: "hold", label: "Hold Ones" },
];

export function StatusMultiSelect({
  value,
  onValueChange,
  className,
  allLabel = "All status",
  options = DEFAULT_OPTIONS,
}: StatusMultiSelectProps) {
  const selected = options.filter((option) => value.includes(option.value));
  const allSelected = selected.length === options.length;

  const setAll = () => onValueChange(options.map((option) => option.value));

  const toggle = (status: StatusFilterValue, checked: boolean) => {
    if (checked) {
      const next = Array.from(new Set([...value, status]));
      onValueChange(next);
      return;
    }

    const next = value.filter((item) => item !== status);
    onValueChange(next.length ? next : options.map((option) => option.value));
  };

  const label = allSelected || selected.length === 0
    ? allLabel
    : selected.length === 1
      ? selected[0]?.label ?? allLabel
      : `${selected.slice(0, 2).map((item) => item.label).join(", ")}${selected.length > 2 ? ` +${selected.length - 2}` : ""}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={cn("w-[170px] justify-between", className)}>
          <span className="truncate text-left">{label}</span>
          <ChevronDown className="h-4 w-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[220px]">
        <DropdownMenuCheckboxItem checked={allSelected} onCheckedChange={setAll} onSelect={(event) => event.preventDefault()}>
          {allLabel}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={value.includes(option.value)}
            onCheckedChange={(checked) => toggle(option.value, Boolean(checked))}
            onSelect={(event) => event.preventDefault()}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
