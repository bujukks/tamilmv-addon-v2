# TamilMV Addon

A Stremio catalog addon built as a single-file Cloudflare Worker. It reads the TamilMV forum
listing pages, matches each release title to an IMDb ID through Cinemeta, and serves the
results as Stremio movie catalogs. No dependencies and no build step.

Deployed as the `tamilmv-addon-v2` Worker.

## Endpoints

| URL | Purpose |
| --- | --- |
| `https://tamilmv-addon-v2.bujukks.workers.dev/manifest.json` | Stremio manifest |
| `https://tamilmv-addon-v2.bujukks.workers.dev/catalog/movie/<catalog-id>.json` | Catalog data |

Install in Stremio: Addons, paste the manifest URL, Install.

## Catalogs

Defined by `DEFAULT_SOURCES` in `worker.js`, in the order listed:

1. `tamilmv-top-releases-this-week`
2. `tamilmv-latest-webhd`
3. `tamilmv-hollywood-multi-audio`

Each entry is mapped to its IMDb ID and shows the release type, for example `2026 · BluRay`.
Release types are stripped of language names, so a `Tamil HQ HDRip` release displays as
`HQ HDRip`.

## Configuration

Both variables are optional. Set them under **Settings -> Variables and Secrets**.

| Name | Purpose |
| --- | --- |
| `SOURCE_URL` | Overrides the catalog list. Format: `Name\|URL` or `Name\|URL\|CSS selector`, separated by `;` or newlines. |
| `FALLBACK_DOMAINS` | Comma-separated front-door domains to retry if the primary domain redirects. |

If `SOURCE_URL` is unset, the built-in `DEFAULT_SOURCES` list is used.

> **Set these as Secrets, not as plaintext Variables.** A `wrangler deploy` makes the
> configuration file authoritative for plaintext variables, so anything added in the dashboard
> as an unencrypted Variable is silently deleted on the next deploy. Secrets are not affected.

Catalog IDs are derived from the names in `SOURCE_URL`, so renaming a catalog changes its ID
and existing Stremio installs will need to be re-added.

Dashboard edits do not persist. The Cloudflare Git build overwrites the Worker's script on
every push to `main`, so make changes in `worker.js` and push them.

## Deployment

Pushing to `main` triggers the Cloudflare Git build, which runs `wrangler deploy` using
`wrangler.jsonc`. That file names `tamilmv-addon-v2` as its target.

The build's deploy command must stay as plain `npx wrangler deploy`.

After each build, the log should read `Uploaded tamilmv-addon-v2`.

`observability` is enabled, so the `console.error` diagnostics in `worker.js` (failed fetches,
titles that fail to parse, Cinemeta lookup failures) appear under the Worker's Logs tab.

## Layout

```
worker.js         the entire addon
wrangler.jsonc    Worker config, targets tamilmv-addon-v2
```
