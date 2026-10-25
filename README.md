# TamilMV Addon

A Stremio catalog addon built as a single-file Cloudflare Worker. It reads the TamilMV forum
listing pages, matches each release title to an IMDb ID through Cinemeta, and serves the
results as Stremio movie catalogs. No dependencies and no build step.

## Endpoints

| URL | Purpose |
| --- | --- |
| `https://tamilmv-addon.bujukks.workers.dev/manifest.json` | Stremio manifest |
| `https://tamilmv-addon.bujukks.workers.dev/catalog/movie/<catalog-id>.json` | Catalog data |
| `https://tamilmv-addon-v2.bujukks.workers.dev/` | Same addon, second Worker |

Install in Stremio: Addons, paste a manifest URL, Install. The two Workers are deployed
independently and can drift apart, so pick one and stay with it.

## Catalogs

Defined by `DEFAULT_SOURCES` in `worker.js`, in the order listed:

1. `tamilmv-top-releases-this-week`
2. `tamilmv-latest-webhd`
3. `tamilmv-hollywood-multi-audio`

Each entry is mapped to its IMDb ID and shows the release type, for example `2026 · BluRay`.
Release types are stripped of language names, so a `Tamil HQ HDRip` release displays as
`HQ HDRip`.

## Configuration

Both variables are optional. Set them per Worker under **Settings -> Variables and Secrets**.

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

## Deployment

The two Workers are deployed by completely separate mechanisms.

| Worker | Deployed by | Edited in |
| --- | --- | --- |
| `tamilmv-addon` | nothing in this repository | Cloudflare dashboard |
| `tamilmv-addon-v2` | Cloudflare Git build on push to `main` | this repository |

Only `tamilmv-addon-v2` is connected to this repository. Pushing to `main` triggers its
Cloudflare Git build, which runs `wrangler deploy` from `wrangler.jsonc`. That file names
`tamilmv-addon-v2` as its only target, so no deploy from this repository can reach the
standalone Worker.

The Cloudflare build's deploy command must stay as plain `npx wrangler deploy`. Adding
`--env v2` fails the build, because no environment of that name is defined any more.

`tamilmv-addon` is deliberately not connected to this repository. Its script lives in
Cloudflare and is edited in the dashboard, so no push can deploy to or overwrite it.

The invariant to preserve after every build: the build log must read
`Uploaded tamilmv-addon-v2`. If it reads `Uploaded tamilmv-addon`, the build is targeting the
standalone Worker instead, which would overwrite it and leave `tamilmv-addon-v2` stale.

`observability` is enabled, so the `console.error` diagnostics in `worker.js` (failed fetches,
titles that fail to parse, Cinemeta lookup failures) appear under the Worker's Logs tab.

## Layout

```
worker.js         the entire addon
wrangler.jsonc    Worker config, targets tamilmv-addon-v2
```
