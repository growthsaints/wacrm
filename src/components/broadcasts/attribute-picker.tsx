'use client';

// ============================================================
// AttributePicker — AiSensy-style single search/select box for
// mapping a template's {{n}} placeholder to a contact attribute
// ($Name, $MobileNumber, a custom field, …) or fixed text, plus a
// "Fallback" value for when the picked attribute is empty on a given
// contact. Replaces the previous two-step "Type" + "Value" dropdown
// pair in Step3Personalize with one combobox, matching the reference
// UI the customer asked to match.
//
// Shares the VariableMapping shape with use-broadcast-sending.ts's
// resolveVariables (which is where `fallback` actually gets applied
// at send time) — kept structurally identical rather than importing
// one from the other, same pre-existing duplication pattern between
// this file and step3-personalize.tsx's own local type.
// ============================================================

import { useMemo, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { CustomField } from '@/types';

export type AttributeVariableType = 'static' | 'field' | 'custom_field';

export interface AttributeVariableMapping {
  type: AttributeVariableType;
  value: string;
  /** Only meaningful for type 'field'/'custom_field' — used when that contact's value is empty. */
  fallback?: string;
}

interface Attribute {
  type: 'field' | 'custom_field';
  key: string;
  display: string;
}

const BUILTIN_ATTRIBUTES: Attribute[] = [
  { type: 'field', key: 'name', display: '$Name' },
  { type: 'field', key: 'phone', display: '$MobileNumber' },
  { type: 'field', key: 'email', display: '$Email' },
  { type: 'field', key: 'company', display: '$Company' },
];

function customFieldDisplay(field: CustomField): string {
  return `$${field.field_name.trim().replace(/\s+/g, '_')}`;
}

export function AttributePicker({
  mapping,
  customFields,
  onChange,
  placeholder = 'Type or select an attribute',
}: {
  mapping: AttributeVariableMapping;
  customFields: CustomField[];
  onChange: (mapping: AttributeVariableMapping) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const attributes = useMemo<Attribute[]>(
    () => [
      ...BUILTIN_ATTRIBUTES,
      ...customFields.map((f) => ({
        type: 'custom_field' as const,
        key: f.id,
        display: customFieldDisplay(f),
      })),
    ],
    [customFields],
  );

  const selected =
    mapping.type !== 'static'
      ? (attributes.find((a) => a.type === mapping.type && a.key === mapping.value) ?? null)
      : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return attributes;
    return attributes.filter((a) => a.display.toLowerCase().includes(q));
  }, [attributes, query]);

  function pick(attr: Attribute) {
    onChange({ type: attr.type, value: attr.key, fallback: mapping.fallback });
    setQuery('');
    setOpen(false);
  }

  function useAsFixedText() {
    const text = query.trim();
    if (!text) return;
    onChange({ type: 'static', value: text });
    setQuery('');
    setOpen(false);
  }

  function clear() {
    onChange({ type: 'static', value: '' });
  }

  const hasValue = Boolean(selected) || (mapping.type === 'static' && mapping.value.trim());

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Popover
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (o) setQuery('');
          }}
        >
          <PopoverTrigger
            type="button"
            className="flex flex-1 items-center justify-between gap-2 rounded-xl border border-input bg-muted px-2.5 py-1.5 text-left text-sm"
          >
            {selected ? (
              <span className="inline-flex items-center rounded-md bg-amber-500/15 px-2 py-0.5 font-mono text-xs font-medium text-amber-600 dark:text-amber-300">
                {selected.display}
              </span>
            ) : mapping.type === 'static' && mapping.value ? (
              <span className="truncate text-foreground">{mapping.value}</span>
            ) : (
              <span className="truncate text-muted-foreground">{placeholder}</span>
            )}
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 gap-0 p-0">
            <div className="border-b border-border p-2">
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type or select an attribute"
                className="bg-background text-sm text-foreground"
              />
            </div>
            <div className="max-h-56 overflow-y-auto p-1">
              {filtered.map((a) => (
                <button
                  key={`${a.type}:${a.key}`}
                  type="button"
                  onClick={() => pick(a)}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left font-mono text-sm text-foreground hover:bg-muted"
                >
                  {a.display}
                  {selected?.type === a.type && selected.key === a.key && (
                    <Check className="h-3.5 w-3.5 text-primary" />
                  )}
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                  No matching attribute
                </p>
              )}
              {query.trim() && (
                <button
                  type="button"
                  onClick={useAsFixedText}
                  className="mt-1 flex w-full items-center rounded-md border-t border-border px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  Use &ldquo;{query.trim()}&rdquo; as fixed text
                </button>
              )}
            </div>
          </PopoverContent>
        </Popover>
        {hasValue && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear"
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {mapping.type !== 'static' && (
        <Input
          value={mapping.fallback ?? ''}
          onChange={(e) => onChange({ ...mapping, fallback: e.target.value })}
          placeholder={`If we can't find ${selected?.display ?? 'this value'}`}
          className="bg-muted text-xs text-foreground placeholder:text-muted-foreground"
        />
      )}
    </div>
  );
}
