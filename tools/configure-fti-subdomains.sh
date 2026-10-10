#!/usr/bin/env bash
# Configure only the three FTI workspaces; preserve the main-domain vhost.
set -Eeuo pipefail
umask 027
[ "$(id -u)" = 0 ]
command -v nginx >/dev/null
command -v certbot >/dev/null
curl -fsS --max-time 20 http://127.0.0.1:3110/health >/dev/null
for item in 'app:/app/' 'token:/token-site/' 'council:/admin/'; do
 FTI_HOST="${item%%:*}.ftiprotocol.com"
 FTI_ROUTE="${item#*:}"
 FTI_LOCATION="$(curl -fsS --max-time 20 -D - -o /dev/null -H "Host: $FTI_HOST" http://127.0.0.1:3110/ | tr -d '\r' | sed -n 's/^Location: //p')"
 [ "$FTI_LOCATION" = "$FTI_ROUTE" ] || { echo 'Install the updated frontend before configuring subdomains.'; exit 1; }
done
curl -fsS --max-time 20 http://127.0.0.1:3110/whitepaper/ -o /dev/null
FTI_CONF=/etc/nginx/conf.d/fti-workspaces.conf
FTI_BACKUP="/var/lib/fti-continuity/domain-backups/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mkdir -p "$FTI_BACKUP" /var/lib/fti-acme
if test -f "$FTI_CONF"; then
 rg -q '^# FTI_WORKSPACES_MANAGED' "$FTI_CONF" 2>/dev/null || grep -q '^# FTI_WORKSPACES_MANAGED' "$FTI_CONF"
 cp -p "$FTI_CONF" "$FTI_BACKUP/previous.conf"
fi
python3 - <<'PY'
import socket,subprocess,re
root={r[4][0] for r in socket.getaddrinfo('ftiprotocol.com',80,type=socket.SOCK_STREAM)}
for sub in ['app','token','council']:
 host=sub+'.ftiprotocol.com'
 try: addresses={r[4][0] for r in socket.getaddrinfo(host,80,type=socket.SOCK_STREAM)}
 except socket.gaierror: raise SystemExit('DNS missing: add A record '+sub+' -> 185.114.206.44, then rerun.')
 if not addresses or not addresses.issubset(root):raise SystemExit('DNS differs from main server: '+host+'. Set its A record to 185.114.206.44; remove incorrect AAAA records.')
config=subprocess.run(['nginx','-T'],capture_output=True,text=True,check=True).stdout
current=''
for line in config.splitlines():
 if line.startswith('# configuration file '):current=line
 if re.search(r'^\s*server_name\s',line) and any(x in line for x in ['app.ftiprotocol.com','token.ftiprotocol.com','council.ftiprotocol.com']) and '/fti-workspaces.conf:' not in current:raise SystemExit('Existing subdomain vhost found outside managed file; preserving it: '+current)
PY
FTI_CHANGED=0
rollback(){
 result=$?
 if [ "$result" -ne 0 ] && [ "$FTI_CHANGED" = 1 ]; then
  if test -f "$FTI_BACKUP/previous.conf"; then cp -p "$FTI_BACKUP/previous.conf" "$FTI_CONF"; else rm -f "$FTI_CONF"; fi
  nginx -t && systemctl reload nginx
  echo 'Subdomain configuration restored. Main-domain configuration was preserved.'
 fi
 exit "$result"
}
trap rollback EXIT
cat > "$FTI_BACKUP/http.conf" <<'NGINX'
# FTI_WORKSPACES_MANAGED
server {
 listen 80;
 server_name app.ftiprotocol.com token.ftiprotocol.com council.ftiprotocol.com;
 location ^~ /.well-known/acme-challenge/ {root /var/lib/fti-acme;}
 location / {
  proxy_pass http://127.0.0.1:3110;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_read_timeout 60s;
 }
}
NGINX
FTI_CHANGED=1
install -m 0644 "$FTI_BACKUP/http.conf" "$FTI_CONF"
nginx -t
systemctl reload nginx
# Reuse the server's existing Certbot account; fail if account setup is required.
certbot certonly --webroot -w /var/lib/fti-acme --cert-name fti-workspaces \
 -d app.ftiprotocol.com -d token.ftiprotocol.com -d council.ftiprotocol.com \
 --non-interactive --keep-until-expiring
cat > "$FTI_CONF" <<'NGINX'
# FTI_WORKSPACES_MANAGED
server {
 listen 80;
 server_name app.ftiprotocol.com token.ftiprotocol.com council.ftiprotocol.com;
 location ^~ /.well-known/acme-challenge/ {root /var/lib/fti-acme;}
 location / {return 301 https://$host$request_uri;}
}
server {
 listen 443 ssl;
 server_name app.ftiprotocol.com token.ftiprotocol.com council.ftiprotocol.com;
 ssl_certificate /etc/letsencrypt/live/fti-workspaces/fullchain.pem;
 ssl_certificate_key /etc/letsencrypt/live/fti-workspaces/privkey.pem;
 ssl_protocols TLSv1.2 TLSv1.3;
 location / {
  proxy_pass http://127.0.0.1:3110;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_read_timeout 60s;
 }
}
NGINX
nginx -t
systemctl reload nginx
FTI_HOOK=/etc/letsencrypt/renewal-hooks/deploy/fti-workspaces-reload.sh
if test -f "$FTI_HOOK"; then grep -q '^# FTI_WORKSPACES_MANAGED' "$FTI_HOOK"; fi
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > "$FTI_HOOK" <<'HOOK'
#!/usr/bin/env bash
# FTI_WORKSPACES_MANAGED
set -euo pipefail
if [ "${RENEWED_LINEAGE:-}" = /etc/letsencrypt/live/fti-workspaces ]; then
 nginx -t
 systemctl reload nginx
fi
HOOK
chmod 0750 "$FTI_HOOK"
for host in app.ftiprotocol.com token.ftiprotocol.com council.ftiprotocol.com; do
 curl -fLsS --max-time 60 "https://$host/" -o /dev/null
 curl -fsS --max-time 30 "https://$host/api/config" -o /dev/null
 echo "PASS https://$host/"
done
cat > "$FTI_BACKUP/rollback.sh" <<ROLLBACK
#!/usr/bin/env bash
set -euo pipefail
if test -f '$FTI_BACKUP/previous.conf'; then cp -p '$FTI_BACKUP/previous.conf' '$FTI_CONF'; else rm -f '$FTI_CONF'; fi
nginx -t
systemctl reload nginx
ROLLBACK
chmod 0700 "$FTI_BACKUP/rollback.sh"
echo "Rollback: bash $FTI_BACKUP/rollback.sh"
echo 'FTI workspaces enabled. Contracts, users and funds were not moved.'
