# Linguistic

Automatically translates Minecraft `.lang` files into any of the 29 supported Minecraft locales.

The filter also handles caching to speed up the process and mitigate redundant API calls as much as possible.

## Getting the Filter

Install with: `regolith install linguistic` or add the entry to your `filterDefinitions`:

```json
"linguistic": {
  "url": "github.com/r4isen1920/regolith-filters",
  "version": "1.0.0"
}
```

Then define it in your profile:

```json
{
	"filter": "linguistic"
}
```

## Settings

```json
{
	"target": {
		"from": "en_US",
		"to": ["de_DE", "fr_FR", "ja_JP"]
	},
	"model": {
		"id": "google"
	}
}
```

All settings are optional and fall back to their defaults when omitted.

---

### `target`

Controls which locale to translate **from** and **to**.

| Field  | Type       | Default                                                                     | Description                                                                         |
| ------ | ---------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `from` | `string`   | `"en_US"`                                                                   | The source locale. Must have a matching `.lang` file in the pack's `texts/` folder. |
| `to`   | `string[]` | `"de_DE"`, `"es_ES"`, `"es_MX"`, `"fr_FR"`, `"ja_JP"`, `"pt_BR"`, `"zh_CN"` | Target locales to translate into. The source locale is automatically excluded.      |

---

### `model`

Selects the translation engine. `id` is required; `key` is only required for LLM providers.

| Field | Type     | Description                                                                                                               |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `id`  | `string` | Engine / model identifier.                                                                                                |
| `key` | `string` | API key for the selected provider. **Optional** for `"google"` (free, no key needed). **Required** for all LLM providers. |

Setting `id` to `"google"` uses **Google Translate** -- no API key required, and the most predictable for Minecraft-style strings.

To potentially improve translation quality, you may otherwise use a dedicated LLM/AI model, provided you have your own API key.

**SINCE YOUR API KEY IS DEFINED IN `config.json`, REMEMBER TO REMOVE IT BEFORE COMITTING**

---

### `batch`

Controls translation batching behaviour.

| Field   | Type      | Default | Description                                                                                        |
| ------- | --------- | ------- | -------------------------------------------------------------------------------------------------- |
| `size`  | `integer` | `0`     | Number of items per translation batch. `0` uses the provider default (10 for google, 50 for LLMs). |
| `delay` | `integer` | `3000`  | Delay in milliseconds between consecutive batches.                                                 |

---

## Supported Locales

| Code    | Language              | Code    | Language           |
| ------- | --------------------- | ------- | ------------------ |
| `en_US` | English (US)          | `nl_NL` | Dutch              |
| `en_GB` | English (UK)          | `bg_BG` | Bulgarian          |
| `de_DE` | German                | `cs_CZ` | Czech              |
| `es_ES` | Spanish (Spain)       | `da_DK` | Danish             |
| `es_MX` | Spanish (Mexico)      | `el_GR` | Greek              |
| `fr_FR` | French (France)       | `fi_FI` | Finnish            |
| `fr_CA` | French (Canada)       | `hu_HU` | Hungarian          |
| `it_IT` | Italian               | `id_ID` | Indonesian         |
| `ja_JP` | Japanese              | `nb_NO` | Norwegian (Bokmål) |
| `ko_KR` | Korean                | `pl_PL` | Polish             |
| `pt_BR` | Portuguese (Brazil)   | `sk_SK` | Slovak             |
| `pt_PT` | Portuguese (Portugal) | `sv_SE` | Swedish            |
| `ru_RU` | Russian               | `tr_TR` | Turkish            |
| `zh_CN` | Chinese (Simplified)  | `uk_UA` | Ukrainian          |
| `zh_TW` | Chinese (Traditional) |         |                    |

---

## .lang File Handling

Linguistic handles the following nicely:

| Feature                                       | Behaviour                                                                                                                    |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `##` full-line comments                       | Copied verbatim; never sent for translation. Comments immediately preceding an entry are passed as **context hints** to LLM. |
| `\t##` inline comments                        | Preserved verbatim after the translated value.                                                                               |
| Blank lines                                   | Preserved in their original positions.                                                                                       |
| `§x` color codes                              | Protected as numbered placeholders (`[0]`, `[1]`, ...) before translation, restored afterward.                               |
| Printf placeholders (`%s`, `%1$s`, `%d`, ...) | Preserved verbatim — translation engines are instructed not to alter them.                                                   |
| Line order                                    | Output file mirrors the exact structure of the source file.                                                                  |

---

## Changelog

### 1.0.0

Initial release.
