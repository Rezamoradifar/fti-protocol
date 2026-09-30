#!/usr/bin/env python3
"""Render the dedicated FTI virtual host; never edits unrelated Nginx sites."""
import argparse,re,pathlib
p=argparse.ArgumentParser()
p.add_argument('--domain',required=True)
p.add_argument('--tls',action='store_true')
p.add_argument('--output',required=True)
a=p.parse_args()
if not re.fullmatch(r'(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+',a.domain):
 raise SystemExit('Expected a lowercase DNS name, without scheme or path.')
routes=(pathlib.Path(__file__).resolve().parent.parent/'ops/nginx/fti-public-locations.conf').read_text()
marker='# Managed by FTI domain installer\n'
challenge='location ^~ /.well-known/acme-challenge/ { root /var/www/fti-acme; default_type text/plain; }'
common=''' root /opt/fti-protocol/landing/dist;
 index index.html;
 client_max_body_size 1m;
 add_header X-Content-Type-Options nosniff always;
 add_header Referrer-Policy no-referrer always;
'''
d=a.domain
if a.tls:
 conf=marker+f'''server {{
 listen 80;
 server_name {d} www.{d};
 {challenge}
 location / {{ return 301 https://{d}$request_uri; }}
}}
server {{
 listen 443 ssl;
 server_name www.{d};
 ssl_certificate /etc/letsencrypt/live/{d}/fullchain.pem;
 ssl_certificate_key /etc/letsencrypt/live/{d}/privkey.pem;
 ssl_protocols TLSv1.2 TLSv1.3;
 return 301 https://{d}$request_uri;
}}
server {{
 listen 443 ssl;
 server_name {d};
 ssl_certificate /etc/letsencrypt/live/{d}/fullchain.pem;
 ssl_certificate_key /etc/letsencrypt/live/{d}/privkey.pem;
 ssl_protocols TLSv1.2 TLSv1.3;
 ssl_session_cache shared:FTI_TLS:10m;
'''+common+routes+'}\n'
else:
 conf=marker+f'''server {{
 listen 80;
 server_name {d} www.{d};
 {challenge}
'''+common+routes+'}\n'
pathlib.Path(a.output).write_text(conf)
