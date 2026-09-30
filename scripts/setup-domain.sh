#!/usr/bin/env bash
# Existing migrated FTI server only. Certbot asks the operator for registration/terms.
set -eEuo pipefail
umask 022
[ "$(id -u)" -eq 0 ] || { echo 'Run as root on the new FTI server.'; exit 1; }
FTI_DOMAIN=${FTI_DOMAIN:-ftiprotocol.com}
FTI_ORIGIN_IP=${FTI_ORIGIN_IP:-185.114.206.44}
export FTI_DOMAIN FTI_ORIGIN_IP
APP=/opt/fti-protocol
CONF=/etc/nginx/conf.d/fti-domain.conf
cd "$APP"
[ -f /etc/fti/web.env ] && [ -f deployments/testnet.json ] || { echo 'Install the migrated FTI application first.'; exit 1; }
if [ -f "$CONF" ] && ! grep -q '^# Managed by FTI domain installer$' "$CONF"; then
 echo "An unmanaged $CONF exists. Review it before continuing."; exit 1
fi
# A/AAAA checks run before installing packages or changing public routes.
python3 - <<'PY'
import ipaddress,os,re,socket
name=os.environ['FTI_DOMAIN'];expected=str(ipaddress.IPv4Address(os.environ['FTI_ORIGIN_IP']))
if not re.fullmatch(r'[a-z0-9][a-z0-9.-]*\.[a-z]{2,}',name):raise SystemExit('Invalid domain')
for host in [name,'www.'+name]:
 try:rows=socket.getaddrinfo(host,80,type=socket.SOCK_STREAM)
 except socket.gaierror:raise SystemExit('DNS not ready for '+host+'. Set its A record to '+expected+' and retry.')
 addresses={r[4][0] for r in rows}
 if addresses!={expected}:raise SystemExit(host+' resolves to '+str(addresses)+'. Expected only '+expected+'. Correct old A/AAAA records; use DNS-only mode for this setup.')
 print('PASS DNS',host,expected)
PY
# Refuse a duplicate named vhost in another enabled config.
python3 - <<'PY'
import os,pathlib,re
name=os.environ['FTI_DOMAIN']
for directory in ['/etc/nginx/conf.d','/etc/nginx/sites-enabled']:
 for file in pathlib.Path(directory).glob('*'):
  if not file.is_file() or file.name=='fti-domain.conf':continue
  content=file.read_text(errors='replace')
  for hosts in re.findall(r'\bserver_name\s+([^;]+);',re.sub(r'#.*','',content)):
   if name in hosts.split() or 'www.'+name in hosts.split():raise SystemExit('Domain already configured in '+str(file)+'. Review the existing vhost.')
PY
apt-get update
apt-get install -y certbot curl nginx
bash scripts/update-unified-site.sh
FTI_STAGE=$(mktemp -d /var/tmp/fti-domain-setup.XXXXXXXX)
chmod 0700 "$FTI_STAGE"
[ ! -f "$CONF" ] || cp -a "$CONF" "$FTI_STAGE/previous.conf"
rollback() {
 trap - ERR
 if [ -f "$FTI_STAGE/previous.conf" ]; then cp -a "$FTI_STAGE/previous.conf" "$CONF"; else rm -f "$CONF"; fi
 if nginx -t; then systemctl reload nginx || true; fi
 echo 'Domain setup did not complete. Previous domain configuration restored; existing port 3090 remains available.'
 exit 1
}
trap rollback ERR
install -d -m 0755 /var/www/fti-acme/.well-known/acme-challenge
# Keep HTTPS intact on repeat runs when the existing certificate is present.
FTI_TLS=()
if [ -s "/etc/letsencrypt/live/$FTI_DOMAIN/fullchain.pem" ] && [ -s "/etc/letsencrypt/live/$FTI_DOMAIN/privkey.pem" ]; then FTI_TLS=(--tls); fi
python3 scripts/render-domain-nginx.py --domain "$FTI_DOMAIN" "${FTI_TLS[@]}" --output "$FTI_STAGE/vhost.conf"
install -m 0644 "$FTI_STAGE/vhost.conf" "$CONF"
nginx -t
systemctl reload nginx
if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then ufw allow 80/tcp;ufw allow 443/tcp;fi
printf '\nCertbot will request certificate registration details and acceptance of its terms.\n'
certbot certonly --webroot -w /var/www/fti-acme --cert-name "$FTI_DOMAIN" -d "$FTI_DOMAIN" -d "www.$FTI_DOMAIN" --keep-until-expiring
python3 scripts/render-domain-nginx.py --domain "$FTI_DOMAIN" --tls --output "$FTI_STAGE/tls.conf"
install -m 0644 "$FTI_STAGE/tls.conf" "$CONF"
nginx -t
systemctl reload nginx
install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/fti-nginx-reload.sh <<'HOOK'
#!/usr/bin/env bash
set -e
/usr/sbin/nginx -t
/bin/systemctl reload nginx
HOOK
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/fti-nginx-reload.sh
systemctl enable --now certbot.timer
for route in / /app/ /token/ /admin/ /api/config /health; do
 curl --resolve "$FTI_DOMAIN:443:127.0.0.1" --fail --silent --show-error --max-time 30 "https://$FTI_DOMAIN$route" -o /dev/null
 printf 'PASS HTTPS %s\n' "$route"
done
trap - ERR
printf '\nMain website: https://%s/\nMember panel: https://%s/app/\nToken site: https://%s/token/\nAdministration: https://%s/admin/\n' "$FTI_DOMAIN" "$FTI_DOMAIN" "$FTI_DOMAIN" "$FTI_DOMAIN"
printf 'HTTPS configured. Certificates renew through certbot.timer. Existing testnet contracts are unchanged.\n'
