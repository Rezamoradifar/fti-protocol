#!/usr/bin/env python3
"""Recover the original FTI web source without changing deployment trust metadata.

Default: inspect only. --apply restores the pinned source, with private backup
and automatic rollback on failed health. No keys, transactions or compilation.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import tempfile
import time
import urllib.request

SERVICE = 'fti-continuity-web.service'
REVISION = 'ba82373a83d63fba0643332371cfb6d62903c849'
FINGERPRINT = 'eaf50289e56998959303757f443b80d38caa7002427f4a5b126f5b00dee3e934'
RELEASES = Path('/opt/fti/releases')
BACKUPS = Path('/var/backups/fti-source-recovery')
DIRS = ('contracts', 'frontend', 'scripts', 'core', 'landing/src')
MUTABLE = ('frontend', 'scripts', 'landing/src')
EXTRAS = ('config/mainnet-genesis-layout.json', 'config/mainnet-council.json',
          'config/mainnet-usdt-collateral.json', 'config/v3-wallets.json',
          'config/mainnet-approved-input.REQUIRED.json', 'package.json',
          'package-lock.json', 'web/app.js', 'web/vendor/walletconnect.js',
          'core/hourly-cap-policy.mjs')
TARGET = {'chainId': 56, 'mode': 'bnb-mainnet',
          'release': 'FTI_CONTINUITY_MAINNET_20261013', 'sourceRevision': REVISION,
          'sourceFingerprint': FINGERPRINT,
          'mainnetPlanDigest': '0ec3a7d93f5e1225cbd4f5671f4ee6b92423718898f1734c42390337467f7480',
          'binary': '0x13aC3Af4FE3e72DccfFd52AB67E4d884B6D97dF9',
          'token': '0x43755B1E813b2d41F669ea08bcf859De07195eA1',
          'usd': '0x55d398326f99059fF775485246999027B3197955',
          'council': '0x85F567C2c59e766847D9dC18328C3B54cDf80DE4',
          'timelock': '0xcf3eCA1E96db99E478e81C79f2Ae03dEec80CA86'}
ARTIFACTS = {
    'MockUSD': 'dd038f2d152380a2372ef83697832ed04e6f50a0832af3e7d84f968ba33d031e',
    'SevenGuardianCouncil': '23e13ade53824d4abc1b3314b0d69e5b48a2fcde0d4c5bcaf35e795853409396',
    'FTITimelock': '37aa3b47674a0b6c3c7be929dbfdabd4ad8a2323945cef98326a336b829939eb',
    'FTIReserveTokenUpgradeable': '4677bac247205b939ca62c1d441d8b294dd7296f39cb1b603da584957efbe960',
    'FundedBinaryPlanUpgradeable': '229c7b7582ef04238a91bdea70eed33975b8629dfc11962c1ec3b23ac961906c',
    'FTIProxy': '262423ac55744075e93a665ab155739851913e3465ea02c40adada426bf2a48f'}
BASELINE = {
    "config/mainnet-approved-input.REQUIRED.json": "315d7d245b876c3c6ae451e8598579e8105898075f4ac14a46415175431e51e0",
    "config/mainnet-council.json": "6db7b72c13c9be5526a01e1b8d340e1f521cddbaaafea0005c11998536e44050",
    "config/mainnet-genesis-layout.json": "10296ed628e90ed7322009d2943f9510ff01cac570650f6a5278e28d44921efd",
    "config/mainnet-usdt-collateral.json": "73467bcbdfee4ec69a00b1a3da4a933ca24c60d2eaa399e74d33466e69c566f3",
    "config/v3-wallets.json": "5b4947a4063d0d053005f7a40a8bbf7d3e36ebfdc3b7560716f138d852398e2d",
    "contracts/BinaryPlan.sol": "1dc8834759f0b47cf293e5d1368189bf876485797ced8471c66c9e61298223c3",
    "contracts/ContinuityGovernance.sol": "5895092945b75813e451ee09456cb283ada60f21fa5760ac08d26fde8e61fd3f",
    "contracts/FTIAddressMigration.sol": "23ef79d29f0e859a043959d38380d23b20c2500edbdc72e128cfb0ee8e9121e5",
    "contracts/FTIProxy.sol": "3fb6c48221ee94c2966d26c6791c901121ebe506a52b204e92153fe55fa991b6",
    "contracts/FTIReserveToken.sol": "d70bd51fb3c27d95d6beaae981282f142dff7957a6a097668c2305ba013b6a71",
    "contracts/FTIReserveTokenRecovery.sol": "71ef8a68a489cab47de809a5e9662617d63284772c2ddcd7747535bf2f07acdb",
    "contracts/FTIReserveTokenUpgradeable.sol": "81bc16a311f67a43cb58990af8129b895484733cb6f86653c87c7fc425063412",
    "contracts/FTIReserveTokenV3.sol": "336f2d332f6528360196ec2a340531293940093e4bc7433568c59348aa12d672",
    "contracts/FTIToken.sol": "64e65c01d4af204eca1d971c9c82b6558f59820b98f4a526514768aa50030efe",
    "contracts/FundedBinaryPlan.sol": "1d520d0c5942f3273eba46f618a247c22611e9612e21af8263d4c1eb99cd60c5",
    "contracts/FundedBinaryPlanFloor.sol": "55ce2a368cbd7a4573de4c32943a0864939e21f4fa9ea3a46ead8dc05add142a",
    "contracts/FundedBinaryPlanUpgradeable.sol": "be1b03706b787a5dcf3c71c245fb370f0ad03a88d14b91729fec84e82e2ea3fa",
    "contracts/Governance.sol": "182368005711afdbc7ba65ad5301c02b90bc5269f9ddd8d903390c7e0c16a72d",
    "contracts/MockUSD.sol": "660b95edc8684c476f7c50c0da618c16b71ef5c82d948042d20dcd963a229157",
    "contracts/SevenGuardianCouncil.sol": "e71921d08ae0d8052ba49c2953201253704175d5e365265f399d228ca84521d8",
    "core/deployment-network.mjs": "bbfd20a3e6a52926d3dd63f895bb4bc9cd3599cab83d9102fcccdd10d3a16864",
    "core/funded-reference.mjs": "9b078d850ace2d428dd30dfb61cd519b85ad19a2d2544a970ee50bef4c6dcb41",
    "core/hourly-cap-policy.mjs": "e54ca3b23e498d7992609849ddc28aeda36c22d2cc418c976c8109a83932882f",
    "core/hourly-settlement-audit.mjs": "a10738fc188addf718b4df75e2de77e3f46a18b4480183368702d20c180a7455",
    "core/pool-distribution-policy.mjs": "4d9a286fe0b02caf82edbfaa242dae7c32dc2a7dba484df1385336d45789fb84",
    "core/reference.mjs": "9158626920c363ba572d7e9d91824a2960ca8fd4b53b7304bfc1132ed2543dca",
    "core/referral-placement.mjs": "e8802d486c0e1ca8474e715a74613af21ef9e28536cd3b02965d5d24495dc95b",
    "core/reserve-reference.mjs": "ed0c705bca9627beb46752518d53b8b72f738d6402bda138198409b922c80650",
    "frontend/brand.jsx": "8fbea7feb4d685444872e54be97ad3b7d914294197ee1d996126479163d4ef11",
    "frontend/builder-view.js": "10af2ffa60d511207b5426b8071f1a8ab7f2149004528fbb810da5385dd9403a",
    "frontend/candles.js": "57f7400868e908f1df90bf99b59a61d5dfd09666c68f8ca85bca7f90049c5f7c",
    "frontend/controller.js": "9b80509530d4842f871a44bee43605c405c55d04d8f5ac0017273e52e590247f",
    "frontend/core-translations.js": "3b4c7ae79fcaceae01c731f83e90532029c36472274a26374142e9b513c2313b",
    "frontend/deployment.js": "98bcdbb178aa152459e0f17b504b591c6b06e0e8d4aa41b0902c21ecaff96361",
    "frontend/glass-interface.css": "d655872dc9b16d56c364d1db79b6604d31acc54e085f83d946e0a0bc0e540193",
    "frontend/global-components.jsx": "007e587b7a711ba986ae057163eec881aeadacf76e498a7f19fb48af8a4c0095",
    "frontend/global-interface.css": "a93d98d2cfefc911a1b0cca878b3dbdb654d39d139d0741f429132e7f5168777",
    "frontend/hourly-caps.js": "c1ec268fb598a2ef79b6b009d99344b568eee6505c846c0279b2a6677fc8f026",
    "frontend/landing-network.mjs": "916eaa42d01d0719c9765c833e33c95f4e608a0cb90f11755a5c9b54b23bcb50",
    "frontend/landing-translations.js": "7bb2278cb90c40191e718d90de7bd3ee35037a9fa153180a3924a778fa0ff81c",
    "frontend/language-policy.js": "0b555f0e056ad62ce8e50d5018a92d8c22eae8f8814553bb9275bb73f8cf63fa",
    "frontend/live-market.js": "f852ec07c8e37d988d22269660769338f574f6177273a2bfeec0e2296a156428",
    "frontend/locale.js": "c2f3f192394822f282f4a3f391df0fad16caa410a9f484658de6fc3f4b830af0",
    "frontend/main.jsx": "b2c0c0e27ac90ab98acbee4221df6b71066d2be5478e4840998c0857c1fe5f30",
    "frontend/market-series.js": "25091387a5d46daaa7b95c3df33764a6f6c55686de7f29e25744d4a58742cd9c",
    "frontend/member-landing-theme.css": "24d3a715036a683b9f030d6373aa5b5b2b585d9829bddb26d2095da5b83a885f",
    "frontend/network-data.mjs": "eb9cf73cbe85acc3d4d1f12656a2643d94f4b99b9191cd096bfe0371f08a1268",
    "frontend/network-tree.js": "d24f561792e91a5afe952d50aac252edad3b3778c7bd500095874287f25984c5",
    "frontend/settled-points.js": "cc1ea27d48b79fbdd013f6a671caa0b4c0141251469d4b72bf420e9ae291a2bf",
    "frontend/site-links.js": "3c1e1a200e6e548e4f15b8b37085560e5907209ae209ab0761fa7a748bb016cb",
    "frontend/site-shell.jsx": "7ed8e91d15b12ad65ac3a14179794eddb404731fc5d23233f704e320b08bc425",
    "frontend/social-policy.js": "f3a89223015cb5a158da5c00ef30195796c7e9cac7a6f8e7d4c9c1e91c59675c",
    "frontend/spot-history.js": "360cbfbe5a1fc7abfc3c454d4a37c3470ec063f615b0c45030449532a6d158c0",
    "frontend/surfaces.js": "c485878f53e976c86dcbb2cb97e716060d7811f6c79976dfce386b48d55ad875",
    "frontend/token-introduction.jsx": "f7cd1b61695754ebb1d82a0eaacfef362e0730c932d4c31b5375834c443f3b3f",
    "frontend/translate-tree.jsx": "314a37717184e4bde3c96f4e3e7fe8b7314275706bd660d20601d8133ead0b47",
    "frontend/wallet-selector.js": "3b0a32a44bd7517fb6c02eb0c07aead5ee3a1efe592116651aa51f17ddf19630",
    "frontend/walletconnect.js": "f53018465606bcb187c2834f038e5e0366864dbf4c2605f078bbd7f91d81bd44",
    "landing/src/deployment-tree.jsx": "adf3421add229994663aedb07ae2f416f8a70edd68983e6f5ad7e15f1f64963a",
    "landing/src/glass-landing.css": "4cf2e6a3149cdcff79d3534da6ace32ec54779a21a509c9b4851c11b21ffa531",
    "landing/src/initial-landing.css": "66f91ae45da6e8ddd8a2a510ad21393e2bd6ebdf3436f0c1e3e56da2f5d9afa7",
    "landing/src/initial-landing.jsx": "179234a2ba7c403c60838b0bfc38176b40b2771db65ba88acd3ffba025f6dc45",
    "landing/src/main.jsx": "39181d6371818315c6440642b8bb844a86c36dac1dea83e7558495bc43aa6d3e",
    "landing/src/protocol-data.mjs": "bf162e9e6aa27290318fdf0f29f9e58730267857bceb7aaf369c5d063587d5a8",
    "landing/src/public-entry.jsx": "4bf760089215f01b57db86816ae2fd18f1794711e1c63156ab4bd3d85802bce0",
    "landing/src/public-site.jsx": "67260b42a3953a6949f9b2203b1728af8a210af3e0509846731ed4ded29ede03",
    "landing/src/public-style.css": "7c6f1ee43551ead750805bdcefcb942cbac0ef3161b925e3e352388115ecf047",
    "landing/src/sections.jsx": "cc9e338baa5f557816ec066e6be09e564ac43c8283bbbfe2c35902c0ecaed810",
    "landing/src/style.css": "d89ac4b56cc4b93240f29fb23ca7b6e8ad74885d33cc7f870f910c4fd87941bf",
    "package-lock.json": "2f89db62ee68166894b78b51684033b2391e3fb73889cf4fcae52e7e8b614fbe",
    "package.json": "2e8c652d6696f62267e1d5f8c299882a636bc076b258671be48752adf14fccc7",
    "scripts/address-migration-manifest.mjs": "d40e54acb831ba1b9675089cf547ad181ccb9554e5121fa765c435baf0029945",
    "scripts/address-migration-operator.mjs": "208cde608246612f251dae561bb665447476cdabf952c50c3778112384c2b8cc",
    "scripts/address-migration-policy.mjs": "64715e9a9d2b92fe6441d3041c53544490fc9a16c04a2fbb46ff0856248e27b8",
    "scripts/approved-genesis-layout.mjs": "5c0ba15c023a6d0a0dd08ea1aa109f6129e2d9a5b86294d679ea4d38ad1723fe",
    "scripts/approved-mainnet-profile.mjs": "ec154f709aead842d6267ecfb4eba7a0fbd854cc362b3ef4ec7bee3209ba73a9",
    "scripts/audit-installed.mjs": "4ec46b056e39d0ca8d9bd3c42d38bc9935b21cbbe1a6dcabe72f83aa5c2a9400",
    "scripts/build-web.mjs": "2d343616afa0e5b8fbfc41dd27e53733b3c14a2f8d9f9a1134b7a9b01c7ebcaa",
    "scripts/check-upgrade-layout.mjs": "4232560fc5b595bbc1185b950b6713966394c803baecf5d6aaf80bcc2483233c",
    "scripts/compile-continuity-layout.mjs": "d36ca726147834efba6365e241bd0796de18e1a7bd6af65fb2b3413a4d9f3800",
    "scripts/compile-continuity.mjs": "2cc13817d72ecff80eca6e26ce1e9f5f2bf71e86f20f6f807e7371ee6d110755",
    "scripts/compile.mjs": "394a09503a395b955910e23bca7db61c627a000a4dd5aa4472a379d077ba56f1",
    "scripts/continuity-monitor.mjs": "0262a82e03890dbe1cfee64f8e67aa86ef94d6f2df537b541844871084ca6bb1",
    "scripts/continuity-release.mjs": "c8d4c6bb2da147ef0773c32a7438e87d8bd96253ca210e2477417be472468bf7",
    "scripts/create-mainnet-input.mjs": "2ba9b465a432bd953611d5ea9e51097608871256699ae0995d2ce21a4db9f70c",
    "scripts/deploy-continuity-auto.mjs": "a845e827627b2b44fcc9742f909b7ef802f1e3c5f320757491cbd06d9fb53cc5",
    "scripts/deploy-continuity-testnet.mjs": "3019bf3b92bdaa2efaa4090ff0365d7bf9d665fca6b781de8946276ac80268f5",
    "scripts/deploy-reserve.mjs": "e53100af06195aa9dd569b4e3af27ff61ab9ba9b39f94ac47823dca99131e139",
    "scripts/deploy-v3-testnet.mjs": "4d4161761e59669ceffe8cff778361b4cc55db2c381298939d236fcb21a2b6bf",
    "scripts/deploy.mjs": "6b43831758497b0672bdb3a8e942f84bd3ddc3b34fd5980f2bc9f5ec65e4628b",
    "scripts/design-preview.mjs": "01d5665cd69b89dab34431897b8d4e958841f0abb33255d9397f41f31bd80fba",
    "scripts/event-reader.mjs": "14fe424f4f1008f7f873b7a5c32fc13f960f73ac033d099eb15bb9199ad7b008",
    "scripts/finalize-mainnet.mjs": "a5436fd092168d18ddfff3ea922bc0a8cdc277290a4efb31e55fe0000f153e7e",
    "scripts/fresh-testnet.mjs": "9a0db724261a00f5615659913c96682a7b6523086091d873b23124edd47ffbef",
    "scripts/import-browser-deployment.mjs": "7ed3b762b3d793cb9cca964cd1e2025eb1e247eb3a281feeb07364699fe357ff",
    "scripts/journey-sale.mjs": "41ea5d1924f5eb123b41e97828f9015a446d0b45395e6b19ef833cc5ae26e592",
    "scripts/keeper.mjs": "6fd7cd305fcac112b3cfc40fa65183cf4b80e2dcf790ab4127ad1b762751c581",
    "scripts/launch-server.mjs": "43971df617bc904bd519172ebc56cb5f63ed2d7deed4286c419c6d6279db0895",
    "scripts/launcher-smoke.mjs": "640ea3fb9ca6cfa80a00d1375c9fb32c1a859070b223f6caec7d6f0ad4fedefb",
    "scripts/lib.mjs": "039af868cb631f6024d56159e80d087823dc9fc452c617800fe5ba7871247552",
    "scripts/local.mjs": "2fa5e6167c59dcd04a22f4fd56c7f54c9644cf59878b72360ea9d1bd0a00041e",
    "scripts/mainnet-collateral.mjs": "09837863461c8bb86298bc92b0246c56e3d3b2557f05ed6d813a6f29eca97a99",
    "scripts/mainnet-council.mjs": "9cb0cda8da1875af77b4985412aea7f9a86b223ecc943ff43853e013a940e3f0",
    "scripts/mainnet-rpc.mjs": "4f8f1e91255c594f2dca910d19afe83925484b7c4f78f702aee18b7e452b50ff",
    "scripts/market-reader.mjs": "0ddf1d9cf6e6dd48d854c1bf51b2e0e7b5884e984401f32b79f30a56b5c43e36",
    "scripts/migrate-addresses.mjs": "021e9eefeba021787e3a36c751f5e9a169a7cdb253c9f4c7245de9295ca46911",
    "scripts/migration-complete-export.mjs": "d3125e0e3c9f753f94ea6b112c4579a300cae2898a9a34beceec354e40b5d714",
    "scripts/migration-inventory.mjs": "17aaa730574c8539590581f48dbac7eb469216b4ead9026430ebd1063835f52b",
    "scripts/migration-preflight.mjs": "6171e548da5b9ba3bb5c89a01ff1416b40c5c64dc3daad2687894c70c09fbc6e",
    "scripts/operational-release.mjs": "c24b5dcbc42f561f58b15202cbd63a1f462bc1bd45b3ec73074bceeac86ad2d4",
    "scripts/prepare-continuity-auto.mjs": "958bbf6a678e49780789b7c7a94494681f4082b5ce2bdab7a6981832b2a2f626",
    "scripts/prepare-mainnet.mjs": "23942bcc644f68ec44b15839070be410a23d8d55b7ed6e214df1a713bc367fcc",
    "scripts/referral-placement-index.mjs": "48e58fa81d5381262c0f7cf5d4aa9870d86af9f0dca90058c0c49cbac3da4572",
    "scripts/reproduce-core-autobuy.mjs": "ca36a41353c128ed0d30f235b530075894173a136a98a21f185135daec4b0d1d",
    "scripts/reserve-http-smoke.mjs": "a7880e2c408a2ad2c9209335b7933e27e368ecb802aaf873d5c108df0cb16b7a",
    "scripts/review-mainnet-migration.mjs": "1981faf49b77ec1659f71d7e027db76b46ec81b206f29ae28f88a194e038290f",
    "scripts/server.mjs": "31b576910e1d7573d7efd34efa16ecbcc84eb236c72a00579d59acc173a34353",
    "scripts/simulate-funded.mjs": "ba29e7d3a8010642ba49c6e2c1750177cb694f397adcef568244790ab01b8132",
    "scripts/simulate-reserve.mjs": "19b30b22914be40e2c4a9e2bb9225bafed491676da3846e758db210aa4afd7e5",
    "scripts/simulate.mjs": "c31fb1b414cf64584fab560739424777487560122dfd1bef5620198b2b4bf4f5",
    "scripts/site-routing.mjs": "89e31d8e1b6c067827e253d533e4e1775d81afe369d57a04ac4b6e2d0a023d19",
    "scripts/testnet-100.mjs": "7b9145865af726d24b944e300786b12aab65dedd508a5addff4fef325872a5c6",
    "scripts/testnet-journey.mjs": "79c278c07fb779a18a6b714cb61f22c53d3b904ae0b98452279b7cd53491b455",
    "scripts/ui-smoke.mjs": "9a73bedca38f14a01e967e4c716f5d54de49fbcf009f2e68519910e413fcdc04",
    "scripts/v3-release.mjs": "06a3dce1310fe69d18409e6ca4d90fe8910c5f5dbb36a97ec5cbebb58745253b",
    "scripts/v3-wallets.mjs": "a75152bcbc692048f3753935046d6e3b157132a27703edaebd2039d81f0b17aa",
    "scripts/verify-address-migration.mjs": "fd1e5d699083406d1ea5af11449bad532049f5c6e5ddb4a34a28c549307591b7",
    "scripts/verify-continuity-transition.mjs": "2ec858acaeabaf8facde309d5f5dccd0570a2fb0eb16fa257fc2ddb4a0eccc7a",
    "scripts/verify.mjs": "61010a2118936b799191a8b7df045e78ddf85e0e753db8aba0d73ccae0dc0271"
}
IDENTITY = ('LoadState', 'User', 'Group', 'WorkingDirectory', 'ExecStart',
            'Environment', 'EnvironmentFiles', 'UnsetEnvironment',
            'FragmentPath', 'DropInPaths')


def require(ok, code):
    if not ok:
        raise RuntimeError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def packed(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False).encode()


def safe(file):
    file = Path(file)
    require(file.is_absolute() and '..' not in file.parts, 'UNSAFE_PATH')
    require(not any(p.is_symlink() for p in (file, *file.parents)), 'SYMLINK_REJECTED')
    return file


def read(file, limit=16_000_000):
    file = safe(file)
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= limit,
                'UNSAFE_FILE')
        with os.fdopen(os.dup(fd), 'rb') as stream:
            data = stream.read(limit + 1)
        require(len(data) <= limit, 'FILE_TOO_LARGE')
        return data, info
    finally:
        os.close(fd)


def command(args, timeout=30):
    result = subprocess.run(args, capture_output=True, timeout=timeout,
                            env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'})
    require(result.returncode == 0, 'COMMAND_FAILED:' + Path(args[0]).name)
    return result.stdout.decode()


def properties():
    raw = command(['systemctl', 'show', SERVICE, '--property=' + ','.join(IDENTITY)])
    return dict(line.split('=', 1) for line in raw.splitlines() if '=' in line)


def environment_files(value):
    pattern = r'(/[-A-Za-z0-9_./]+) \(ignore_errors=(?:yes|no)\)'
    require(not re.sub(pattern, '', value).strip(), 'UNSUPPORTED_ENVIRONMENT_FILES')
    return re.findall(pattern, value)


def inspect_service():
    p = properties()
    require(p.get('LoadState') == 'loaded' and p.get('User') == p.get('Group') == 'fti-v3',
            'WRONG_SERVICE_IDENTITY')
    root = safe(p['WorkingDirectory'])
    require(root.parent == RELEASES and re.fullmatch(r'mainnet-web-[A-Za-z0-9-]+', root.name)
            and root.is_dir(), 'WRONG_RELEASE_DIRECTORY')
    node_match = re.search(r'path=(/opt/fti/runtime/node-v22\.[-A-Za-z0-9.]+/bin/node) ;', p['ExecStart'])
    require(node_match and str(root / 'scripts/server.mjs') in p['ExecStart'], 'WRONG_WEB_ENTRYPOINT')
    node = safe(node_match[1])
    require(node.is_file() and os.access(node, os.X_OK), 'MISSING_NODE_RUNTIME')
    require(not p.get('UnsetEnvironment'), 'UNSUPPORTED_ENVIRONMENT_UNSET')
    env = dict(value.split('=', 1) for value in shlex.split(p.get('Environment', '')) if '=' in value)
    private = {}
    paths = [p.get('FragmentPath', ''), *p.get('DropInPaths', '').split(),
             *environment_files(p.get('EnvironmentFiles', ''))]
    for name in paths:
        data, info = read(Path(name))
        require(info.st_uid == 0 and not info.st_mode & 0o022, 'UNSAFE_SERVICE_CONFIGURATION')
        private[name] = data
    for name in environment_files(p.get('EnvironmentFiles', '')):
        for line in private[name].decode().splitlines():
            line = line.strip()
            if not line or line.startswith(('#', ';')):
                continue
            key, separator, value = line.partition('=')
            require(separator and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key), 'UNSUPPORTED_ENVIRONMENT_LINE')
            fields = shlex.split(value)
            require(len(fields) <= 1, 'UNSUPPORTED_ENVIRONMENT_VALUE')
            env[key] = fields[0] if fields else ''
    cfgpath = safe(env.get('DEPLOYMENT_FILE', ''))
    require(cfgpath == Path('/var/lib/fti-continuity') / root.name / 'deployment.json',
            'WRONG_DEPLOYMENT_FILE')
    require(env.get('FTI_SOURCE_REVISION') == REVISION and env.get('PORT') == '3110'
            and env.get('HOST', '127.0.0.1') == '127.0.0.1', 'WRONG_WEB_ENVIRONMENT')
    private[str(cfgpath)] = read(cfgpath)[0]
    cfg = json.loads(private[str(cfgpath)])
    require(all(cfg.get(key) == value for key, value in TARGET.items()), 'WRONG_MAINNET_PROFILE')
    identity = digest(packed({'properties': p, 'files': {k: digest(v) for k, v in private.items()}}))
    require(properties() == p, 'SERVICE_CHANGED_DURING_INSPECTION')
    return root, str(node), cfg, private, identity


def source_hashes(root):
    result = {}
    for directory in DIRS:
        for file in sorted(safe(root / directory).iterdir()):
            require(not file.is_symlink(), 'SYMLINK_SOURCE_REJECTED')
            if file.is_file() and re.search(r'\.(sol|mjs|jsx|js|css)$', file.name):
                result[file.relative_to(root).as_posix()] = digest(read(file)[0])
    for name in EXTRAS:
        result[name] = digest(read(root / name)[0])
    return result


def fingerprint(hashes):
    ordered = {}
    for directory in DIRS:
        for name in sorted(hashes):
            if Path(name).parent.as_posix() == directory and re.search(r'\.(sol|mjs|jsx|js|css)$', name):
                ordered[name] = hashes[name]
    for name in EXTRAS:
        ordered[name] = hashes[name]
    return digest(packed(ordered))


def mutable(name):
    return Path(name).parent.as_posix() in MUTABLE and bool(re.fullmatch(r'[-A-Za-z0-9_/]+\.(mjs|jsx|js|css)', name))


def artifact_hashes(root, cfg):
    names = ('MockUSD', 'SevenGuardianCouncil', 'FTITimelock',
             'FTIReserveTokenUpgradeable', 'FundedBinaryPlanUpgradeable', 'FTIProxy')
    require(set(cfg.get('artifactHashes', {})) == set(names), 'INVALID_ARTIFACT_MANIFEST')
    require(cfg['artifactHashes'] == ARTIFACTS, 'UNREVIEWED_ARTIFACT_MANIFEST')
    result = {}
    contracts = [[file.name, digest(read(file)[0])] for file in sorted((root / 'contracts').iterdir())
                 if file.name.endswith('.sol')]
    contract_digest = digest(packed(contracts))
    for name in names:
        path = 'artifacts/' + name + '.json'
        raw = read(root / path)[0]
        require(digest(raw) == cfg['artifactHashes'][name]
                and json.loads(raw).get('sourceDigest') == contract_digest,
                'ARTIFACT_MISMATCH:' + name)
        result[path] = digest(raw)
    return result


def plan(root, cfg):
    before = source_hashes(root)
    artifact_hashes(root, cfg)
    after = {name: value for name, value in before.items() if name in BASELINE or name in EXTRAS}
    changes = {}
    for name, expected in BASELINE.items():
        if before.get(name) != expected:
            require(mutable(name), 'PROTECTED_SOURCE_DRIFT:' + name)
            changes[name] = expected
        after[name] = expected
    for name in before:
        if name not in after:
            require(mutable(name), 'UNEXPECTED_PROTECTED_SOURCE:' + name)
            changes[name] = None
    require(fingerprint(after) == cfg['sourceFingerprint'] == FINGERPRINT,
            'ORIGINAL_FINGERPRINT_NOT_RECONSTRUCTED_NO_CHANGES')
    return before, after, changes


def download(name, expected):
    request = urllib.request.Request('https://raw.githubusercontent.com/Rezamoradifar/fti-protocol/'
                                     + REVISION + '/' + name)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read(16_000_001)
    except Exception:
        raise RuntimeError('SOURCE_DOWNLOAD_FAILED:' + name) from None
    require(len(data) <= 16_000_000 and digest(data) == expected, 'DOWNLOADED_HASH_MISMATCH:' + name)
    return data


def save(file, data):
    safe(file)
    file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def replace(file, data, info):
    safe(file)
    fd, tmp = tempfile.mkstemp(prefix='.fti-recovery-', dir=file.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            os.fchmod(stream.fileno(), info['mode'])
            os.fchown(stream.fileno(), info['uid'], info['gid'])
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, file)
        parent = os.open(file.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def json_get(path, timeout=4):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open('http://127.0.0.1:3110' + path, timeout=timeout) as response:
        require(response.status == 200, 'HTTP_CHECK_FAILED')
        return json.loads(response.read(2_000_000))


def health():
    try:
        result, cfg = json_get('/health'), json_get('/api/config')
        return result.get('ok') is True and result.get('chainId') == 56 and all(
            cfg.get(k) == v for k, v in TARGET.items())
    except Exception:
        return False


def wait_health():
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        if health():
            return True
        time.sleep(2)
    return False


def unchanged(root, hashes, artifacts, identity):
    require(source_hashes(root) == hashes, 'CONCURRENT_SOURCE_CHANGE')
    current_root, _, cfg, _, current = inspect_service()
    require(current_root == root and current == identity and artifact_hashes(root, cfg) == artifacts,
            'CONCURRENT_CONFIGURATION_CHANGE')


def restore(backup, restart=True):
    backup = safe(backup)
    require(backup.parent == BACKUPS and backup.is_dir() and backup.stat().st_uid == 0
            and not backup.stat().st_mode & 0o077, 'INVALID_BACKUP')
    record = json.loads(read(backup / 'record.json')[0])
    require(record.get('schema') == 'FTI_ORIGINAL_SOURCE_RECOVERY_V1', 'INVALID_BACKUP_RECORD')
    root, _, cfg, _, identity = inspect_service()
    require(str(root) == record['root'] and identity == record['identity'], 'SERVICE_CHANGED_NO_ROLLBACK')
    current = source_hashes(root)
    for name in set(current) | set(record['before']) | set(record['after']):
        permitted = (record['before'].get(name), record['after'].get(name)) if name in record['changes'] else (record['before'].get(name),)
        require(current.get(name) in permitted, 'CONCURRENT_SOURCE_CHANGE_NO_ROLLBACK:' + name)
    require(artifact_hashes(root, cfg) == record['artifacts'], 'ARTIFACT_CHANGED_NO_ROLLBACK')
    originals = {}
    for name in record['changes']:
        require(mutable(name), 'INVALID_ROLLBACK_PATH')
        if name in record['before']:
            data = read(backup / 'before' / name)[0]
            require(digest(data) == record['before'][name], 'BACKUP_CHECKSUM_FAILED')
            originals[name] = data
    command(['systemctl', 'stop', SERVICE])
    for name in record['changes']:
        if name in originals:
            replace(root / name, originals[name], record['metadata'][name])
        elif (root / name).exists():
            safe(root / name).unlink()
    require(source_hashes(root) == record['before'], 'ROLLBACK_VERIFICATION_FAILED')
    if restart:
        command(['systemctl', 'reset-failed', SERVICE])
        command(['systemctl', 'start', SERVICE])
    print('FTI_SOURCE_FILES_RESTORED_TO_PREVIOUS_STATE', flush=True)


def apply(root, node, cfg, private, identity):
    before, after, changes = plan(root, cfg)
    artifacts = artifact_hashes(root, cfg)
    content = {name: download(name, expected) for name, expected in changes.items() if expected}
    require(os.statvfs(root).f_bavail * os.statvfs(root).f_frsize >
            sum(map(len, content.values())) * 3 + 32_000_000, 'INSUFFICIENT_DISK_SPACE')
    safe(BACKUPS).mkdir(mode=0o700, parents=True, exist_ok=True)
    require(BACKUPS.stat().st_uid == 0 and not BACKUPS.stat().st_mode & 0o077, 'UNSAFE_BACKUP_DIRECTORY')
    backup = Path(tempfile.mkdtemp(prefix='recovery-', dir=BACKUPS))
    record = {'schema': 'FTI_ORIGINAL_SOURCE_RECOVERY_V1', 'root': str(root), 'identity': identity,
              'before': before, 'after': after, 'changes': changes, 'artifacts': artifacts, 'metadata': {}}
    for name in changes:
        if (root / name).exists():
            data, info = read(root / name)
            save(backup / 'before' / name, data)
            record['metadata'][name] = {'mode': stat.S_IMODE(info.st_mode), 'uid': info.st_uid, 'gid': info.st_gid}
        else:
            info = (root / Path(name).parent).stat()
            record['metadata'][name] = {'mode': 0o644, 'uid': info.st_uid, 'gid': info.st_gid}
    for index, data in enumerate(private.values()):
        save(backup / 'private' / str(index), data)
    for name, data in content.items():
        save(backup / 'staged' / name, data)
        if name.endswith('.mjs'):
            command([node, '--check', str(backup / 'staged' / name)])
    save(backup / 'record.json', packed(record))
    save(backup / 'recover.py', read(Path(__file__).absolute())[0])
    # Backup reread happens before service stop or replacement.
    for name in changes:
        if name in before:
            require(digest(read(backup / 'before' / name)[0]) == before[name], 'BACKUP_CHECKSUM_FAILED')
    print('BACKUP=' + str(backup), flush=True)
    print('ROLLBACK=python3 ' + str(backup / 'recover.py') + ' --restore ' + str(backup), flush=True)
    unchanged(root, before, artifacts, identity)
    try:
        command(['systemctl', 'stop', SERVICE])
        unchanged(root, before, artifacts, identity)
        for name, expected in changes.items():
            if expected:
                replace(root / name, content[name], record['metadata'][name])
            else:
                safe(root / name).unlink()
        unchanged(root, after, artifacts, identity)
        require(fingerprint(source_hashes(root)) == FINGERPRINT, 'FINAL_FINGERPRINT_MISMATCH')
        command(['systemctl', 'reset-failed', SERVICE])
        command(['systemctl', 'start', SERVICE])
        require(wait_health(), 'WEB_HEALTH_FAILED')
        unchanged(root, after, artifacts, identity)
    except BaseException:
        try:
            restore(backup)
        except BaseException:
            print('ROLLBACK_INCOMPLETE_INSPECT_BACKUP:' + str(backup), flush=True)
        raise
    print(json.dumps({'result': 'FTI_WEB_RECOVERED', 'originalSourceFingerprintVerified': True,
                      'contractsChanged': False, 'deploymentConfigChanged': False,
                      'keeperChanged': False, 'backup': str(backup)}), flush=True)
    for path in ['/api/state', '/api/placement?referrer=0xD6492377C2C33047aFE61768930b2aedFF2B2704']:
        try:
            json_get(path, timeout=8)
            print('FOLLOWUP_OK=' + path, flush=True)
        except Exception:
            print('FOLLOWUP_STILL_REQUIRED=' + path, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--apply', action='store_true')
    group.add_argument('--restore', type=Path)
    args = parser.parse_args()
    require(os.geteuid() == 0, 'RUN_AS_ROOT_ON_FTI_SERVER')
    os.umask(0o077)
    lockpath = safe(Path('/run/lock/fti-service-cutover.lock'))
    fd = os.open(lockpath, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'r+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.restore:
            restore(args.restore)
            return
        root, node, cfg, private, identity = inspect_service()
        before, after, changes = plan(root, cfg)
        print(json.dumps({'result': 'FTI_SOURCE_RECOVERY_PLAN', 'files': sorted(changes),
                          'currentFingerprint': fingerprint(before), 'targetFingerprint': fingerprint(after),
                          'contractsChanged': False, 'deploymentConfigChanged': False}), flush=True)
        if not args.apply:
            return
        if health():
            print('FTI_ALREADY_HEALTHY_NO_CHANGES', flush=True)
            return
        apply(root, node, cfg, private, identity)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('FTI_RECOVERY_INTERRUPTED', flush=True)
        raise SystemExit(130)
    except Exception as error:
        # No raw subprocess, RPC, unit or environment contents reach terminal output.
        print('FTI_RECOVERY_STOPPED:' + (str(error) if isinstance(error, RuntimeError) else type(error).__name__), flush=True)
        raise SystemExit(1)
