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

Install in Stremio: Addons, paste a manifest URL, Install. Both Worker URLs serve identical
code, so either works.

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

Pushing to `main` deploys automatically through two independent paths:

| Worker | Deployed by | Target set by |
| --- | --- | --- |
| `tamilmv-addon` | GitHub Actions, `.github/workflows/deploy.yml` | top-level `name` in `wrangler.jsonc` |
| `tamilmv-addon-v2` | Cloudflare Git build | `env.v2.name`, via `wrangler deploy --env v2` |

The two paths target different scripts, so they do not overwrite each other. The GitHub Action
requires `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.

The Cloudflare build for `tamilmv-addon-v2` must keep its deploy command set to:

```
npx wrangler deploy --env v2
```

Without `--env v2` that build falls back to the top-level `name`, deploys to `tamilmv-addon`
instead, overwrites it, and leaves `tamilmv-addon-v2` stale.

`observability` is enabled, so the `console.error` diagnostics in `worker.js` (failed fetches,
titles that fail to parse, Cinemeta lookup failures) appear under the Worker's Logs tab.

## Layout

```
worker.js                       the entire addon
wrangler.jsonc                  Worker config, both deploy targets
.github/workflows/deploy.yml    deploy on push to main
```
