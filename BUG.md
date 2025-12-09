# Verity Issue: `meta.isLoading` stays `true` after successful fetch

**For submission to:** https://github.com/YidiDev/verity/issues

---

## Summary

When using Verity with reactive frameworks (Alpine.js), accessing the same item multiple times through reactive getters can cause `meta.isLoading` to remain `true` even after the data has been successfully fetched and populated.

## Environment

- **Verity version:** 1.0.7
- **Framework:** Alpine.js 3.x
- **Package manager:** npm (ES module imports)
- **Integration:** `verity-dl` with `verity-dl/adapters/alpine`

## Reproduction Steps

### 1. Setup Verity

```javascript
// main.js
import { init, createType } from 'verity-dl';
import { ensureAlpineStore } from 'verity-dl/adapters/alpine';

// Make Alpine available globally
window.Alpine = Alpine;

// Initialize Verity
init({
    sse: {
        enabled: true,
        url: '/api/events',
        audience: 'global',
        withCredentials: true,
        connectOnInit: false
    }
});

// Register "me" as a singleton type
createType('me', {
    fetch: async (id) => {
        console.log('[Verity] Fetching me, id:', id);
        const response = await fetch('/api/me', {
            credentials: 'include'
        });
        console.log('[Verity] /api/me response status:', response.status);
        
        if (response.status === 401) {
            return null;
        }
        if (!response.ok) {
            throw new Error('Failed to fetch user info');
        }
        
        const data = await response.json();
        console.log('[Verity] /api/me returned data:', data);
        return data;
    },
    stalenessMs: 60_000
});

// Ensure Alpine store is created
ensureAlpineStore();

Alpine.start();
```

### 2. Create Auth Store with Multiple Reactive Getters

```javascript
// auth.js
export function createAuthStore() {
    return {
        // Get user from Verity (reactive)
        get user() {
            const meRef = Alpine.store('lib').it('me', 'current');
            console.log('[Auth] user getter - meRef:', meRef, 'data:', meRef.data);
            return meRef.data;
        },

        // Get loading state from Verity (reactive)
        get isLoadingAuth() {
            const meRef = Alpine.store('lib').it('me', 'current');
            console.log('[Auth] isLoadingAuth getter - isLoading:', meRef.meta.isLoading);
            return meRef.meta.isLoading;
        },

        // Computed from Verity data (reactive)
        get isLoggedIn() {
            const user = this.user;  // Triggers user getter
            console.log('[Auth] isLoggedIn getter - user:', user, 'has id:', user && user.id);
            return user && user.id;
        }
    };
}

// Register the store
Alpine.store('auth', createAuthStore());
```

### 3. Use in HTML Template

```html
<body x-data="{ sidebarOpen: false, me: $store.lib.it('me', 'current') }">
    <!-- Show loading state -->
    <div x-show="$store.auth.isLoadingAuth">
        Loading...
    </div>

    <!-- Show login when not authenticated -->
    <div x-show="!$store.auth.isLoadingAuth && !$store.auth.isLoggedIn">
        <h1>Please log in</h1>
    </div>

    <!-- Show main content when authenticated -->
    <main x-show="!$store.auth.isLoadingAuth && $store.auth.isLoggedIn">
        <h1>Welcome, <span x-text="$store.auth.user?.name"></span>!</h1>
    </main>
</body>
```

## Expected Behavior

After `/api/me` returns successfully with user data:
- ✅ `meRef.data` should contain the user object
- ✅ `meRef.meta.isLoading` should be `false`
- ✅ UI should transition from loading → authenticated content

## Actual Behavior

### Console Output:

```
[Verity] Fetching me, id: current
[Auth] user getter - meRef: {data: null, meta: {…}} data: null
[Auth] isLoadingAuth getter - isLoading: true
[Auth] isLoggedIn getter - user: null has id: null

// After successful fetch:
[Verity] /api/me response status: 200
[Verity] /api/me returned data: {email: 'user@example.com', id: '123...', name: 'User', ...}

// Data is present but isLoading is still true!
[Auth] user getter - meRef: {data: {…}, meta: {…}} data: {email: 'user@example.com', ...}
[Auth] isLoadingAuth getter - isLoading: true  // ⚠️ Still true!
[Auth] isLoggedIn getter - user: Proxy(Object) {...} has id: 123...
```

### What Happens:

- ✅ `meRef.data` contains the user object (correct)
- ❌ `meRef.meta.isLoading` remains `true` (incorrect)
- ❌ UI stays stuck on "Loading..." screen

## Root Cause Analysis

Looking at `finalizeItemMeta` in `verity-dl/verity/shared/static/lib/core.js` (lines 1055-1058):

```javascript
function finalizeItemMeta(ref, canonicalLevel, qid, overrides = {}, { force = false } = {}) {
    const meta = ref.meta || {};
    const nextActive = clearActiveLevelQueryId(meta, canonicalLevel, qid, { force });
    const prevActiveQueryId = meta.activeQueryId ?? null;
    const matchedActiveQuery = force || (prevActiveQueryId !== null && prevActiveQueryId === qid);
    const nextActiveQueryId = matchedActiveQuery ? null : prevActiveQueryId;

    const next = {
        ...meta,
        ...overrides,
        activeLevelQueryIds: nextActive,
        activeQueryId: Object.prototype.hasOwnProperty.call(overrides, "activeQueryId")
            ? overrides.activeQueryId
            : nextActiveQueryId,
    };

    // ⚠️ Problem is here:
    if (!Object.prototype.hasOwnProperty.call(overrides, "isLoading")) {
        if (matchedActiveQuery || next.activeQueryId == null) {
            next.isLoading = false;  // Only set to false under specific conditions
        }
    }

    return next;
}
```

