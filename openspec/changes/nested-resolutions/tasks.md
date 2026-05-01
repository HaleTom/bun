## 1. OverrideMap Data Model

- [x] 1.1 Rename existing `map` field to `global` in `OverrideMap`
- [x] 1.2 Add `ScopedOverrideKey` struct (parent_name_hash, child_name_hash)
- [x] 1.3 Add `ScopedOverrideContext` hash/eql implementation
- [x] 1.4 Add `scoped` map field alongside `global`
- [x] 1.5 Rename all `this.map` references to `this.global` throughout OverrideMap.zig

## 2. Parent-Aware `get()` Lookup

- [x] 2.1 Update `get()` signature to accept `lockfile: *const Lockfile`, `name_hash`, `parent_package_id: ?PackageID`
- [x] 2.2 Implement scoped lookup: check `scoped` map using `(parent_name_hash, child_name_hash)` before global
- [x] 2.3 Update debug log to show scoped vs global resolution
- [x] 2.4 Remove the old comment about DependencyID -> PackageID reverse lookup

## 3. Thread Parent Context Through Enqueue API

- [x] 3.1 Add `parent_package_id: ?PackageID` parameter to `enqueueDependencyList()`
- [x] 3.2 Add `parent_package_id: ?PackageID` parameter to `enqueueDependencyWithMain()`
- [x] 3.3 Add `parent_package_id: ?PackageID` parameter to `enqueueDependencyWithMainAndSuccessFn()`
- [x] 3.4 Update all `enqueueDependencyWithMain()` call sites to pass the owning package's ID
- [x] 3.5 Update `OverrideMap.get()` call site in enqueue to pass `parent_package_id`

## 4. Owner-Aware DependencyQueue

- [x] 4.1 Add `DependencyListWithOwner` struct: `{ package_id: PackageID, dependencies: DependencySlice }`
- [x] 4.2 Change `Scratch.DependencyQueue` from `LinearFifo(DependencySlice, .Dynamic)` to `LinearFifo(DependencyListWithOwner, .Dynamic)`
- [x] 4.3 Update `processDependencyList.zig` write sites to include `package_id`
- [x] 4.4 Update `PackageManagerEnqueue.zig` write sites to include `package_id`
- [x] 4.5 Update `doFlushDependencyQueue()` in `runTasks.zig` to read owner-aware queue items and pass `parent_package_id` to `enqueueDependencyWithMain()`
- [x] 4.6 Update root-level enqueue in `install_with_manager.zig` to pass `null` parent

## 5. Parse npm Nested Overrides

- [x] 5.1 Update `parseCount` to count both global and scoped override entries
- [x] 5.2 Update `parseFromOverrides` to handle: `{ "bar": "1.0.0" }` → global, `{ "bar": { "foo": "1.0.0" } }` → scoped
- [x] 5.3 Handle `"."` property inside nested object as global override for the parent package
- [x] 5.4 Handle remaining string properties in nested object as scoped child overrides
- [x] 5.5 Add warning for deeper-than-one nesting
- [x] 5.6 Update debug log to show global + scoped count
- [x] 5.7 Update `parseAppend` to write both `global` and `scoped` map entries

## 6. Parse Yarn Nested Resolutions

- [x] 6.1 Update `parseFromResolutions` to handle `parent/child` path keys as scoped overrides
- [x] 6.2 Support scoped packages: `@scope/parent/child` → parent = `@scope/parent`, child = `child`
- [x] 6.3 Reject keys with more than one slash (deeper nesting) with a warning
- [x] 6.4 Update `parseCount` for Yarn nested resolution counting

## 7. OverrideMap Operations

- [x] 7.1 Update `sort()` to sort both `global` and `scoped` maps with deterministic output
- [x] 7.2 Update `count()` to count strings from both `global` and `scoped` override entries
- [x] 7.3 Update `clone()` to clone both `global` and `scoped` maps into a new `OverrideMap`
- [x] 7.4 Update `deinit()` to deinitialize both `global` and `scoped` maps

## 8. OverrideMap Binary Serialization

- [x] 8.1 Add new binary tag constant for scoped overrides section
- [x] 8.2 Update binary writer to write scoped overrides: parallel arrays of parent hashes, child hashes, and dependency externals
- [x] 8.3 Update binary reader to read scoped overrides section and populate `scoped` map
- [x] 8.4 Ensure global overrides binary format remains backwards-compatible
- [x] 8.5 Update binary writer to use `scoped.count() > 0` guard

## 9. OverrideMap Text Serialization

- [x] 9.1 Update text writer to write scoped overrides as `"parent/child": "version"` entries
- [x] 9.2 Update text reader to detect slash in override key and split into parent + child
- [x] 9.3 Handle scoped package parsing in text reader: `@scope/parent/child`
- [x] 9.4 Update text reader to store global overrides in `global` map, scoped in `scoped` map
- [x] 9.5 Update `overrides_changed` comparison in `Package.zig` to compare both `global` and `scoped` maps

## 10. Update Remaining `overrides.map` References

- [x] 10.1 Search for any remaining `.overrides.map` references in install/PackageManager code
- [x] 10.2 Update all found references to use `.overrides.global`

## 11. Integration Tests

- [ ] 11.1 Add test: global override behavior remains unchanged
- [ ] 11.2 Add test: npm nested override applies only under matching parent
- [ ] 11.3 Add test: npm nested override does not apply under different parent
- [ ] 11.4 Add test: npm nested override with `"."` and child override handles both
- [ ] 11.5 Add test: Yarn-style `parent/child` resolution applies only under matching parent
- [ ] 11.6 Add test: Yarn-style resolution with scoped parent package (`@scope/parent/child`)
- [ ] 11.7 Add test: deeper-than-one nesting produces warning
- [ ] 11.8 Verify tests fail with current build (before implementation)
- [ ] 11.9 Verify tests pass after all implementation tasks complete