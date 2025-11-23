# Access Request UI Patterns

**Phase 4 - Section H.5.6**
**Enterprise-Grade UI Guidelines for Confidential Element Access Workflow**

## Overview

This document describes UI/UX patterns for implementing the access request workflow in the Olumi frontend. The patterns ensure consistent, intuitive user experience while maintaining security and transparency.

---

## Table of Contents

1. [User Roles & Permissions](#user-roles--permissions)
2. [UI Components](#ui-components)
3. [User Flows](#user-flows)
4. [API Integration](#api-integration)
5. [State Management](#state-management)
6. [Error Handling](#error-handling)
7. [Accessibility](#accessibility)
8. [Responsive Design](#responsive-design)

---

## User Roles & Permissions

### Viewer (Request Access)
- **Can**: Request access to confidential elements
- **Cannot**: Approve/deny requests, modify visibility settings
- **UI Elements**: Request access button, request status badge, notification center

### Editor (Request Access)
- **Can**: Request access to confidential elements
- **Cannot**: Approve/deny requests for elements they don't own
- **UI Elements**: Same as Viewer + edit capabilities for non-confidential elements

### Admin/Owner (Manage Requests)
- **Can**: View all pending requests, approve/deny requests, configure visibility
- **Cannot**: Bypass audit logging
- **UI Elements**: Request management dashboard, approval/denial modal, notification center

---

## UI Components

### 1. Confidential Element Indicator

**Purpose**: Clearly communicate that an element is confidential and requires access.

```
┌────────────────────────────────────────┐
│  🔒 Confidential Element               │
│                                        │
│  [Redacted Content]                    │
│                                        │
│  You don't have access to this element│
│  [Request Access]                      │
└────────────────────────────────────────┘
```

**Styling**:
- Background: Semi-transparent gray (#F5F5F5 with opacity)
- Icon: Lock icon (🔒) or custom SVG
- Typography: Clear, readable font with muted colors
- Button: Primary action button (blue/brand color)

**States**:
1. **No Access**: Shows "Request Access" button
2. **Pending**: Shows "Access Pending" badge (yellow/orange)
3. **Has Access**: Shows unlocked content with subtle indicator
4. **Request Denied**: Shows "Access Denied" with reason (red)

**Implementation Notes**:
- Component should gracefully degrade if metadata fails to load
- Hover state should show tooltip with additional context
- Keyboard accessible (Tab to button, Enter to request)

---

### 2. Request Access Modal

**Purpose**: Collect rationale for access request and confirm submission.

```
┌──────────────────────────────────────────────────────────┐
│  Request Access to Confidential Element                  │
│                                                           │
│  Why do you need access to this element?                 │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ [Rationale textarea - max 500 characters]           │ │
│  │                                                      │ │
│  │                                                      │ │
│  └─────────────────────────────────────────────────────┘ │
│  Character count: 0/500                                  │
│                                                           │
│  Rate limit: X of 10 requests remaining today            │
│                                                           │
│  [Cancel]                           [Submit Request]     │
└──────────────────────────────────────────────────────────┘
```

**Form Fields**:
- **Rationale** (optional, max 500 chars): Textarea with character counter
- Rate limit warning if approaching limit (≥8 requests)

**Validation**:
- Max 500 characters for rationale
- Show rate limit warning prominently
- Disable submit if rate limit exceeded

**Success Flow**:
1. Show success toast: "Access request submitted"
2. Close modal
3. Update element state to "Pending"
4. Show notification badge

**Error Handling**:
- Rate limit exceeded (429): Show error with retry time
- Element not confidential (400): Show error, close modal
- Already has access (200): Show success message, close modal
- Network error: Show retry button

---

### 3. Access Request Notification

**Purpose**: Inform users about request status changes.

**Types**:

**A. Request Created (For Board Owner)**
```
┌────────────────────────────────────────────────────────┐
│ 🔔 New Access Request                                  │
│                                                        │
│ [User Name] requested access to [Element Name]        │
│ Rationale: "I need this data for the Q4 report"       │
│                                                        │
│ [View Request] [Approve] [Deny]                       │
└────────────────────────────────────────────────────────┘
```

**B. Request Approved (For Requester)**
```
┌────────────────────────────────────────────────────────┐
│ ✅ Access Request Approved                             │
│                                                        │
│ Your access to [Element Name] has been approved       │
│ by [Approver Name]                                     │
│ Access expires: [Date/Time]                            │
│                                                        │
│ [View Element]                                         │
└────────────────────────────────────────────────────────┘
```

**C. Request Denied (For Requester)**
```
┌────────────────────────────────────────────────────────┐
│ ❌ Access Request Denied                               │
│                                                        │
│ Your access to [Element Name] was denied               │
│ by [Denier Name]                                       │
│ Reason: "This element contains sensitive data"         │
│                                                        │
│ [Dismiss]                                              │
└────────────────────────────────────────────────────────┘
```

**D. Access Expired (For Requester)**
```
┌────────────────────────────────────────────────────────┐
│ ⏰ Access Expired                                      │
│                                                        │
│ Your access to [Element Name] has expired             │
│ You can request access again if needed                 │
│                                                        │
│ [Request Again] [Dismiss]                             │
└────────────────────────────────────────────────────────┘
```

**Notification Bell Behavior**:
- Red badge count for unread notifications
- Dropdown panel with scrollable list
- Auto-mark as read after 3 seconds of viewing
- Group by board/element for clarity

---

### 4. Request Management Dashboard (Admin/Owner)

**Purpose**: Central hub for managing all pending access requests.

```
┌──────────────────────────────────────────────────────────────┐
│  Access Requests                              [X] Pending    │
│  ────────────────────────────────────────────────────────    │
│                                                              │
│  Board: Q4 Strategy Board                                   │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 🔒 Confidential Chart: Revenue Forecast                │ │
│  │                                                         │ │
│  │ Requester: jane@company.com                            │ │
│  │ Requested: 2 hours ago                                 │ │
│  │ Rationale: "Need data for board presentation"          │ │
│  │                                                         │ │
│  │ [View Element] [Approve] [Deny]                        │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  Board: Engineering Roadmap                                 │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 🔒 Sticky Note: API Key Discussion                     │ │
│  │ ...                                                     │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**Features**:
- Group by board for organization
- Show element type icon (chart, note, etc.)
- Display requester name/email
- Show relative timestamp
- Quick approve/deny actions
- Link to view element in context

**Filters**:
- All / Pending / Approved / Denied / Expired
- Board filter dropdown
- Date range picker
- Requester search

**Bulk Actions**:
- Select multiple requests
- Bulk approve/deny (with confirmation)
- Export to CSV (for audit)

---

### 5. Approve/Deny Modal (Admin/Owner)

**Approve Modal**:
```
┌──────────────────────────────────────────────────────────┐
│  Approve Access Request                                  │
│                                                           │
│  Grant access to [User Name] for:                        │
│  🔒 [Element Name]                                       │
│                                                           │
│  Access duration:                                        │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ [Dropdown: 1 day / 7 days / 30 days / 90 days]     │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                           │
│  Access will expire on: [Calculated Date]                │
│                                                           │
│  [Cancel]                                  [Approve]     │
└──────────────────────────────────────────────────────────┘
```

**Deny Modal**:
```
┌──────────────────────────────────────────────────────────┐
│  Deny Access Request                                     │
│                                                           │
│  Deny access to [User Name] for:                         │
│  🔒 [Element Name]                                       │
│                                                           │
│  Reason (optional):                                      │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ [Textarea - max 500 characters]                     │ │
│  │                                                      │ │
│  └─────────────────────────────────────────────────────┘ │
│  Character count: 0/500                                  │
│                                                           │
│  [Cancel]                                  [Deny]        │
└──────────────────────────────────────────────────────────┘
```

**Validation**:
- Approve: Duration must be 1-90 days
- Deny: Reason max 500 characters (optional)
- Show confirmation toast on success
- Update dashboard in real-time

---

### 6. My Access Requests (User View)

**Purpose**: Allow users to track their own access requests across all boards.

```
┌──────────────────────────────────────────────────────────────┐
│  My Access Requests                       [Filter: All ▼]   │
│  ────────────────────────────────────────────────────────    │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ ⏳ Pending • Q4 Strategy Board                         │ │
│  │ 🔒 Revenue Forecast Chart                              │ │
│  │ Requested: 2 hours ago                                 │ │
│  │ Rationale: "Need data for presentation"                │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ ✅ Approved • Engineering Roadmap                      │ │
│  │ 🔒 API Key Discussion Note                             │ │
│  │ Approved: 1 day ago by john@company.com                │ │
│  │ Expires: in 6 days                                     │ │
│  │ [View Element]                                         │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ ❌ Denied • HR Board                                   │ │
│  │ 🔒 Salary Data Spreadsheet                             │ │
│  │ Denied: 3 days ago by hr@company.com                   │ │
│  │ Reason: "Requires HR approval process"                 │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

**Status Indicators**:
- ⏳ Pending (Yellow/Orange)
- ✅ Approved (Green)
- ❌ Denied (Red)
- ⏰ Expired (Gray)

**Actions**:
- View Element (if approved)
- Request Again (if denied/expired)
- Cancel Request (if pending, future enhancement)

---

## User Flows

### Flow 1: Requester - Request Access

1. User opens board, sees redacted confidential element
2. User hovers over element, sees tooltip: "Confidential - Click to request access"
3. User clicks "Request Access" button
4. Modal opens with rationale textarea
5. User enters rationale (optional) and clicks "Submit Request"
6. API call: `POST /boards/:boardId/elements/:elementId/request-access`
7. Success: Toast notification, element updates to "Pending" state
8. Notification sent to board owner

**Edge Cases**:
- Rate limit exceeded: Show error modal with retry time
- Already has access: Show success message, unlock element
- Pending request exists: Show "Access Pending" badge
- Network error: Show retry button

---

### Flow 2: Owner - Approve Request

1. Owner receives notification: "New access request from [User]"
2. Owner clicks "View Request" or opens Request Management Dashboard
3. Owner sees request details (requester, rationale, element)
4. Owner clicks "Approve" button
5. Modal opens with duration dropdown (default: 7 days)
6. Owner selects duration, clicks "Approve"
7. API call: `POST /access-requests/:requestId/approve`
8. Success: Toast notification, request removed from pending
9. Notification sent to requester
10. Requester gains access to element immediately

**Edge Cases**:
- Request already processed: Show error, refresh list
- Authorization failure: Show error, require re-login
- Network error: Show retry button

---

### Flow 3: Owner - Deny Request

1. Owner follows steps 1-3 from Flow 2
2. Owner clicks "Deny" button
3. Modal opens with optional reason textarea
4. Owner enters reason (optional), clicks "Deny"
5. API call: `POST /access-requests/:requestId/deny`
6. Success: Toast notification, request removed from pending
7. Notification sent to requester with reason
8. Element remains redacted for requester

---

### Flow 4: Automatic Expiration

1. Background job detects expired access (runs every 5 minutes)
2. User removed from element viewer whitelist
3. Notification sent to user: "Access expired"
4. Next time user opens board, element becomes redacted again
5. User can request access again if needed

**UX Consideration**:
- Show warning notification 24 hours before expiration (future enhancement)
- Allow users to request extension before expiration (future enhancement)

---

## API Integration

### Request Access

**Endpoint**: `POST /api/collab/boards/:boardId/elements/:elementId/request-access`

**Request**:
```json
{
  "rationale": "I need this data for Q4 board presentation"
}
```

**Response (201 Created)**:
```json
{
  "success": true,
  "data": {
    "request_id": "uuid-here",
    "status": "pending",
    "requested_at": "2025-01-15T10:30:00Z"
  }
}
```

**Error Responses**:
- `400`: Element not confidential or doesn't exist
- `403`: No board access
- `429`: Rate limit exceeded (10 requests/day/board)

---

### Get Pending Requests (Admin/Owner)

**Endpoint**: `GET /api/collab/boards/:boardId/access-requests`

**Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "requests": [
      {
        "request_id": "uuid-1",
        "element_id": "elem-123",
        "requester_user_id": "user-456",
        "requester_name": "Jane Doe",
        "requester_email": "jane@company.com",
        "requested_at": "2025-01-15T10:30:00Z",
        "rationale": "Need for presentation",
        "status": "pending"
      }
    ],
    "total": 1
  }
}
```

---

### Get My Requests

**Endpoint**: `GET /api/collab/my-access-requests`

**Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "requests": [
      {
        "request_id": "uuid-1",
        "board_id": "board-123",
        "element_id": "elem-456",
        "status": "pending",
        "requested_at": "2025-01-15T10:30:00Z",
        "rationale": "Need for presentation"
      },
      {
        "request_id": "uuid-2",
        "board_id": "board-789",
        "element_id": "elem-012",
        "status": "approved",
        "approved_at": "2025-01-14T15:00:00Z",
        "expires_at": "2025-01-21T15:00:00Z"
      }
    ],
    "total": 2
  }
}
```

---

### Approve Request

**Endpoint**: `POST /api/collab/access-requests/:requestId/approve`

**Request**:
```json
{
  "expires_in_days": 7
}
```

**Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "request": {
      "request_id": "uuid-1",
      "status": "approved",
      "approved_at": "2025-01-15T11:00:00Z",
      "expires_at": "2025-01-22T11:00:00Z"
    },
    "message": "Access granted"
  }
}
```

---

### Deny Request

**Endpoint**: `POST /api/collab/access-requests/:requestId/deny`

**Request**:
```json
{
  "reason": "This data is restricted to HR department only"
}
```

**Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "request": {
      "request_id": "uuid-1",
      "status": "denied",
      "denied_at": "2025-01-15T11:00:00Z",
      "denial_reason": "This data is restricted to HR department only"
    },
    "message": "Access request denied"
  }
}
```

---

## State Management

### React/Redux Example

```typescript
// Redux slice for access requests
interface AccessRequestsState {
  myRequests: AccessRequest[];
  pendingRequests: AccessRequest[]; // For admin/owner
  loading: boolean;
  error: string | null;
}

// Actions
const accessRequestsSlice = createSlice({
  name: 'accessRequests',
  initialState,
  reducers: {
    requestAccessPending: (state) => {
      state.loading = true;
    },
    requestAccessSuccess: (state, action) => {
      state.myRequests.push(action.payload);
      state.loading = false;
    },
    requestAccessFailure: (state, action) => {
      state.error = action.payload;
      state.loading = false;
    },
    // ... more actions
  },
});

// Thunks
export const requestAccess = (boardId, elementId, rationale) => async (dispatch) => {
  dispatch(requestAccessPending());
  try {
    const response = await api.post(
      `/api/collab/boards/${boardId}/elements/${elementId}/request-access`,
      { rationale }
    );
    dispatch(requestAccessSuccess(response.data.data));
    showToast('Access request submitted', 'success');
  } catch (error) {
    dispatch(requestAccessFailure(error.message));
    handleError(error);
  }
};
```

### Vue/Vuex Example

```typescript
// Vuex store module
export const accessRequestsModule = {
  namespaced: true,
  state: {
    myRequests: [],
    pendingRequests: [],
    loading: false,
    error: null,
  },
  mutations: {
    SET_MY_REQUESTS(state, requests) {
      state.myRequests = requests;
    },
    ADD_MY_REQUEST(state, request) {
      state.myRequests.unshift(request);
    },
    SET_LOADING(state, loading) {
      state.loading = loading;
    },
    // ... more mutations
  },
  actions: {
    async requestAccess({ commit }, { boardId, elementId, rationale }) {
      commit('SET_LOADING', true);
      try {
        const { data } = await api.post(
          `/api/collab/boards/${boardId}/elements/${elementId}/request-access`,
          { rationale }
        );
        commit('ADD_MY_REQUEST', data.data);
        this.$toast.success('Access request submitted');
      } catch (error) {
        commit('SET_ERROR', error.message);
        handleError(error);
      } finally {
        commit('SET_LOADING', false);
      }
    },
  },
};
```

---

## Error Handling

### HTTP Error Codes

| Code | Meaning | UI Action |
|------|---------|-----------|
| 400 | Bad Request (element not confidential, invalid input) | Show error toast, close modal |
| 401 | Unauthorized (JWT expired) | Redirect to login |
| 403 | Forbidden (no board access) | Show error toast with message |
| 404 | Not Found (request/board/element doesn't exist) | Show error toast, refresh data |
| 429 | Rate Limit Exceeded | Show error modal with retry time |
| 500 | Internal Server Error | Show error toast with retry button |

### User-Friendly Error Messages

```typescript
const ERROR_MESSAGES = {
  RATE_LIMIT: 'You've reached the daily request limit (10 per board). Try again tomorrow.',
  ALREADY_HAS_ACCESS: 'Great news! You already have access to this element.',
  ELEMENT_NOT_CONFIDENTIAL: 'This element is not confidential.',
  NO_BOARD_ACCESS: 'You need board access before requesting element access.',
  REQUEST_NOT_FOUND: 'This request no longer exists.',
  NETWORK_ERROR: 'Connection error. Please check your internet and try again.',
  UNKNOWN_ERROR: 'Something went wrong. Please try again.',
};
```

### Retry Logic

```typescript
// Exponential backoff for network errors
async function requestWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fetch(url, options);
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(Math.pow(2, i) * 1000); // 1s, 2s, 4s
    }
  }
}
```

---

## Accessibility

### Keyboard Navigation

- **Tab**: Navigate between interactive elements
- **Enter/Space**: Activate buttons/links
- **Escape**: Close modals
- **Arrow Keys**: Navigate notification list

### Screen Reader Support

```html
<!-- Confidential element -->
<div role="region" aria-label="Confidential element" aria-describedby="access-description">
  <p id="access-description">
    This element requires access approval. Use the Request Access button to submit a request.
  </p>
  <button aria-label="Request access to confidential element">
    Request Access
  </button>
</div>

<!-- Request status badge -->
<span role="status" aria-live="polite">
  Access request pending approval
</span>

<!-- Notification -->
<div role="alert" aria-live="assertive">
  Your access request has been approved
</div>
```

### ARIA Labels

- Use `aria-label` for icon-only buttons
- Use `aria-describedby` for form field help text
- Use `role="alert"` for important notifications
- Use `aria-live="polite"` for status updates

### Focus Management

- Trap focus inside modals
- Return focus to trigger element after modal closes
- Provide visible focus indicators (outline, shadow)

---

## Responsive Design

### Mobile (<768px)

- Stack buttons vertically
- Full-width modals with bottom sheet pattern
- Swipeable notification cards
- Compact request cards with collapsible details

### Tablet (768px - 1024px)

- Two-column layout for request dashboard
- Side panel for request details
- Floating action button for quick access

### Desktop (>1024px)

- Three-column layout for large screens
- Inline request management in board view
- Hover tooltips with detailed information

---

## Performance Considerations

### Lazy Loading

- Load notifications on demand (paginated)
- Lazy load request dashboard data
- Virtual scrolling for long lists

### Caching

- Cache my requests in local storage (5-minute TTL)
- Invalidate cache on status change
- Use React Query / SWR for automatic revalidation

### Real-Time Updates

- WebSocket connection for live notification push
- Optimistic UI updates for better perceived performance
- Debounce search/filter inputs (300ms)

---

## Security Considerations

### Client-Side Validation

- Validate rationale length (<= 500 chars)
- Validate duration selection (1-90 days)
- Sanitize user input before display (XSS prevention)

### Rate Limiting

- Display remaining requests prominently
- Disable submit button when limit reached
- Show countdown to rate limit reset

### Data Privacy

- Never expose other users' rationales
- Mask sensitive data in error messages
- Log security events (audit trail)

---

## Testing Guidelines

### Unit Tests

- Test component rendering for all states
- Test form validation logic
- Test error handling
- Test API integration (mocked)

### Integration Tests

- Test full request flow (E2E)
- Test notification display
- Test dashboard filtering/sorting
- Test approval/denial workflow

### Accessibility Tests

- Use axe-core or similar tool
- Test keyboard navigation
- Test screen reader compatibility
- Test focus management

---

## Implementation Checklist

- [ ] Confidential element indicator component
- [ ] Request access modal
- [ ] Notification system integration
- [ ] Request management dashboard (admin/owner)
- [ ] Approve/deny modals
- [ ] My access requests view
- [ ] API integration layer
- [ ] State management setup
- [ ] Error handling logic
- [ ] Accessibility features
- [ ] Responsive design
- [ ] Unit tests
- [ ] Integration tests
- [ ] User acceptance testing

---

## Future Enhancements

### Phase 5 Considerations

1. **Access Extension**: Request to extend expiring access
2. **Expiring Soon Warning**: 24h notification before expiration
3. **Bulk Operations**: Approve/deny multiple requests at once
4. **Advanced Filtering**: Complex queries on request dashboard
5. **Analytics Dashboard**: Track request patterns, approval rates
6. **Custom Workflows**: Multi-step approval process
7. **Delegation**: Assign approval authority to other users
8. **Request Comments**: Threaded discussion on requests
9. **Audit Log Viewer**: UI for viewing security events
10. **Mobile App**: Native iOS/Android implementation

---

## References

- API Documentation: `src/api/routes-access-requests.ts`
- Database Schema: `src/database/client-access-requests.ts`
- Notification Types: `src/notifications/notification-types.ts`
- Security Assessment: `docs/SECURITY-ASSESSMENT.md`

---

**Last Updated**: 2025-01-15
**Document Version**: 1.0
**Author**: Olumi Development Team
