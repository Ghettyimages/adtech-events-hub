'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

interface SourceComboboxProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  label: string;
  hint?: string;
  placeholder?: string;
  className?: string;
}

const inputClass =
  'w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white';
const labelClass =
  'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2';

/**
 * Searchable write-in combobox: pick an existing option or type a new value.
 */
export default function SourceCombobox({
  id,
  value,
  onChange,
  options,
  label,
  hint,
  placeholder = 'Search or type a new name…',
  className = '',
}: SourceComboboxProps) {
  const autoId = useId();
  const inputId = id || autoId;
  const listId = `${inputId}-listbox`;
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options.slice(0, 50);
    return options
      .filter((opt) => opt.toLowerCase().includes(q))
      .slice(0, 50);
  }, [options, value]);

  const exactMatch = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return false;
    return options.some((opt) => opt.toLowerCase() === q);
  }, [options, value]);

  const showCreateRow = value.trim().length > 0 && !exactMatch;

  useEffect(() => {
    setHighlight(0);
  }, [value, open]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const selectOption = (opt: string) => {
    onChange(opt);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      return;
    }
    if (!open) return;

    const itemCount = filtered.length + (showCreateRow ? 1 : 0);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (itemCount === 0 ? 0 : (h + 1) % itemCount));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (itemCount === 0 ? 0 : (h - 1 + itemCount) % itemCount));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (showCreateRow && highlight === 0) {
        onChange(value.trim());
        setOpen(false);
        return;
      }
      const optIndex = showCreateRow ? highlight - 1 : highlight;
      if (optIndex >= 0 && optIndex < filtered.length) {
        selectOption(filtered[optIndex]);
      } else if (value.trim()) {
        onChange(value.trim());
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <label htmlFor={inputId} className={labelClass}>
        {label}
      </label>
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        className={inputClass}
      />
      {open && (filtered.length > 0 || showCreateRow) && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800"
        >
          {showCreateRow && (
            <li
              role="option"
              aria-selected={highlight === 0}
              className={`cursor-pointer px-3 py-2 text-sm ${
                highlight === 0
                  ? 'bg-blue-50 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100'
                  : 'text-gray-700 dark:text-gray-200'
              }`}
              onMouseEnter={() => setHighlight(0)}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(value.trim());
                setOpen(false);
              }}
            >
              Create new: <span className="font-semibold">{value.trim()}</span>
            </li>
          )}
          {filtered.map((opt, i) => {
            const idx = showCreateRow ? i + 1 : i;
            return (
              <li
                key={opt}
                role="option"
                aria-selected={highlight === idx}
                className={`cursor-pointer px-3 py-2 text-sm ${
                  highlight === idx
                    ? 'bg-blue-50 text-blue-900 dark:bg-blue-900/40 dark:text-blue-100'
                    : 'text-gray-700 dark:text-gray-200'
                }`}
                onMouseEnter={() => setHighlight(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectOption(opt);
                }}
              >
                {opt}
              </li>
            );
          })}
        </ul>
      )}
      {hint && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</p>
      )}
    </div>
  );
}
