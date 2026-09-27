# VPS deployment

The GitHub Actions workflow publishes two immutable images to GHCR and deploys
them over SSH:

- `runner` is the small Next.js standalone application;
- `migrator` contains Prisma CLI and runs `scripts/db-sync.mjs` once before the
  application is replaced.

PostgreSQL is attached only to the internal `backend` network. The application
has no host port and is reachable by the existing Traefik container through its
external Docker network. The long-lived application process also runs the
two-hour crawler scheduler, so no host cron service is needed.

## 1. Prepare Ubuntu and the deployment user

Run as a sudo-capable administrator. If Docker Engine and the Compose plugin are
already installed, skip the repository and package installation commands.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME:-$VERSION_CODENAME} stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker

sudo useradd --create-home --shell /bin/bash synapth
sudo usermod -aG docker synapth
sudo install -d -o synapth -g synapth -m 0750 /opt/synapth
```

Membership in the `docker` group is effectively root access. A rootless Docker
installation can be used instead, but the existing Traefik instance must then
run in the same Docker context and share the same network.

Create the external network once and attach the existing Traefik service to it:

```bash
sudo -u synapth docker network inspect traefik-public >/dev/null 2>&1 \
  || sudo -u synapth docker network create traefik-public
```

Traefik must have a `websecure` entrypoint, a `cloudflare` certificate resolver,
and its Docker provider must be able to see this network. Different names can be
set through `TRAEFIK_NETWORK`, `TRAEFIK_ENTRYPOINT`, and
`TRAEFIK_CERTRESOLVER` in `/opt/synapth/.env`.

## 2. Configure DNS and firewall

Create an `A` record for `synapth.localhost8081.ru` pointing to the VPS. Add an
`AAAA` record only if IPv6 is configured on the host. Allow inbound TCP 80 and
443 for Traefik and the chosen SSH port. Do not open 3000 or 5432: Compose does
not publish either port.

## 3. Create the runtime environment

From an administrator checkout, copy `deploy/vps/.env.example` to the server,
then restrict and edit it:

```bash
scp -P 22 deploy/vps/.env.example synapth@YOUR_VPS_IP:/opt/synapth/.env
ssh -p 22 synapth@YOUR_VPS_IP 'chmod 0600 /opt/synapth/.env'
ssh -t -p 22 synapth@YOUR_VPS_IP 'nano /opt/synapth/.env'
```

Generate independent secrets on the VPS:

```bash
openssl rand -hex 32
openssl rand -base64 32
openssl rand -hex 32
```

Use the first value as `POSTGRES_PASSWORD`, the second as `AUTH_SECRET`, and the
third as `SYNAPTH_CRON_SECRET`. Compose builds `DATABASE_URL` itself with the
internal hostname `db`, so it must not be added to the VPS `.env`. Hex output is
URL-safe and therefore does not need percent encoding in the generated URL.

For email confirmation, configure `RESEND_API_KEY` and a verified `EMAIL_FROM`,
then set `SYNAPTH_EMAIL_VERIFICATION=1`. With the example value `0`, password
accounts are accepted without email confirmation. OAuth callback URLs are:

```text
https://synapth.localhost8081.ru/api/auth/callback/github
https://synapth.localhost8081.ru/api/auth/callback/google
```

## 4. Give GitHub Actions SSH access

Generate a dedicated key on a trusted administrator machine, not on the GitHub
runner:

```bash
ssh-keygen -t ed25519 -a 100 -N '' -f ./synapth_cd -C github-actions-synapth
ssh-copy-id -i ./synapth_cd.pub -p 22 synapth@YOUR_VPS_IP
```

The key should have no passphrase because the unattended runner cannot answer a
prompt. In `/home/synapth/.ssh/authorized_keys`, prefix this key with the
following restrictions; keep the public key itself on the same line:

```text
no-agent-forwarding,no-port-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA... github-actions-synapth
```

Obtain the SSH host key and compare its fingerprint with the value shown locally
on the VPS before trusting it:

```bash
# Run on the VPS console:
sudo ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub

# Run on the administrator machine, then compare the fingerprint:
ssh-keyscan -p 22 -t ed25519 YOUR_VPS_IP > synapth_known_hosts
ssh-keygen -lf synapth_known_hosts
```

Create a GitHub environment named `vps-production`, optionally with required
reviewers, and add these environment secrets:

```text
VPS_HOST               VPS address used by SSH
VPS_PORT               SSH port, normally 22
VPS_USER               synapth
VPS_SSH_PRIVATE_KEY    complete contents of ./synapth_cd
VPS_SSH_KNOWN_HOSTS    complete contents of synapth_known_hosts
```

With GitHub CLI they can be loaded as follows:

```bash
gh secret set --env vps-production VPS_HOST --body YOUR_VPS_IP
gh secret set --env vps-production VPS_PORT --body 22
gh secret set --env vps-production VPS_USER --body synapth
gh secret set --env vps-production VPS_SSH_PRIVATE_KEY < ./synapth_cd
gh secret set --env vps-production VPS_SSH_KNOWN_HOSTS < ./synapth_known_hosts
```

Delete the local private-key copy after confirming the first deployment, or
store it in the team's password manager for recovery and rotation.

## 5. Allow the VPS to pull from GHCR

The workflow publishes with its scoped `GITHUB_TOKEN`. Newly created GHCR
packages are private by default. Either make the package public after its first
publication, or create a classic PAT with only `read:packages` and log in once
as `synapth`:

```bash
sudo -iu synapth
read -rsp 'GHCR token: ' CR_PAT && echo
printf '%s' "$CR_PAT" | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
unset CR_PAT
exit
```

Docker stores this credential under the `synapth` account. Rotate the token and
the SSH key independently.

## 6. First and subsequent deployments

A push to `main` starts the VPS workflow independently from Netlify. It runs the
typecheck, linter, and tests; builds and publishes both images; copies the
Compose and deployment files; starts PostgreSQL; applies the schema; replaces
the app; and waits for `/api/health`.

The first deployment creates named volumes `synapth_postgres_data` and
`synapth_crawl_data`. Application rollback restores the previous image if the
health check fails. Database changes are intentionally additive, so an older
application can continue using the updated schema.

Useful server commands:

```bash
cd /opt/synapth
docker compose --env-file .env --env-file .images.env ps
docker compose --env-file .env --env-file .images.env logs -f --tail=200 app
docker compose --env-file .env --env-file .images.env logs -f --tail=200 db
docker compose --env-file .env --env-file .images.env exec db \
  pg_dump -U synapth -d synapth -Fc > "synapth-$(date +%F).dump"
```

Keep off-host backups of the PostgreSQL dump. Docker volumes survive container
replacement but are not backups against disk or host loss.
