# Meta Gen

This filter generates a `.d.ts` file that contains constants that define the current version of your pack.

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
import Meta from "./Meta.d.ts";

console.warn(
  `Scripts loaded! v${Meta.manifest.bp.version}, commit ID: ${Meta.github.commit}`,
);
```

## Settings

```json
{
  "outputFile": "Meta.d.ts"
}
```

### outputFile

The output file to write the generated `.d.ts` file to. Defaults to `Meta.d.ts`.

## Changelog

### 1.0.0

The first release of Meta Gen.
