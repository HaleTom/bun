# Nested Overrides and Resolutions Design

## Summary

Bun currently supports global package overrides and resolutions through a flat `OverrideMap` keyed by overridden package name. This design adds support for parent-scoped nested overrides and resolutions by making override lookup aware of the package that owns the dependency being resolved.

The recommended implementation is to thread parent package context through dependency enqueue and resolution paths, then extend `OverrideMap` to store both global and parent-scoped replacement rules.

## Goals

- Support npm-style one-level nested overrides:

```json
{
  "overrides": {
    "bar": {
      "foo": "1.0.0"
    }
  }
}
```

- Support Yarn-style one-level path resolutions:

```json
{
  "resolutions": {
    "bar/foo": "1.0.0"
  }
}
```

- Preserve existing global override behavior:

```json
{
  "overrides": {
    "foo": "1.2.3"
  }
}
```

- Apply scoped overrides only when the requested dependency belongs to the matching parent package.
- Prefer scoped overrides over global overrides when both match.
- Keep the implementation limited to immediate parent-child relationships for the initial change.

## Non-Goals

- Do not implement arbitrary-depth ancestry matching in the initial change.
- Do not implement full Yarn glob semantics for resolutions.
- Do not add a persistent `DependencyID -> PackageID` reverse lookup buffer unless parent threading proves insufficient.
- Do not change override behavior for workspace-only dependencies or aliased direct `npm:` dependencies except where current global overrides already apply.

## Current Behavior

`src/install/lockfile/OverrideMap.zig` stores overrides as:

```zig
map: std.ArrayHashMapUnmanaged(PackageNameHash, Dependency, ArrayIdentityContext.U64, false)
```

The only lookup is effectively:

```zig
OverrideMap.get(name_hash) ?Dependency.Version
```

`src/install/PackageManager/PackageManagerEnqueue.zig` calls this during dependency resolution:

```zig
if (this.lockfile.overrides.get(name_hash)) |new| {
    ...
}
```

This means Bun can answer:

```text
Should all foo dependencies resolve to X?
```

But it cannot answer:

```text
Should foo resolve to X only when requested by bar?
```

## Recommended Architecture

Represent override rules as a combination of global and parent-scoped entries.

Conceptually:

```text
OverrideRules
├─ global: child package name -> replacement dependency
└─ scoped: (parent package name, child package name) -> replacement dependency
```

Lookup should receive the requested package and the parent package identity:

```zig
pub fn get(
    this: *const OverrideMap,
    lockfile: *const Lockfile,
    name_hash: PackageNameHash,
    parent_package_id: ?PackageID,
) ?Dependency.Version
```

Lookup precedence:

1. If `parent_package_id` is present, check for a scoped override matching `(parent_package_name_hash, name_hash)`.
2. If no scoped override matches, check for a global override matching `name_hash`.
3. If neither matches, return `null`.

## Data Model

Two-map design:

```zig
global: ArrayHashMapUnmanaged(PackageNameHash, Dependency, ...),
scoped: ArrayHashMapUnmanaged(ScopedOverrideKey, Dependency, ...),
```

Where:

```zig
const ScopedOverrideKey = struct {
    parent_name_hash: PackageNameHash,
    child_name_hash: PackageNameHash,
};
```

The two-map design is simpler than a union-valued map because global and scoped lookups have different keys and different serialization needs.

## Parent Context Flow

The critical implementation change is preserving the package that owns each dependency list.

Current flow loses ownership in some places:

```zig
this.enqueueDependencyList(this.lockfile.packages.items(.dependencies)[id]);
lockfile.scratch.dependency_list_queue.writeItem(result.package.dependencies);
```

The dependency slice identifies the dependencies, but not the package that owns them.

Introduce an owner-aware queue item:

```zig
const DependencyListWithOwner = struct {
    package_id: PackageID,
    dependencies: Lockfile.DependencySlice,
};
```

Then update dependency-list enqueueing so parent package context is preserved:

```zig
enqueueDependencyList(package_id, package.dependencies)
```

and eventually passed into the resolver:

```zig
enqueueDependencyWithMain(
    dependency_id,
    &dependency,
    resolution,
    install_peer,
    parent_package_id,
)
```

Root dependencies should pass `null` or the root package id, depending on existing root package modeling. Scoped overrides should not accidentally treat root dependencies as children of a package named like the project unless that behavior is explicitly intended.

