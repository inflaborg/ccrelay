import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Radix Select cannot use empty string as item value. */
export const SELECT_EMPTY = "__empty__";

export type SelectFieldOption = {
  value: string;
  label: string;
};

function toItemValue(value: string): string {
  return value === "" ? SELECT_EMPTY : value;
}

function fromItemValue(value: string): string {
  return value === SELECT_EMPTY ? "" : value;
}

export function SelectField({
  value,
  options,
  onChange,
  placeholder,
  className,
  triggerClassName,
  disabled,
}: {
  value?: string;
  options: SelectFieldOption[];
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  disabled?: boolean;
}) {
  const selectValue = value === undefined || value === "" ? SELECT_EMPTY : value;

  return (
    <Select
      value={selectValue}
      onValueChange={v => onChange?.(fromItemValue(v))}
      disabled={disabled}
    >
      <SelectTrigger size="sm" className={cn("w-full text-xs", triggerClassName, className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map(option => (
          <SelectItem key={toItemValue(option.value)} value={toItemValue(option.value)}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
