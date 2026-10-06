import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Pressable } from '@/components/ui/pressable';
import { Check, ChevronDown } from 'lucide-react-native';
import { COUNTRIES } from '@/lib/countries';
import { cn } from '@/lib/utils';
import { splitTextClasses } from '@/lib/classNames';
import { color } from '@/theme';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface CountrySelectProps {
  value: string;
  onChange: (code: string) => void;
  /** Web className of the `<select className="form-input …">`; text classes go to the label. */
  className?: string;
  accessibilityLabel?: string;
  disabled?: boolean;
}

const PLACEHOLDER = 'Select your country…';

/**
 * The web's `<select className="form-input">` of COUNTRIES (with the disabled
 * "Select your country…" placeholder option): a form-input-styled Pressable
 * that opens the option list in a Dialog.
 */
export default function CountrySelect({
  value,
  onChange,
  className,
  accessibilityLabel = 'Country',
  disabled,
}: CountrySelectProps) {
  const [open, setOpen] = useState(false);
  const { text, rest } = splitTextClasses(className);
  const selected = COUNTRIES.find(c => c.code === value);

  return (
    <>
      <Pressable
        accessibilityRole="combobox"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: selected?.label ?? PLACEHOLDER }}
        accessibilityState={{ disabled: !!disabled, expanded: open }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        className={cn(
          'h-[42px] w-full flex-row items-center rounded-lg border border-edge-md bg-surface-input px-3',
          open && 'border-primary-medium/50',
          disabled && 'opacity-50',
          rest,
        )}
        style={
          open
            ? { boxShadow: `0 0 0 2px ${color['primary-medium']}` }
            : undefined
        }
      >
        <Text
          className={cn('flex-1 text-base text-foreground', text)}
          numberOfLines={1}
        >
          {selected?.label ?? PLACEHOLDER}
        </Text>
        <ChevronDown size={16} color={color['muted-foreground']} />
      </Pressable>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="border border-edge bg-card p-0 pt-6">
          <DialogHeader className="px-6 pb-2">
            <DialogTitle className="text-foreground">{PLACEHOLDER}</DialogTitle>
          </DialogHeader>
          <View accessibilityRole="list">
            {COUNTRIES.map(({ code, label }) => {
              const isSelected = code === value;
              return (
                <Pressable
                  key={code}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => {
                    onChange(code);
                    setOpen(false);
                  }}
                  className={cn(
                    'flex-row items-center justify-between border-t border-edge-faint px-6 py-3 active:bg-ghost-light',
                    isSelected && 'bg-primary-medium/10',
                  )}
                >
                  <Text
                    className={cn(
                      'text-sm',
                      isSelected
                        ? 'font-medium text-primary'
                        : 'text-foreground',
                    )}
                  >
                    {label}
                  </Text>
                  {isSelected ? (
                    <Check size={16} color={color.primary} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </DialogContent>
      </Dialog>
    </>
  );
}
