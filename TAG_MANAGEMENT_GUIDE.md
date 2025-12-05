# Tag Management Guide

## Overview
Tags can be edited and managed for both pending and published events through the Admin page. Tags help categorize events and enable filtering.

## Where to Edit Tags

### 1. Admin Page (`/admin`)

#### For Pending Events:
1. Navigate to the Admin page
2. View pending events in the "Pending" tab
3. Click the **"✏️ Edit"** button on any event
4. In the edit modal, scroll to the **"Tags"** section
5. Select/deselect tags from the predefined list or add custom tags
6. Click **"Save Changes"** or **"Save & Approve"**

#### For Published Events:
1. Navigate to the Admin page
2. Switch to the "Published" tab
3. Click the **"Edit"** button on any event
4. Modify tags in the edit modal
5. Click **"Save Changes"**

### 2. Tag Editing Features

#### Predefined Tags:
- Click on any predefined tag button to toggle it on/off
- Selected tags are highlighted in blue
- Available predefined tags:
  - adtech
  - publishers
  - programmatic
  - ctv
  - data
  - privacy
  - measurement
  - marketing
  - mobile
  - video

#### Custom Tags:
- Type a custom tag in the input field
- Press Enter or click "Add" to add it
- Custom tags are normalized (lowercase, trimmed)
- You can remove any tag by clicking the × on the tag chip

### 3. Viewing Tags

Tags are displayed:
- In the event edit modal when editing
- In the event detail card when viewing events
- In the event list table
- As filter options in the main calendar view

## Managing Tags

### Adding Tags to Events:
1. Select from predefined tags using the toggle buttons
2. Add custom tags using the input field
3. Tags are automatically normalized (lowercase, hyphenated)

### Removing Tags:
- Click the × button on any selected tag chip
- Or toggle off a predefined tag

### Editing Multiple Events:
- Tags can be edited for any event (pending or published)
- Changes are saved immediately when you click "Save Changes"

## Technical Details

### Tag Storage:
- Tags are stored as a JSON array string in the database
- Format: `["tag1", "tag2", "tag3"]`
- Empty/null when no tags are assigned

### Tag Normalization:
- Tags are automatically normalized:
  - Converted to lowercase
  - Spaces replaced with hyphens
  - Special characters removed (except hyphens)
  - Duplicates removed

### API Endpoints:
- `PATCH /api/events/[id]` - Update event including tags
- Tags should be sent as an array: `["tag1", "tag2"]`
- Empty array or null clears all tags

## Predefined Tags Management

Predefined tags are defined in `src/lib/extractor/tagExtractor.ts`:
- The `PREDEFINED_TAGS` constant contains the list
- To add/remove predefined tags, edit this file
- Tags are automatically available in all tag selection interfaces

## Filtering by Tags

Once tags are added to events:
1. Go to the main calendar page
2. Use the "Tags" filter in the filter panel
3. Select one or more tags to filter events
4. Combined with other filters (location, source, etc.)

