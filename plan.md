# MVP Delivery Plan

**Overall Progress:** `100%`

## Tasks:

- [x] 🟩 **Step 1: Complete streaming ingestion foundation**
  - [x] 🟩 Finalize parser batches with type inference
  - [x] 🟩 Persist row index checkpoints in OPFS
  - [x] 🟩 Render streamed data in the AG Grid shell

- [x] 🟩 **Step 2: Integrate filter engine into worker pipeline**
  - [x] 🟩 Expose filter state on worker API and store active expression
  - [x] 🟩 Apply predicate masks when emitting row batches
  - [x] 🟩 Return filtered row counts for status updates

- [x] 🟩 **Step 3: Implement multi-column sort pipeline**
  - [x] 🟩 Add typed comparator utilities and TimSort integration
  - [x] 🟩 Extend worker RPC to accept sort definitions
  - [x] 🟩 Stream sorted windows back to the grid

- [x] 🟩 **Step 4: Surface filter builder UI**
  - [x] 🟩 Create predicate builder panel with column/type metadata
  - [x] 🟩 Wire submit/reset actions to worker filter RPC
  - [x] 🟩 Reflect active filters and counts in status bar

- [x] 🟩 **Step 5: Add global search across visible columns**
  - [x] 🟩 Implement worker-side scan leveraging filter engine
  - [x] 🟩 Hook top-bar search input to trigger scoped queries
  - [x] 🟩 Display highlighted results and clear affordance

- [x] 🟩 **Step 6: Add grid context menu filter shortcuts**
  - [x] 🟩 Surface Filter in / Filter out on right-click targeting cell values
  - [x] 🟩 Reuse filter-sync pipeline so worker and UI stay consistent
  - [x] 🟩 Cover quick actions with regression tests

- [x] 🟩 **Step 7: Extend filter predicates with matches/not matches regex options**
  - [x] 🟩 Add new operators to filter builder UI and persistence pipeline
  - [x] 🟩 Update worker filter engine to support matches/not matches semantics
  - [x] 🟩 Document and test regex operators

- [x] 🟩 **Step 8: Default to case-insensitive filters/search with optional toggle**
  - [x] 🟩 Persist case sensitivity preference in session state and UI controls
  - [x] 🟩 Update worker filter/search logic to honour toggle
  - [x] 🟩 Document behaviour and cover with tests

- [x] 🟩 **Step 9: Introduce options panel with font selectors**
  - [x] 🟩 Add modal options surface to top bar
  - [x] 🟩 Persist interface/data font families and sizes with CSS variables
  - [x] 🟩 Document options workflow and exercise component tests