## Parsing

### npm `overrides`

Existing accepted form:

```json
{
  "overrides": {
    "foo": "1.2.3",
    "foo": {
      ".": "1.2.3"
    }
  }
}
```

New one-level scoped form:

```json
{
  "overrides": {
    "bar": {
      "foo": "1.0.0"
    }
  }
}
```

If an object contains `"."`, that should continue to mean a replacement for the object key package itself. Other string-valued properties in the same object should become scoped child overrides.

Example:

```json
{
  "overrides": {
    "bar": {
      ".": "2.0.0",
      "foo": "1.0.0"
    }
  }
}
```

This means:

```text
bar -> 2.0.0 globally
foo -> 1.0.0 when requested by bar
```

For the initial version, nested object values deeper than one level should still warn or error as unsupported.

### Yarn `resolutions`

Existing accepted form:

```json
{
  "resolutions": {
    "foo": "1.2.3",
    "**/foo": "1.2.3"
  }
}
```

New one-level scoped form:

```json
{
  "resolutions": {
    "bar/foo": "1.0.0"
  }
}
```

Scoped package parsing must distinguish package scopes from path separators:

```text
@scope/parent/child      parent = @scope/parent, child = child
parent/@scope/child      parent = parent, child = @scope/child
@p/parent/@c/child       parent = @p/parent, child = @c/child
```

The parser should reject ambiguous or deeper paths for the initial change.

## Serialization

Both binary and text lockfile serialization must preserve global and scoped rules.

Recommended lockfile text shape:

```json
"overrides": {
  "foo": "1.2.3",
  "bar/foo": "1.0.0"
}
```

This keeps `bun.lock` compact and avoids introducing nested lockfile objects solely for metadata. The parser can reconstruct scoped entries from slash-delimited keys.

Binary lockfile serialization should either:

- Add a new scoped-overrides section/tag while retaining the existing global overrides tag.
- Or version the overrides section so old flat override data remains readable.

Do not change the meaning of existing serialized global overrides.

## Comparison and Cloning

Update all `OverrideMap` operations to include scoped entries:

- `count`
- `clone`
- `sort`
- `deinit`
- lockfile summary comparison for `overrides_changed`
- text lockfile printer
- binary lockfile reader/writer

Sorting should produce deterministic output by parent package name, then child package name.

## Approach Comparison

| Approach | Pros | Cons | Decision |
|---|---|---|---|
| Thread parent context through enqueue | Uses information already available when walking package dependencies; avoids extra lockfile index; keeps behavior local to dependency resolution | Requires changing enqueue signatures and queue item shapes | Recommended |
| Add `DependencyID -> PackageID` reverse buffer | Lets lookup recover parent from dependency id anywhere | Adds broader state, clone/serialization complexity, and staleness risk | Avoid initially |
| Store parent context only on enqueued task item | Clean runtime queue model | Still requires call-site updates and can become fragmented if not paired with API changes | Use as part of parent threading |
| Encode scoped overrides as flat string keys only | Simple serialization | Lookup still needs parent context; scoped package names make parsing fragile | Fine for lockfile text, not enough as runtime model |
| Full ancestry/path matching | More Yarn-compatible | Higher complexity and requires full dependency ancestry | Defer |

## Risks

- Parent context can be lost in asynchronous queues if any dependency-list path continues to store only `DependencySlice`.
- Scoped package names make slash parsing easy to get wrong.
- A package can be resolved once but requested by multiple parents with different scoped overrides; cache keys and package identity must include the resulting resolved version, not just the child name.
- Global and scoped overrides may interact with aliases and catalogs. Existing alias and catalog behavior should be preserved unless tests define a deliberate change.
- Lockfile diffing must include scoped rules or installs may fail to detect override changes.

## Testing Strategy

Add tests to existing package manager override/resolution test coverage rather than creating a new unrelated test file.

Required cases:

- Global override behavior remains unchanged.
- npm nested override applies only under the matching parent.
- npm nested override does not apply under a different parent.
- npm object with `"."` and child override handles both rules.
- Yarn `parent/child` resolution applies only under matching parent.
- Scoped package path parsing works for parent and child scoped names.
- Unsupported deeper nesting produces the expected warning or error.
- Lockfile output is deterministic.
- Reinstall from lockfile preserves scoped override behavior.
