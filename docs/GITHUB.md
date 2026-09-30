# Publish the source to GitHub

Create an empty repository named `fti-protocol` under your GitHub account. Do not initialize it with a README because this package already contains one.

From the extracted project folder:

```bash
git init -b main
git add .
git commit -m "Add FTI testnet project v0.2.0"
git remote add origin https://github.com/Rezamoradifar/fti-protocol.git
git push -u origin main
```

Use your existing GitHub credential manager or SSH setup. Never commit wallet keys, `.env`, or encrypted helper-account backups. The repository includes ignore rules; review staged files with `git diff --cached --name-only` before pushing.

Once uploaded, install on a server:

```bash
git clone https://github.com/Rezamoradifar/fti-protocol.git
cd fti-protocol
npm ci
npm test
npm run demo
```

Repository: https://github.com/Rezamoradifar/fti-protocol. See the main README for SSH access and testnet deployment.