### The Issue:

When multiple reactive getters call `.it('me', 'current')`:

1. **First getter** calls `.it()` → starts fetch, sets `isLoading: true`
2. **Second getter** calls `.it()` → coalesces to same fetch (correct behavior)
3. **Third getter** calls `.it()` → coalesces to same fetch (correct behavior)
4. Fetch completes successfully, `data` is populated
5. `finalizeItemMeta` is called, but `isLoading` only becomes `false` if:
   - Query ID matches the active query ID, **OR**
   - `activeQueryId` is `null`
6. With multiple coalesced requests, the conditions may not be met
7. `isLoading` stays `true` even though `data` is present

## Workaround

We currently work around this by checking if data exists:

```javascript
get isLoadingAuth() {
    const meRef = Alpine.store('lib').it('me', 'current');
    // Only consider loading if no data AND isLoading is true
    return !meRef.data && meRef.meta.isLoading;
}
```

This works but shouldn't be necessary.

## Expected Fix

After a successful fetch completes and `data` is populated:
- `meta.isLoading` **must** be `false`
- This should be true **regardless** of:
  - How many times `.it()` was called during the fetch
  - Whether the calls were coalesced
  - What the query IDs are
- The presence of non-null `data` should be a **strong signal** that loading is complete

## Suggested Solutions

### Option 1: Always Set isLoading to False When Data is Present

```javascript
function finalizeItemMeta(ref, canonicalLevel, qid, overrides = {}, { force = false } = {}) {
    // ... existing code ...
    
    if (!Object.prototype.hasOwnProperty.call(overrides, "isLoading")) {
        // If we have data, we're definitely not loading
        if (ref.data != null) {
            next.isLoading = false;
        } else if (matchedActiveQuery || next.activeQueryId == null) {
            next.isLoading = false;
        }
    }
    
    return next;
}
```

### Option 2: Clear isLoading When applyFetchedLevel Sets Data

In `applyFetchedLevel`, explicitly set `isLoading: false` when data is successfully applied:

```javascript
function applyFetchedLevel(T, typeName, id, ref, sourceLevelKey, data, timestamp, qid = null, options = {}) {
    // ... existing code that sets ref.data ...
    
    const nextMeta = finalizeItemMeta(ref, sourceLevelKey, qid, {
        lastFetchedAny: timestamp,
        isLoading: false,  // Explicitly set to false on success
        // ... other overrides
    });
    
    assignRef(ref, { data: nextData, meta: nextMeta });
}
```

### Option 3: Document This as Expected Behavior

If this is intentional behavior, please document:
- Why `isLoading` can be `true` even when `data` is present
- What the recommended pattern is for reactive frameworks
- Whether checking `!data && isLoading` is the correct approach

## Impact

This affects any reactive framework integration where:
- Multiple computed properties/getters access the same Verity item
- The UI needs to show loading states based on `meta.isLoading`
- Coalescing is happening (which is the expected behavior)

**Frameworks affected:**
- ✅ Alpine.js (confirmed)
- ⚠️ React (likely - with `useItem` hook)
- ⚠️ Vue (likely - with computed properties)
- ⚠️ Svelte (likely - with reactive declarations)

## Questions for Maintainers

1. **Is this a bug or intended behavior?**
   - If bug: Which fix approach is preferred?
   - If intended: Why would `isLoading` be true when `data` exists?

2. **Is the pattern of multiple `.it()` calls an anti-pattern?**
   - Should we cache the reference instead of calling `.it()` multiple times?
   - Is there a recommended pattern for reactive frameworks?

3. **Should `isLoading` be `false` when `data` is non-null?**
   - This seems like a reasonable expectation
   - Would this break any existing behavior?

## Additional Notes

- This was discovered during a fresh integration of Verity 1.0.7
- The workaround (`!meRef.data && meRef.meta.isLoading`) is functional but feels wrong
- The data layer otherwise works perfectly - fetching, caching, and directives all work correctly
- This only affects the `isLoading` flag, not the actual data fetching/caching

## Test Case

A test case that should pass:

```javascript
test('isLoading should be false when data is present', async () => {
    // Register test type
    createType('test', {
        fetch: async (id) => ({ id, name: 'Test' }),
        stalenessMs: 60_000
    });
    
    // Access item multiple times (simulating reactive getters)
    const ref1 = Alpine.store('lib').it('test', '123');
    const ref2 = Alpine.store('lib').it('test', '123');
    const ref3 = Alpine.store('lib').it('test', '123');
    
    // Wait for fetch to complete
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // All references should have data
    expect(ref1.data).toEqual({ id: '123', name: 'Test' });
    expect(ref2.data).toEqual({ id: '123', name: 'Test' });
    expect(ref3.data).toEqual({ id: '123', name: 'Test' });
    
    // All references should NOT be loading
    expect(ref1.meta.isLoading).toBe(false);  // ❌ Currently fails
    expect(ref2.meta.isLoading).toBe(false);  // ❌ Currently fails  
    expect(ref3.meta.isLoading).toBe(false);  // ❌ Currently fails
});
```

---

**Would appreciate any guidance on:**
- Whether this is expected behavior
- The correct pattern for reactive frameworks
- If a fix is planned, what the timeline might be

Thank you for this excellent library! Despite this issue, Verity has been a pleasure to work with.
