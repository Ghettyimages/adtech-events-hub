'use client';

import { useMemo } from 'react';
import SourceCombobox from './SourceCombobox';

export interface HubHostOption {
  id: string;
  slug: string;
  name: string;
  sourceAlias?: string | null;
}

export interface HubOption {
  id: string;
  slug: string;
  name: string;
  timezone?: string | null;
  hosts?: HubHostOption[];
}

export interface HubAssignValue {
  hubSlug: string;
  hostName: string;
  showOnMainCalendar: boolean;
}

interface HubAssignFieldsProps {
  hubs: HubOption[];
  value: HubAssignValue;
  onChange: (next: HubAssignValue) => void;
  /** Suggested host name (e.g. the source name) shown as placeholder. */
  hostSuggestion?: string;
  /** Distinct Event.source values for main-calendar / write-in suggestions. */
  sourceOptions?: string[];
  /** Show the "also show on main calendar" toggle (default true). */
  showMainToggle?: boolean;
  /** Hide the host field entirely (e.g. CSV upload where host comes per-row). */
  hubOnly?: boolean;
  /**
   * Always show source/host field even when no hub is selected
   * (schedule paste → main calendar).
   */
  requireSource?: boolean;
  idPrefix?: string;
  className?: string;
}

const inputClass =
  'w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white';
const labelClass =
  'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2';

export default function HubAssignFields({
  hubs,
  value,
  onChange,
  hostSuggestion,
  sourceOptions = [],
  showMainToggle = true,
  hubOnly = false,
  requireSource = false,
  idPrefix = 'hub-assign',
  className = '',
}: HubAssignFieldsProps) {
  const selectedHub = hubs.find((h) => h.slug === value.hubSlug);
  const hosts = selectedHub?.hosts ?? [];

  const comboboxOptions = useMemo(() => {
    const names = new Set<string>();
    if (value.hubSlug) {
      for (const host of hosts) {
        if (host.name?.trim()) names.add(host.name.trim());
        if (host.sourceAlias?.trim()) names.add(host.sourceAlias.trim());
      }
    }
    for (const s of sourceOptions) {
      if (s?.trim()) names.add(s.trim());
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [value.hubSlug, hosts, sourceOptions]);

  const showSourceField = !hubOnly && (Boolean(value.hubSlug) || requireSource);
  const isHubMode = Boolean(value.hubSlug);

  return (
    <div className={`space-y-3 ${className}`}>
      <div>
        <label htmlFor={`${idPrefix}-hub`} className={labelClass}>
          Festival Hub
        </label>
        <select
          id={`${idPrefix}-hub`}
          value={value.hubSlug}
          onChange={(e) =>
            onChange({ ...value, hubSlug: e.target.value, hostName: '' })
          }
          className={inputClass}
        >
          <option value="">— None (regular calendar) —</option>
          {hubs.map((hub) => (
            <option key={hub.id} value={hub.slug}>
              {hub.name}
            </option>
          ))}
        </select>
      </div>

      {showSourceField && (
        <SourceCombobox
          id={`${idPrefix}-host`}
          value={value.hostName}
          onChange={(hostName) => onChange({ ...value, hostName })}
          options={comboboxOptions}
          label={isHubMode ? 'Host' : 'Source / company'}
          placeholder={
            hostSuggestion ||
            (isHubMode ? 'e.g. Unplugged Collective' : 'Search or type a source…')
          }
          hint={
            isHubMode
              ? 'Pick an existing host or type a new name — new names create a host for this hub on import.'
              : 'Pick an existing source or type a new one — new names are used as the event source on import.'
          }
        />
      )}

      {showMainToggle && value.hubSlug && (
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={value.showOnMainCalendar}
            onChange={(e) =>
              onChange({ ...value, showOnMainCalendar: e.target.checked })
            }
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Also show on the main calendar (default: hub only)
        </label>
      )}
    </div>
  );
}
