# Multi-User Plane Sharing Feature - Implementation Summary

**Status**: Code implementation complete (no commands executed per user request)  
**Date**: 2026-05-19  
**Feature**: Multi-user data sharing for planes with full read/write access

## Overview

This feature allows users to share entire planes with other users in the database, providing full read and write access to all collections and data within the shared plane. The "General" view has been renamed to "Overview & Data Sharing" to reflect this new capability.

## Backend Changes

### 1. Database Schema (`backend/app/models.py`)

**New Model: `PlaneShare`**
- Implements many-to-many relationship between planes and users
- Tracks which users have access to which planes
- Cascade deletes when plane or user is removed
- Fields:
  - `id`: Primary key (UUID)
  - `plane_id`: Foreign key to `plane.id`
  - `user_id`: Foreign key to `user.id`
  - `created_at`: Timestamp of share creation
  - `plane`: Relationship to Plane model
  - `user`: Relationship to User model

**Updated Models:**
- `Plane` model: Added `shared_with` relationship (list of PlaneShare objects)
- `PlanePublic` model: Added `shared_with` field (list of UserPublic) for API responses
- `User` model: Added `shared_planes` relationship for tracking shares
- New schemas: `PlaneShareCreate`, `PlaneSharePublic`

### 2. Database Migration

**File**: `backend/app/alembic/versions/a7b3c8d9e2f1_add_plane_share_table.py`

Creates the `planeshare` table with:
- Primary key: `id`
- Foreign keys: `plane_id`, `user_id` (both with CASCADE delete)
- Indexes on `plane_id` and `user_id` for performance
- Migration revision ID: `a7b3c8d9e2f1`
- Revises: `1a31ce608336`

**To apply migration (when ready):**
```bash
cd backend
alembic upgrade head
```

### 3. API Endpoints (`backend/app/api/routes/planes.py`)

**Modified Endpoints:**

