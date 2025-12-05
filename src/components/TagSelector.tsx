'use client';

import { useState, useEffect, useRef } from 'react';
import { Tag } from '@prisma/client';
import { getDisplayName } from '@/lib/tags';

interface TagSelectorProps {
  selectedTags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  allowCustom?: boolean;
  onCustomTagAdd?: (tag: string) => void; // Callback when custom tag is added
}

export default function TagSelector({
  selectedTags,
  onChange,
  placeholder = 'Select tags...',
  allowCustom = true,
  onCustomTagAdd,
}: TagSelectorProps) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [customTagInput, setCustomTagInput] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch tags from API
  useEffect(() => {
    const fetchTags = async () => {
      try {
        const res = await fetch('/api/tags?sort=name');
        if (res.ok) {
          const data = await res.json();
          setTags(data.tags || []);
        }
      } catch (error) {
        console.error('Error fetching tags:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTags();
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
        setCustomTagInput('');
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Filter tags based on search query
  const filteredTags = tags.filter((tag) => {
    const displayName = getDisplayName(tag);
    const lowerQuery = searchQuery.toLowerCase();
    return (
      displayName.toLowerCase().includes(lowerQuery) ||
      tag.name.toLowerCase().includes(lowerQuery) ||
      (tag.description && tag.description.toLowerCase().includes(lowerQuery))
    );
  });

  const handleTagToggle = (tagName: string) => {
    if (selectedTags.includes(tagName)) {
      onChange(selectedTags.filter((t) => t !== tagName));
    } else {
      onChange([...selectedTags, tagName]);
    }
  };

  const handleRemoveTag = (tagName: string) => {
    onChange(selectedTags.filter((t) => t !== tagName));
  };

  const handleAddCustomTag = () => {
    const normalized = customTagInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (normalized && !selectedTags.includes(normalized)) {
      onChange([...selectedTags, normalized]);
      if (onCustomTagAdd) {
        onCustomTagAdd(normalized);
      }
      setCustomTagInput('');
    }
  };

  const handleCustomTagKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddCustomTag();
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Selected tags display */}
      {selectedTags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {selectedTags.map((tagName) => {
            const tag = tags.find((t) => t.name === tagName);
            const displayName = tag ? getDisplayName(tag) : tagName;
            
            return (
              <span
                key={tagName}
                className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-sm font-medium text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                style={tag?.color ? { backgroundColor: tag.color + '20', color: tag.color } : undefined}
              >
                {displayName}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tagName)}
                  className="hover:text-blue-600 dark:hover:text-blue-300 ml-1"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Dropdown trigger */}
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setIsOpen(!isOpen);
            if (!isOpen) {
              setTimeout(() => inputRef.current?.focus(), 100);
            }
          }}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-left text-sm shadow-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        >
          <span className={selectedTags.length === 0 ? 'text-gray-500' : ''}>
            {selectedTags.length === 0 ? placeholder : `${selectedTags.length} tag(s) selected`}
          </span>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
            <svg
              className={`h-5 w-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </span>
        </button>

        {/* Dropdown menu */}
        {isOpen && (
          <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-gray-300 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
            {/* Search input */}
            <div className="sticky top-0 border-b border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800">
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tags..."
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                autoFocus
              />
            </div>

            {/* Tag list */}
            <div className="max-h-48 overflow-auto py-1">
              {loading ? (
                <div className="px-3 py-2 text-sm text-gray-500">Loading tags...</div>
              ) : filteredTags.length === 0 && searchQuery ? (
                <div className="px-3 py-2 text-sm text-gray-500">No tags found</div>
              ) : (
                filteredTags.map((tag) => {
                  const displayName = getDisplayName(tag);
                  const isSelected = selectedTags.includes(tag.name);

                  return (
                    <label
                      key={tag.id}
                      className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleTagToggle(tag.name)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="flex-1">{displayName}</span>
                      {tag.usageCount > 0 && (
                        <span className="text-xs text-gray-500">
                          ({tag.usageCount})
                        </span>
                      )}
                      {tag.color && (
                        <span
                          className="h-4 w-4 rounded-full"
                          style={{ backgroundColor: tag.color }}
                        />
                      )}
                    </label>
                  );
                })
              )}
            </div>

            {/* Custom tag input */}
            {allowCustom && (
              <div className="border-t border-gray-200 p-2 dark:border-gray-700">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={customTagInput}
                    onChange={(e) => setCustomTagInput(e.target.value)}
                    onKeyPress={handleCustomTagKeyPress}
                    placeholder="Add custom tag..."
                    className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomTag}
                    disabled={!customTagInput.trim()}
                    className="rounded-md bg-gray-600 px-3 py-2 text-sm text-white hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

