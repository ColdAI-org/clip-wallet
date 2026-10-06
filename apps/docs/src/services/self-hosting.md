# Self-host on Cloudflare

Each service is a Worker with its own `wrangler.jsonc`, deployed with [wrangler](https://developers.cloudflare.com/workers/wrangler/)
(the repo pins wrangler 4.124.0 in each service's dev dependencies). Run every command from the service's folder, so
wrangler picks up its config.

::: warning Use your own resources
The `wrangler.jsonc` files in the repo name the maintainers' own resources (a D1 database id, worker URLs). Change them
to yours before you deploy. Never commit secrets: they go in with `wrangler secret put`, which prompts for the value.
:::

## Once per Cloudflare account

```sh
npx wrangler login
```

## Media proxy

No storage, no secrets.

```sh
cd services/media-proxy
npx wrangler deploy
```

In `wrangler.jsonc`: `IPFS_GATEWAY` (default Filebase's public gateway; use a dedicated one before real traffic) and
`ARWEAVE_GATEWAY`, and a `namespace_id` for the `MEDIA_LIMITER` rate limit that is unique in your account.

## Link relay

One Durable Object class, no secrets.

```sh
cd services/link-relay
npx wrangler deploy
```

## Backup

D1 for accounts, sessions and sync records; R2 for the encrypted blobs.

```sh
cd services/backup
npx wrangler d1 create clip-backup-db                # put the id it prints in wrangler.jsonc
npx wrangler r2 bucket create clip-backup-blobs
npx wrangler d1 migrations apply clip-backup-db --remote
openssl rand -base64 32 | npx wrangler secret put EMAIL_PEPPER
npx wrangler deploy
```

Then set the variables in `wrangler.jsonc` and deploy again:

| Variable | |
| --- | --- |
| `PUBLIC_URL` | this Worker's own URL; the sign-in redirect URI is `PUBLIC_URL` + `/v1/auth/oidc/callback` |
| `APP_URL` | the page an emailed sign-in link opens (the wallet reads the token from the URL fragment) |
| `ALLOWED_ORIGINS` | browser origins allowed to call the API, comma-separated (the extension's background isn't subject to CORS) |
| `EMAIL_FROM` | the sender for sign-in links, on a domain verified with your email provider |
| `OIDC_RETURN_URLS` | exact wallet URLs the social sign-in may return to, such as `https://<extension id>.chromiumapp.org/backup` |
| `GOOGLE_CLIENT_ID`, `APPLE_CLIENT_ID` | each provider's public client id (Apple: the Services ID) |

## Secrets

Secrets are set with `npx wrangler secret put <NAME>` and never appear in the repo or in logs. Each feature stays off,
and says so, until its secret is set.

| Service | Secret | Needed for |
| --- | --- | --- |
| backup | `EMAIL_PEPPER` | always: accounts are keyed by an HMAC of the email or provider id under it |
| backup | `RESEND_API_KEY` | email sign-in (with `EMAIL_FROM`) |
| backup | `GOOGLE_CLIENT_SECRET` | Google sign-in (with `GOOGLE_CLIENT_ID`) |
| backup | `APPLE_CLIENT_SECRET` | Apple sign-in (with `APPLE_CLIENT_ID`): an ES256 JWT you mint with `services/backup/scripts/apple-client-secret.mjs`, valid at most six months |
| media-proxy | none | |
| link-relay | none | |

Rotating `EMAIL_PEPPER` orphans every existing account (people sign in again and re-upload; blobs stay undecryptable
without their passkey either way), so rotate it only on suspected compromise.

## Check it

```sh
curl -s https://<your backup worker>/v1/health        # {"ok":true,"emailSignIn":false,"sync":true}
curl -s https://<your relay worker>/v1/health
```

## Redeploy and tear down

`npx wrangler deploy` again keeps the secrets; variables come from `wrangler.jsonc`, so change them there rather than in
the dashboard. Apply new D1 migrations before deploying new backup code.

To tear down, point your wallet away from the URLs first, then `npx wrangler delete <worker name>`. Deleting the D1
database and the R2 bucket is permanent: export first (`npx wrangler d1 export … --remote --output backup.sql`).
