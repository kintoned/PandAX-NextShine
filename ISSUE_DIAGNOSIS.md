# PandAX NextShine Issue Diagnosis

## Issue Description
When a user clicks the "Proceed" (進める) button on an assignment submission page, they are sometimes redirected back to the assignment list screen instead of proceeding to the confirmation or submission success screen.

## Root Cause Analysis
The issue is caused by the extension's background assignment scanning mechanism, which interferes with the server-side session state of the PandA (Sakai) system.

### Detailed Mechanism:
1. **Background Scanning**: When the extension loads (on any PandA page), it initializes `PandAExtension` and calls `startFetching()` in `content.js`.
2. **Course Iteration**: `startFetching()` iterates through all courses found in the navigation bar (`getCourses()`).
3. **Fetching Assignment Tool**: For each course, it calls `processCourse(course)`.
   - Inside `processCourse`, the extension fetches the Course Home page (`fetchDocument(course.url)`).
   - It then identifies the "Assignments" (課題) tool link (`assignmentToolUrl`).
   - It proceeds to fetch this URL (`fetchDocument(assignmentToolUrl)`) to scrape assignment deadlines and statuses.
4. **State Interference**:
   - In Sakai (the software powering PandA), navigating to a tool's main URL (like the "Assignments" link in the sidebar) typically resets the tool's state to its default view (the assignment list).
   - Since the extension uses `fetch()`, these requests share the user's browser session (cookies).
   - If `startFetching()` fetches the "Assignments" tool URL for the *current* course while the user is actively working on a submission (which is a specific state within the Assignments tool), the server-side session state for that tool is reset to the "List" view.
5. **Race Condition**:
   - If this background fetch completes just before or while the user clicks "Proceed", the server processes the "Proceed" request in the context of the "List" view (or invalidates the submission context).
   - Consequently, the system defaults to showing the assignment list, effectively discarding the user's attempt to proceed.

The intermittent nature of the bug ("sometimes") is due to the race condition between the background scraping process and the user's interaction.

## Conclusion
The extension's feature to show upcoming assignments in the sidebar is inadvertently resetting the user's session state for the current course's assignment tool, leading to navigation errors during submission.