1. **GET /planes/** - Read planes
   - Now returns planes owned by user OR shared with user
   - Uses SQL outer join with PlaneShare table
   - Returns planes with `shared_with` field populated

2. **GET /planes/{id}** - Read single plane
   - Access check now includes shared planes
   - Returns plane with `shared_with` users

3. **POST /planes/** - Create plane
   - Planes are private by default (no shares created)
   - Returns plane with empty `shared_with` array

4. **PUT /planes/{id}** - Update plane
   - Only owner can update plane metadata (name)
   - Shared users cannot rename planes

5. **DELETE /planes/{id}** - Delete plane
   - Only owner can delete
   - Cascade deletes all shares via database constraint

6. **POST /planes/{id}/elements**, **PUT /planes/{id}/elements/{id}**, **DELETE /planes/{id}/elements/{id}**
   - Now allow both owner AND shared users to modify elements
   - Full read/write access for shared users

**New Endpoints:**

1. **POST /planes/{id}/share** - Share plane with user
   - Request body: `{ "user_id": "uuid" }`
   - Only plane owner can share
   - Cannot share with self
   - Prevents duplicate shares
   - Returns updated plane with new share

2. **DELETE /planes/{id}/share/{user_id}** - Unshare plane
   - Only plane owner can unshare
   - Removes user from plane sharing
   - Returns updated plane

3. **GET /planes/search-users/** - Search users for sharing
   - Query params: `q` (search string, min 2 chars), `limit` (default 10)
   - Searches by email or full_name (case-insensitive)
   - Excludes current user from results
   - Returns list of `UserPublic` objects

**Helper Functions:**
- `_has_plane_access(plane, user)`: Checks if user is owner or has share access
- `_populate_shared_with(plane)`: Converts Plane to PlanePublic with shared_with populated

### 4. State API Updates (`backend/app/api/routes/state.py`)

**Modified:**
- `read_state()` now includes shared planes in user's state
- Uses SQL outer join to fetch both owned and shared planes
- Imports `PlaneShare` model and `or_` from SQLModel

## Frontend Changes

### 1. Type Definitions

**`frontend/src/store/AppContext.tsx`:**
```typescript
export type Plane = {
  id: string
  name: string
  elements: CanvasElement[]
  ownerId?: string
  sharedWith?: Array<{ id: string; email: string; full_name: string | null }>
}
```

**`frontend/src/store/apiTypes.ts`:**
```typescript
export interface ApiPlane {
  id: string
  name: string
  owner_id: string
  created_at: string | null
  elements: ApiCanvasElement[]
  shared_with?: Array<{
    id: string
    email: string
    full_name: string | null
  }>
}
```

Updated `apiPlaneToPlane()` converter to include `ownerId` and `sharedWith` fields.

### 2. UI Changes

**`frontend/src/routes/Organization.page.tsx`:**
- Renamed "General" tab to "Overview & Data Sharing"

**`frontend/src/components/AppLayout.tsx`:**
- Updated header plane name display: "General" → "Overview & Data Sharing"
- Updated plane dropdown menu item: "General" → "Overview & Data Sharing"

### 3. Client API Integration

**Note**: The auto-generated client (`frontend/src/client/`) needs to be regenerated to include the new sharing endpoints. Run:
```bash
cd frontend
npm run generate-client
```

This will create TypeScript functions for:
- `PlanesService.sharePlane()`
- `PlanesService.unsharePlane()`
- `PlanesService.searchUsers()`

## Features Implemented

### ✅ Completed Backend Features

1. **Database schema** for plane sharing (many-to-many relationship)
2. **API endpoints** for sharing/unsharing planes
3. **User search endpoint** for finding users to share with
4. **Access control** - shared users can read/write plane elements
5. **Owner-only operations** - only owner can share/unshare/delete/rename
6. **Plane retrieval** includes both owned and shared planes
7. **Database migration** for PlaneShare table

### 🚧 Frontend UI To Be Implemented

The following UI components need to be added to `WelcomePlaneView` and related components:

1. **Share button on plane hover** (in WelcomePlaneView)
   - Show "Share" button when hovering over plane cards
   - Clicking opens user search modal

2. **User search modal**
   - Search field for user names and emails
   - Autocomplete dropdown showing matching users (database users only)
   - Warning message about full read/write access
   - "Share" confirmation button

3. **Plane grouping** in Overview
   - Group private planes under "Private Planes" header
   - Group shared planes under "Shared with [User Name]" headers
   - Show multiple groupings for multi-user shares

4. **Visual badges**
   - "Private" badge for user-owned planes
   - "Shared" badge for planes shared with others
   - Badge should be clearly visible on plane tabs and cards

5. **Unshare functionality**
   - List of shared users on plane card/modal
   - Remove button next to each shared user
   - Confirmation dialog for unsharing

6. **Collection movement confirmations**
   - When moving collections between planes, check if target plane is shared
   - Show confirmation: "This will share data with: [user1, user2, ...]"
   - When moving from shared to unshared: "Users [x, y, z] will lose access"

7. **Dependency handling**
   - When moving items with dependencies, only allow copy (not move)
   - Show dependency warning with affected items

## Testing Checklist

### Backend Tests

Run existing tests to ensure no regressions:
```bash
cd backend
pytest
```

**Test scenarios to add:**

1. **Sharing workflow:**
   - Create plane, share with user, verify user can access
   - Verify non-owner cannot share plane
   - Verify cannot share with self
   - Verify duplicate share prevention

2. **Access control:**
   - Shared user can create/update/delete elements
   - Shared user cannot rename/delete plane
   - Non-shared user cannot access plane

3. **Unsharing:**
   - Owner can remove shared user
   - Removed user can no longer access plane

4. **User search:**
   - Search returns correct users
   - Current user excluded from results
   - Case-insensitive search works

### Frontend Tests (after UI implementation)

1. **UI rendering:**
   - "Overview & Data Sharing" tab displays correctly
   - Share button appears on hover
   - Badges show correctly (Private/Shared)

2. **User search:**
   - Search input triggers API calls
   - Results display correctly
   - Clicking user adds to share list

3. **Sharing workflow:**
   - Share modal shows warning
   - Confirmation creates share
   - Plane appears under "Shared with [User]" section

4. **Permission visualization:**
   - Shared planes show correct badges
   - Owner sees unshare controls
   - Shared user sees different UI (no unshare button)

## API Examples

### Share a plane
```bash
POST /api/planes/{plane_id}/share
Content-Type: application/json
Authorization: Bearer {token}

{
  "user_id": "550e8400-e29b-41d4-a716-446655440000"
}

Response: 200 OK
{
  "id": "...",
  "name": "My Research Plane",
  "owner_id": "...",
  "shared_with": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "email": "colleague@example.com",
      "full_name": "Dr. Jane Smith"
    }
  ],
  "elements": [...]
}
```

### Search users
```bash
GET /api/planes/search-users/?q=jane&limit=5
Authorization: Bearer {token}

Response: 200 OK
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "jane.smith@example.com",
    "full_name": "Dr. Jane Smith",
    "is_active": true,
    "is_superuser": false,
    "created_at": "2026-01-01T00:00:00Z"
  },
  ...
]
```

### Unshare a plane
```bash
DELETE /api/planes/{plane_id}/share/{user_id}
Authorization: Bearer {token}

Response: 200 OK
{
  "id": "...",
  "name": "My Research Plane",
  "owner_id": "...",
  "shared_with": [],
  "elements": [...]
}
```

## Security Considerations

1. **Access Control:**
   - Only plane owner can share/unshare/delete
   - Shared users have full read/write on elements but cannot modify plane metadata
   - User search is restricted to authenticated users only

2. **Data Exposure:**
   - User search only returns database users (not external NOMAD users)
   - Current user is always excluded from search results
   - No sensitive data (passwords, tokens) exposed in user search

3. **Validation:**
   - Cannot share with self
   - Duplicate share prevention
   - Cascade deletes handle cleanup properly

4. **Warning Messages:**
   - Users are warned that sharing grants full read/write access
   - Confirmation required when moving data to/from shared planes

## Migration Path

1. **Apply database migration:**
   ```bash
   cd backend
   alembic upgrade head
   ```

2. **Regenerate OpenAPI client:**
   ```bash
   cd frontend
   npm run generate-client
   ```

3. **Implement frontend UI components** (as outlined in "Frontend UI To Be Implemented")

4. **Add frontend tests** for sharing workflows

5. **Test with multiple users:**
   - Create test users
   - Share planes between users
   - Verify access control
   - Test edge cases

## Future Enhancements (Out of Scope)

1. **Granular permissions:**
   - Read-only sharing
   - Element-level permissions
   - Role-based access (viewer, editor, admin)

2. **Share notifications:**
   - Email notification when plane is shared
   - In-app notifications for share events

3. **Share history:**
   - Audit log of sharing actions
   - Track who shared what and when

4. **Share links:**
   - Generate shareable links for external users
   - Time-limited access tokens

5. **Team/Group sharing:**
   - Share with groups instead of individual users
   - Organizational hierarchies

## Notes

- All backend code changes are complete and ready for testing
- Frontend type definitions updated to support sharing data
- UI labels updated ("General" → "Overview & Data Sharing")
- No commands were executed per user's request
- User should run migration and tests when ready
- OpenAPI client regeneration required before implementing frontend UI

## Files Modified

### Backend
- `backend/app/models.py` - Added PlaneShare model and updated related models
- `backend/app/api/routes/planes.py` - Added sharing endpoints and updated access control
- `backend/app/api/routes/state.py` - Updated to include shared planes
- `backend/app/alembic/versions/a7b3c8d9e2f1_add_plane_share_table.py` - New migration

### Frontend
- `frontend/src/store/AppContext.tsx` - Updated Plane type definition
- `frontend/src/store/apiTypes.ts` - Updated ApiPlane interface and converter
- `frontend/src/routes/Organization.page.tsx` - Renamed "General" to "Overview & Data Sharing"
- `frontend/src/components/AppLayout.tsx` - Updated labels for new name

### Documentation
- `PLANE_SHARING_IMPLEMENTATION.md` (this file)
