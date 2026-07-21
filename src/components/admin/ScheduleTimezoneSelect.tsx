'use client';

import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import {
  DEFAULT_TIMED_ZONE,
  FESTIVAL_HUB_DEFAULT_ZONE,
} from '@/lib/eventTemporal';

export const SCHEDULE_TZ_PRESETS = [
  DEFAULT_TIMED_ZONE,
  'America/Chicago',
  'America/Los_Angeles',
  'Europe/London',
  FESTIVAL_HUB_DEFAULT_ZONE,
  'UTC',
] as const;

export function isValidIanaTimezone(zone: string): boolean {
  const trimmed = zone.trim();
  if (!trimmed) return false;
  return DateTime.local().setZone(trimmed).isValid;
}

interface ScheduleTimezoneSelectProps {
  id?: string;
  value: string;
  onChange: (zone: string) => void;
  /** When true (hub selected), control is locked to the hub timezone. */
  locked?: boolean;
  helperText?: string;
  className?: string;
}

/**
 * Batch timezone picker for schedule paste: presets + optional custom IANA.
 */
export default function ScheduleTimezoneSelect({
  id = 'schedule-tz',
  value,
  onChange,
  locked = false,
  helperText,
  className = '',
}: ScheduleTimezoneSelectProps) {
  const inPresets = useMemo(
    () => (SCHEDULE_TZ_PRESETS as readonly string[]).includes(value),
    [value]
  );
  const [useOther, setUseOther] = useState(!inPresets);
  const [otherDraft, setOtherDraft] = useState(inPresets ? '' : value);
  const otherValid = !otherDraft.trim() || isValidIanaTimezone(otherDraft);

  useEffect(() => {
    if (locked || inPresets) {
      setUseOther(false);
      setOtherDraft('');
    }
  }, [locked, inPresets, value]);

  const selectValue = !locked && useOther ? '__other__' : value;

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        Default timezone
      </label>
      <select
        id={id}
        value={selectValue}
        disabled={locked}
        onChange={(e) => {
          const next = e.target.value;
          if (next === '__other__') {
            setUseOther(true);
            setOtherDraft('');
            return;
          }
          setUseOther(false);
          onChange(next);
        }}
        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent dark:bg-gray-700 dark:text-white disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {SCHEDULE_TZ_PRESETS.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
        {locked && !inPresets && <option value={value}>{value}</option>}
        {!locked && <option value="__other__">Other (custom IANA)…</option>}
      </select>
      {useOther && !locked && (
        <input
          type="text"
          value={otherDraft}
          onChange={(e) => {
            const v = e.target.value;
            setOtherDraft(v);
            if (isValidIanaTimezone(v)) onChange(v.trim());
          }}
          placeholder="e.g. Asia/Tokyo"
          className={`mt-2 w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent dark:bg-gray-700 dark:text-white ${
            otherValid
              ? 'border-gray-300 dark:border-gray-600'
              : 'border-red-400 dark:border-red-500'
          }`}
        />
      )}
      {helperText && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{helperText}</p>
      )}
      {!locked && useOther && otherDraft.trim() && !otherValid && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">
          Enter a valid IANA timezone (e.g. America/New_York).
        </p>
      )}
    </div>
  );
}
