'use client';

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
  /** Show the "also show on main calendar" toggle (default true). */
  showMainToggle?: boolean;
  /** Hide the host field entirely (e.g. CSV upload where host comes per-row). */
  hubOnly?: boolean;
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
  showMainToggle = true,
  hubOnly = false,
  idPrefix = 'hub-assign',
  className = '',
}: HubAssignFieldsProps) {
  const selectedHub = hubs.find((h) => h.slug === value.hubSlug);
  const hosts = selectedHub?.hosts ?? [];
  const datalistId = `${idPrefix}-host-options`;

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

      {!hubOnly && value.hubSlug && (
        <div>
          <label htmlFor={`${idPrefix}-host`} className={labelClass}>
            Host{' '}
            <span className="font-normal text-gray-400">
              (write-in — auto-filled from source, editable)
            </span>
          </label>
          <input
            id={`${idPrefix}-host`}
            type="text"
            list={datalistId}
            value={value.hostName}
            onChange={(e) => onChange({ ...value, hostName: e.target.value })}
            placeholder={hostSuggestion || 'e.g. Unplugged Collective'}
            className={inputClass}
          />
          <datalist id={datalistId}>
            {hosts.map((host) => (
              <option key={host.id} value={host.name} />
            ))}
          </datalist>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            New host names create a new host for this hub on save.
          </p>
        </div>
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
