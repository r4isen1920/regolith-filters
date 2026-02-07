# Meta Gen

This filter generates a `.ts` file that contains constants that define the current version of your pack.

**Requires the [gametests](https://github.com/Bedrock-OSS/regolith-filters/tree/master/gametests) filter to be installed.**

## Data

- `manifest` - gets data locally from your `manifest.json`
  - `bp`|`rp` - behavior pack or resource pack data
    - `version`
    - `min_engine_version`
- `github` - retrieves data from the current repository, if it exists
  - `commit` - the latest ID of commit pushed
  - `tag` - the latest tag, if any

## Getting the Filter

Install with: `regolith install meta_gen`. Then, define it in your profile:

```json
{
  "filter": "meta_gen"
}
```

## Usage

The purpose of this pack is to ensure that the intended recipient has the correct version loaded into their game.

```ts
import Meta from "./Meta.ts";

console.warn(
  `Scripts loaded! v${Meta.manifest.bp.version}, commit ID: ${Meta.github.commit}`,
);
```

## Settings

```json
{
  "outputFile": "Meta.ts",
  "syncVersionFromTag": false
}
```

### outputFile

The output file to write the generated `.ts` file to. Defaults to `Meta.ts`.

### syncVersionFromTag

Whether to sync the manifest version from the latest git tag. When enabled, the filter will:

1. Read the latest git tag
2. Validate it follows semver format (`v1.0.0` or `1.0.0`)
3. If valid, update both `manifest.bp.version` and `manifest.rp.version` to match the tag version
4. Write the updated versions back to both BP and RP `manifest.json` files
5. If invalid or no tag exists, the git tag is ignored and manifest versions remain as-is

Defaults to `false`.

## Changelog

### 1.1.0

- Added optional boolean parameter for filter: `syncVersionFromTag`
- Added and updated docstrings to exports
- Removed declarations; renamed from `Meta.d.ts` to `Meta.ts`

### 1.0.0

The first release of Meta Gen.
