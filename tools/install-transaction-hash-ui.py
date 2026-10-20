#!/usr/bin/env python3
"""Install a verified transaction-hash UI overlay without npm or a service restart.

The maintainer packages one locally built app.js with --package ROOT --output FILE.
The resulting standalone installer verifies and reuses every installed base asset,
then atomically switches only web/index.html. --restore BACKUP restores that HTML.
"""
import argparse
import base64
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile
import urllib.request

SERVICE = 'fti-continuity-web.service'
LOCAL = 'http://127.0.0.1:3110'
PUBLIC = 'https://ftiprotocol.com'
RELEASES = Path('/opt/fti/releases')
BACKUPS = Path('/var/backups/fti-transaction-hash-ui')
BASE_PREFIX = 'fti-mainnet-ui-6647be9f87652c33'
BASE_ASSETS = {'app.js': '8c6e5f281a7e8ec86db277afde18a0cffea9fc2989cebd0ec7def835da5435ad', 'app.js.LEGAL.txt': '573cc95a6417c69a6ca44804f440f00965283c8cdcc50025305a7a50f53940ac', 'style.css': '373a39681dd415c339a117034c7d5d5d9fc976b28730b1967e25dd4afb117190', 'member-landing-theme.css': '4a66ac54bbbd1282c61536ec6889f07047bdaeda1a54b6b431910da9b31d0198', 'global-interface.css': '08c083262991d5387882b6d86b1930e69b5a7a3e67a998191017625caae2516b', 'panel-identity.css': '12f294040117dd35e4e2c0d30b4e1f08e8da9727487b6a96458d089e5c95fece', 'fonts/vazirmatn-arabic-wght-normal-GZN7WEUV.woff2': '84a382e46c30fb4f73d0e3800c16d0af15888e2731e57fa5f93e2c29a2c6a957', 'fonts/manrope-latin-wght-normal-73PUZEUA.woff2': 'a30ddcd349703aff7464c34bef3fffdff405ee50c113440d7c8693c02d210972', 'fonts/orbitron-latin-600-normal-CEBIPJEJ.woff2': '585062e775d70397653192777533f65f3afb707320fcc2a4bc510470e03762e6', 'fonts/noto-sans-sc-113-wght-normal-I3VGVFW7.woff2': '40290d98d5c121bdbb1909e39c9c0242eae3a5a88f1bbe302857e525b90056df', 'fonts/noto-sans-sc-33-wght-normal-MAHRETI4.woff2': '02fd273486d8e0c876b3b5d2c3c131b9ce85058196ee3ed77c7d38a7a10e139c', 'fonts/noto-sans-sc-108-wght-normal-P6K75C44.woff2': '12fcc1175cb6370acb056743f4fea7fdde85b6376ada2f15dfbab59f02b45988', 'fonts/noto-sans-sc-81-wght-normal-7XKS76G7.woff2': '9958d614924fa54de4f661febd02c1de787ef640d58970e4d928e1ecd7c17990', 'fonts/noto-sans-sc-46-wght-normal-O4MT3IGM.woff2': 'd4a75aa10eb4487dcd94ff2009ef0f185d35f0e3264fa87532887c5c1517c816', 'fonts/noto-sans-sc-71-wght-normal-ZFRPHXMU.woff2': '734da1dcc260ca6cc29c9e42078125ae8e4583fbc1f7cc76d82572a73767f04d', 'fonts/noto-sans-sc-31-wght-normal-NKKETG7I.woff2': 'def5793483c7abc922de654bc16262646c9ae263819e663990b52fd56a3d5d69', 'fonts/noto-sans-sc-82-wght-normal-AXNTYBOP.woff2': '2129264ef35c203e3a2c2bc16abc437c110c57006d108ff107ad775dc7ea1e39', 'fonts/noto-sans-sc-105-wght-normal-JRJQEJ55.woff2': 'ade910a27a4bd65baed59a8a86a3a6a80f6083daa7123bb9ff32da15e56fda9d', 'fonts/noto-sans-sc-42-wght-normal-E7ZXSQNI.woff2': 'c53279f786dde3590baf0343d080fad8c7bd976e9dccecd2adea893cfad2f99a', 'fonts/noto-sans-sc-57-wght-normal-WZ2TSKOL.woff2': '3a4bddf6442271be898390e29e344183f5f10a97eefa04595c9537f535f34927', 'fonts/noto-sans-sc-87-wght-normal-5NVESL7H.woff2': '40292a14f8f52accb05252b7ec7c68e00f35781d2a726223bec1685eee6312b5', 'fonts/noto-sans-sc-32-wght-normal-VTRBTXMZ.woff2': '2d884d1cfd97c6f72518a2d690573e4130b0b707423f25963d7cc975388adf3e', 'fonts/noto-sans-sc-24-wght-normal-UEVG6LID.woff2': 'fc59757db66129052cd8e4248045f92f8273b37f719be2a058a55859de190a0e', 'fonts/noto-sans-sc-50-wght-normal-4Y2R4CM3.woff2': '050cbf869048801588356d05f1145c601ddb9063a9e9fd241bbd0997a5ca263f', 'fonts/noto-sans-sc-104-wght-normal-FRTXPORL.woff2': '1e716b78655e396075808be52a9e749df1b6b5d17bd0ccedc6dcb89586903737', 'fonts/noto-sans-sc-83-wght-normal-RVU6EZUO.woff2': '24a037cbb07cb4de1f92993a9ceda16ba4483f1d63f6f529ea26ae44f01243fd', 'fonts/noto-sans-sc-51-wght-normal-GAF2QKMR.woff2': '48810df68807cb9a06052daa52495183575373dc1f3294cce7739a6f37ff25cf', 'fonts/noto-sans-sc-97-wght-normal-UAGQWSH7.woff2': '7671f7b32d4c5c11ba72df9e6b9a18a6441f863aade2623ac0562ebd34b82bc7', 'fonts/noto-sans-sc-112-wght-normal-JJ2MU52I.woff2': '34e76675ceffd89824fb130d7649dc92df9e57843a73b9996d405baa2ff9ecff', 'fonts/noto-sans-sc-40-wght-normal-FGHIESOR.woff2': '2f186187cfd9a546d199aac41fbaed1241a47a7d5aad1804f98127506af80340', 'fonts/noto-sans-sc-44-wght-normal-R3PQ3OGD.woff2': 'aa1a541dfacfcad0c66fb7f9dd4f9c12ce729d98311336c634702d066aabbbc2', 'fonts/noto-sans-sc-28-wght-normal-F5PRAHVR.woff2': '31bb7facf7a62ee189026f7ff725b9c4639c712762036394c2996db140549746', 'fonts/noto-sans-sc-cyrillic-wght-normal-URM5QYJJ.woff2': '811e869a2b23ff46086eeff6fa59185bb1aa982f5bcd8d34db51e10ea8e5f7e1', 'fonts/noto-sans-sc-103-wght-normal-EE7RSXKR.woff2': '1bfdb1f001006c62434577b60064c3ec0562e4a68191acbc7feeba4b303bf095', 'fonts/noto-sans-sc-22-wght-normal-GYZTPO4E.woff2': 'b15b23e18f7b765bd08d12d13210c0af8d32bee34712bc3152d0b386d043ec04', 'fonts/noto-sans-sc-106-wght-normal-TSZZME32.woff2': 'd31c838eb0e43043109bd6ddc23c295c340fc50f9a2f2381076ae8c0fa7f980b', 'fonts/noto-sans-sc-34-wght-normal-WRJMJOI6.woff2': '13a18e443a4bf6557e252a63061914ce19c4be018c9b16eaf5c75842ee88baf5', 'fonts/noto-sans-sc-88-wght-normal-5FL277IP.woff2': '008f38db74bc1c346ba8f4d6065dd41d0fe33a4ed2f9909cb880b81c5a3f9334', 'fonts/noto-sans-sc-49-wght-normal-F5PX6OLO.woff2': '2418a76f14f6299b160af41cd283ed529b0030e2448b2ec11895ea5009561e25', 'fonts/noto-sans-sc-64-wght-normal-SXYM5SCM.woff2': 'd490960a491521936b84a4be078a9570444960a2dc73c584b802d2c9c8fba1c1', 'fonts/noto-sans-sc-79-wght-normal-RTEA6GNC.woff2': 'db79df334235f3d72cc0a7e625bfee1c3d6a76104af15e0814c4926ceee6188e', 'fonts/noto-sans-sc-54-wght-normal-WEWRDGBT.woff2': 'db60ee4c755151c036004e39bde39fa9676c6a9d1753d9842ae1a7b2e5899b83', 'fonts/noto-sans-sc-58-wght-normal-6EQIFWH3.woff2': 'b4a952b513ca0e1b594a856e5398d1e40d69b0bf220825210955fde747faa8d0', 'fonts/noto-sans-sc-67-wght-normal-4345KG36.woff2': '54fc8c9eca1c929480b2c090907dfd9d42875cec49989b0737af2b6a60097f29', 'fonts/noto-sans-sc-53-wght-normal-KOL3IHJA.woff2': '13b6821eb6534f1ac72a4bab506de7012bec7fe0b9bb0a73733d5c798dd45e29', 'fonts/noto-sans-sc-65-wght-normal-H73UAAQK.woff2': '086958b9f441a2ba9fca76e9ac4924bc4acb60559bd5620d348c707ff154ee83', 'fonts/noto-sans-sc-59-wght-normal-B7OE3HL2.woff2': '0557109d55c77ff9c9b5c9732d732c5328bd0b61038cffe611d9d62b26ded420', 'fonts/noto-sans-sc-99-wght-normal-TTG56C3N.woff2': '6b2d1065f737c83608088c2e241c605683d94c6160121ca976496507ebc6cc94', 'fonts/noto-sans-sc-89-wght-normal-Z4QHJUXH.woff2': '74a75243aa93eb61367a28d217ce82b76c6cf9e86d0f23fd96708bfd91b68f46', 'fonts/noto-sans-sc-latin-wght-normal-I7HXVIJ2.woff2': 'cf5346b0747cd71123c8f74da0ad41fc0f63eda07b9d8e0382e00882ae743733', 'fonts/noto-sans-sc-101-wght-normal-PVXUFKUH.woff2': 'a33308bf652e64ac2884bfe830996e933322b939b915bb823fd47383580664ad', 'fonts/noto-sans-sc-4-wght-normal-RUWDBMB7.woff2': '29634170d5eb07f460a9eb1b2d0ef126ad0b5ef705e4c25191fd5794dc930d4d', 'fonts/noto-sans-sc-62-wght-normal-GMVQRSXB.woff2': 'd532c89a0da063c68ce871a7f85fa75448efc3089335e012f107d80618512fd4', 'fonts/noto-sans-sc-98-wght-normal-X3FH25YJ.woff2': '94e55b60e87bfb909709592144002c0b10a4214612ea512b38bb719c9ef45c49', 'fonts/noto-sans-sc-26-wght-normal-N7B4S43C.woff2': '68074245ba1ea9745cad9cf3780b69c9def3568891296e44d60e070e45df7b7a', 'fonts/noto-sans-sc-56-wght-normal-Y5ILR4FN.woff2': 'cc5fe9a6dedd91e7b95482713b12c84d99a04f90d5124e50db3efa9f2450923f', 'fonts/noto-sans-sc-90-wght-normal-BRR7KO3W.woff2': '80d51f95afbebcbed0cc53985fbce43eec3a37c8ec88b08d316c56a32aa77843', 'fonts/noto-sans-sc-86-wght-normal-ZHHRCJ3E.woff2': '55fd1a42ab8ace744691b59c535499ad22b22c7c98b1d69a22fe101a2cd9b0e9', 'fonts/noto-sans-sc-118-wght-normal-DQYFVX3I.woff2': 'f26330ce4056382832c0f2a0d7f411e0b4140fc87937e8865d91664410cfb98c', 'fonts/noto-sans-sc-80-wght-normal-WVBF2RXK.woff2': 'c9ce6e0654379a2dd291a6f29323ff2d7f06156389ffb3e4d087a9d211887a6b', 'fonts/noto-sans-sc-72-wght-normal-VBIM4RVC.woff2': '71d3da5b2d0e05b8899e271aaa49982fa73a589168be26a8350ff6f79f20bfd7', 'fonts/noto-sans-sc-76-wght-normal-JXPYCCP5.woff2': '8a31272bf31f9340747866ad1a59ff6073bf92fe802e2ba5a531f6a8aac2a42b', 'fonts/noto-sans-sc-47-wght-normal-HM2XDOED.woff2': 'd5c48bd3b5502918adf253c96909f27be4eda7653fc0254a6564557b516cb2e1', 'fonts/noto-sans-sc-21-wght-normal-QFUKA6B2.woff2': '0c5afc8752b151a444ccb3b21d740cc8e429347ea52bd4cf9d22b73937624bbf', 'fonts/noto-sans-sc-69-wght-normal-JDFDLIWS.woff2': 'c7d1f5b0f95f358dee4cf9e76eda5c0465eb9d0f4e21a13ef39d0cf8761e5b9d', 'fonts/noto-sans-sc-39-wght-normal-73IMWVNO.woff2': 'e73a947fa1fb1a7385e9d654fa0fe7dd8a2241e9b73282f67941c650c94de326', 'fonts/noto-sans-sc-48-wght-normal-L5GAJL22.woff2': 'c4f53f8b05fa6350ac20f8a12b550f9634ed31b084dc50b1263f2080e392b9f7', 'fonts/noto-sans-sc-84-wght-normal-4XL5XVJZ.woff2': 'e1b9b9aee81a74fc4ec19e1709c64a0042d9d898a2f00f6c3b2012564b6a4783', 'fonts/noto-sans-sc-latin-ext-wght-normal-RFMT7KYP.woff2': '0049f7154dcc3fa0d585f80383b232cb9e497084ee77e10519747d668db3cb55', 'fonts/noto-sans-sc-115-wght-normal-Y7P6MQIS.woff2': '6c0cda055b31066fb60058ac30ede37f6f9ca02265c2e1a84aee81175f567fa8', 'fonts/noto-sans-sc-38-wght-normal-ZWQN5JKO.woff2': 'ca375e4a6ecc230333656ad11081b26e6b8f3240f4160e22f75150d4fdddcc9f', 'fonts/noto-sans-sc-110-wght-normal-MVZD7P3K.woff2': '51785f4a4d2a011d877052cab1bc4c36cabcc4e186ed0176214061c174b7f024', 'fonts/noto-sans-sc-107-wght-normal-O2VHAKC4.woff2': 'd8d9b5fd2b266fdf3f6855444e7769e54f39806e48994e7fe5e0c4ace9553c81', 'fonts/noto-sans-sc-70-wght-normal-74MEVF4T.woff2': '8474823a5264bfdee208fd16e2e5f3fe689e8eb18941446678426dc5f1264d19', 'fonts/noto-sans-sc-37-wght-normal-II5GLGM3.woff2': 'bcbdf5fd7899c7ed192a0c89de9c6c92477be74b8c2343e74914359bfd32a10f', 'fonts/noto-sans-sc-73-wght-normal-AL75WJMT.woff2': '92f8b99dc1a79089d18b1684447e31ef62abf48de736555cf5840b781aeb9d56', 'fonts/noto-sans-sc-5-wght-normal-EEFC4CFY.woff2': '08f7b17fb6a88382277dfa1b6969f1f0b73a1f87819713849bb9e1ff6017088e', 'fonts/noto-sans-sc-68-wght-normal-TBLVTOFS.woff2': '3ed406ceb43b6f73a6a42ad9e8b2a9aab96fd6603bab5b73a908ca53f0d354a8', 'fonts/noto-sans-sc-77-wght-normal-7NUVLS36.woff2': 'bc249f82f40ec61d6ec096c748603fdb4e946adaf659392b06c6810169e81513', 'fonts/noto-sans-sc-27-wght-normal-C37OSS3L.woff2': '4e0dafaa26d924f5612a138a34a817aa06b8f72bad9798fe64d221fb13001d31', 'fonts/noto-sans-sc-109-wght-normal-BW7S5Q3I.woff2': '85ebc9985c665dd55346ebc78b93f8d8ef6ff972d78afc288b75d697a242d780', 'fonts/noto-sans-sc-91-wght-normal-VKQZJZZN.woff2': '7bf857d9d1285675fe572e64f968ae1f3213da7654ffd335633fb5b39493c057', 'fonts/noto-sans-sc-85-wght-normal-NWY6FLF5.woff2': 'cce97c39b9304c87e55ed84d511d479afd3343b91c04b3ac7bdc5beb9ecf709d', 'fonts/noto-sans-sc-74-wght-normal-VNGNOMNV.woff2': '5c8faf77fe0277b9e59904396fdf3fe24088bcb2decfc5729895b279c53754f6', 'fonts/noto-sans-sc-66-wght-normal-2VJTY5BY.woff2': '50c8a455f282618211dacd6a0a30c1dee510d6d46eea9be79937b24e69cb0353', 'fonts/noto-sans-sc-75-wght-normal-UHRO5E4K.woff2': '216c1c94ee016db46f8d1dc5c51f402215dbf9013fbf9f60f3db3901f9a3b035', 'fonts/noto-sans-sc-41-wght-normal-I7C2PPJN.woff2': '7e2a21f95e969165ff32e2fdab8422b489d2c7b0f899f69bfc83d71872cde2af', 'fonts/noto-sans-sc-36-wght-normal-GJQNTRYG.woff2': '21b841e271833161fe5f70a2052399e79faac029667abdcdffe81f260f2ce6b5', 'fonts/noto-sans-sc-45-wght-normal-S56FZ72T.woff2': 'ea12aaa5635e53eaf7429500be57e9e8a6030e0906f985426412a1303761f77f', 'fonts/noto-sans-sc-55-wght-normal-O5KCTJGK.woff2': '70105493871b782981352a0cf696487afc098a69a4708d87a7931607fe15a128', 'fonts/noto-sans-sc-6-wght-normal-IVJI2BUK.woff2': '675ff09731b49aeff9031c6d8edb3d54766aec64e4c6c699be5766729e4dad98', 'fonts/noto-sans-sc-60-wght-normal-DJYDCBOJ.woff2': '105d09095364787b4eef08ecd4faa975d66ad3ce2be43bb968dd37b9285e6667', 'fonts/noto-sans-sc-78-wght-normal-N6VRU6JU.woff2': '26210c38ccee9b53194481bed1dfc1aa4f74810d5672b2e7ed6a2e44b169835d', 'fonts/noto-sans-sc-52-wght-normal-OEZE7R6C.woff2': 'bf40713c12d0ae841b4cbe9d487724e4ee780fdb84844a96ba8ebae6b79a3191', 'fonts/noto-sans-sc-63-wght-normal-4HT7DHVZ.woff2': '0897654d316342cdf37bb3d16fcf1a51fdcc38fcf1fb39880b5d3f17e87bf7de', 'fonts/noto-sans-sc-100-wght-normal-KYQMGMBO.woff2': '2c5ddf9cdfad73afb5235e06bc8ed3b5c627849200d673978148700c78f84160', 'fonts/noto-sans-sc-23-wght-normal-M3AUALKH.woff2': 'a8f6664d83439cd5d329e9b35a54fb4d9d3786e80d3eaebbaeac24e3acf950fc', 'fonts/noto-sans-sc-29-wght-normal-KTN44OVO.woff2': '67d137f738bc8294a0365f60661e31b33a6e534d56d7e5ed6982d5e6ffa5663c', 'fonts/noto-sans-sc-25-wght-normal-INB37UWS.woff2': '074e6162a8ba4f9cf25881da25ce522bb949c1e2516142746daf85471bc48a9c', 'fonts/noto-sans-sc-43-wght-normal-VFUU6E2U.woff2': 'a98ffa0839e353eb7e768084e27892596616f6a3d8bb65c94202898bccb1fd68', 'fonts/noto-sans-sc-117-wght-normal-PTGGZDVP.woff2': '3d7ced7101c03dfa9bf0e60460a1b91fc6f1166fb33f718506e8110bb12e74a7', 'fonts/noto-sans-sc-102-wght-normal-LFI7463I.woff2': '4ea85e144cb385ce086b21b307730d3fdb70a587aaf350b12d0c4c2f13e66d27', 'fonts/noto-sans-sc-111-wght-normal-PJ6BKDSH.woff2': 'aaa67a70f5e8b351c558e32345093fdfd86f089726b3b86d84b58de6a2475104', 'fonts/noto-sans-sc-114-wght-normal-WWMXAHKB.woff2': 'c49b2eb658a0c2d76de9a279945de30bf32acd8fdd6d56cf84aea9c6b14aacae', 'fonts/noto-sans-sc-vietnamese-wght-normal-R36625AU.woff2': '310e65da63933201c3381173106418442de6441742594001290b4056abbc9ed8', 'fonts/noto-sans-sc-116-wght-normal-KW5FUOYD.woff2': '002e502515bee8b9efa1b17abf7e52b51d4cfa20538ae2b2bd82ac52e1153f5e', 'fonts/noto-sans-sc-61-wght-normal-FOBMM34K.woff2': '21c21d2375925f742573edc50e3bca85a63350bf1d5d566d2d762f8ce2b259d9', 'fonts/noto-sans-sc-119-wght-normal-TF6XL32I.woff2': '09b9fa5a9521fbeccb8267a5abe7443c83cbe25b32eb15b00de316d913235525', 'fonts/noto-sans-sc-35-wght-normal-A3SBVNOQ.woff2': '68413e3f3e5b912efd25702281aae9acb37c9920bb7bb941404506ab520add49', 'fonts/noto-sans-sc-30-wght-normal-GOZBFLN3.woff2': '12acd771479c93c76f064a81447266c349d6a33d2f1893d5413c6303b1156fef', 'vendor/ethers.js': 'b016b0c3898c78fd8156466eb1ff1f42c9df951c2f0d64c9bdf799fe745b0a6c', 'vendor/walletconnect.js': '7db67e1a3c4f79ce9067b6f858be663b9ac8a482ac5c8c09ad49ef374b78278a', 'vendor/walletconnect.js.LEGAL.txt': '0df4d6aadb8d044c2c292fedf68aeb66b6506cf1bce5dee0ccb35e7193dcf0d1'}
EXPECTED_CONFIG = {'chainId': 56, 'mode': 'bnb-mainnet', 'sourceRevision': 'ba82373a83d63fba0643332371cfb6d62903c849', 'sourceFingerprint': 'eaf50289e56998959303757f443b80d38caa7002427f4a5b126f5b00dee3e934', 'mainnetPlanDigest': '0ec3a7d93f5e1225cbd4f5671f4ee6b92423718898f1734c42390337467f7480', 'binary': '0x13aC3Af4FE3e72DccfFd52AB67E4d884B6D97dF9', 'token': '0x43755B1E813b2d41F669ea08bcf859De07195eA1', 'usd': '0x55d398326f99059fF775485246999027B3197955', 'council': '0x85F567C2c59e766847D9dC18328C3B54cDf80DE4', 'timelock': '0xcf3eCA1E96db99E478e81C79f2Ae03dEec80CA86'}
PROTECTED = ('web/app.js', 'web/vendor/walletconnect.js', 'scripts/server.mjs')
# BEGIN EMBEDDED RELEASE
RELEASE = None
# END EMBEDDED RELEASE


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def child(root, name):
    require(name and not Path(name).is_absolute() and '..' not in Path(name).parts,
            'Unsafe asset path')
    target = root
    for part in Path(name).parts:
        target /= part
        require(not target.is_symlink(), 'Symlink path rejected: ' + name)
    return target


def regular(file, limit=16_000_000):
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= limit,
                'Expected bounded regular file: ' + str(file))
        with os.fdopen(os.dup(fd), 'rb') as stream:
            data = stream.read(limit + 1)
        require(len(data) <= limit, 'File too large')
        return data, info
    finally:
        os.close(fd)


def save_new(file, data, mode=0o600):
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        os.fchmod(stream.fileno(), mode)
        stream.flush()
        os.fsync(stream.fileno())


def replace(file, data, info):
    fd, temporary = tempfile.mkstemp(prefix='.fti-hash-ui-', dir=file.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            os.fchmod(stream.fileno(), stat.S_IMODE(info.st_mode))
            if os.geteuid() == 0:
                os.fchown(stream.fileno(), info.st_uid, info.st_gid)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, file)
        directory = os.open(file.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def fetch(url, limit=16_000_000):
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *_):
            raise RuntimeError('Unexpected HTTP redirect')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(url, headers={'Cache-Control': 'no-cache',
                                                  'User-Agent': 'FTI-Transaction-Hash-UI/1'})
    with opener.open(request, timeout=25) as response:
        require(response.status == 200, 'Unexpected HTTP status')
        data = response.read(limit + 1)
        require(len(data) <= limit, 'HTTP response too large')
        return data


def properties():
    result = subprocess.check_output(['systemctl', 'show', SERVICE,
        '--property=LoadState,ActiveState,SubState,User,Group,WorkingDirectory,MainPID'],
        text=True, timeout=10)
    return dict(line.split('=', 1) for line in result.splitlines() if '=' in line)


def check_service(saved):
    require(saved.get('LoadState') == 'loaded' and saved.get('ActiveState') == 'active' and
            saved.get('SubState') == 'running' and
            saved.get('User') == saved.get('Group') == 'fti-v3' and
            int(saved.get('MainPID', '0')) > 1, 'Expected the active FTI web service')
    root = Path(saved['WorkingDirectory'])
    require(root.parent == RELEASES and root.resolve() == root and root.is_dir(),
            'Unexpected running release')
    return root


def check_web(base):
    health = json.loads(fetch(base + '/health'))
    require(health.get('ok') is True and health.get('chainId') == 56,
            'Mainnet web health unavailable; no UI switch permitted')
    cfg = json.loads(fetch(base + '/api/config'))
    for key, expected in EXPECTED_CONFIG.items():
        require(cfg.get(key) == expected, 'Wrong mainnet deployment: ' + key)
    require(cfg.get('poolDistributionVersion') == 1 and cfg.get('hourlyCapFlushVersion') == 1,
            'Wrong mainnet pool configuration')


def release_assets(release):
    require(isinstance(release, dict) and release.get('schema') == 'FTI_TRANSACTION_HASH_UI_V1',
            'This source template must be packaged before installation')
    require(re.fullmatch(r'[a-f0-9]{64}', str(release.get('appSHA256', ''))) is not None,
            'Invalid app checksum')
    compressed = base64.b64decode(release['appGzipBase64'], validate=True)
    require(len(compressed) <= 4_000_000, 'Compressed app is too large')
    # Decompress with an explicit output bound even if a packaged file is damaged.
    import io
    with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
        app = stream.read(4_000_001)
    require(len(app) <= 4_000_000 and sha(app) == release['appSHA256'], 'Packaged app checksum mismatch')
    require(release['appSHA256'] != BASE_ASSETS['app.js'], 'Packaged app must differ from the base UI')
    assets = dict(BASE_ASSETS, **{'app.js': sha(app)})
    prefix = 'fti-mainnet-ui-' + sha(json.dumps(assets, sort_keys=True).encode())[:16]
    require(release.get('prefix') == prefix, 'Packaged UI prefix mismatch')
    return assets, app, prefix


def render(before, old, new):
    text = before.decode()
    require(re.fullmatch(r'fti-mainnet-ui-[a-f0-9]{16}', old) and
            re.fullmatch(r'fti-mainnet-ui-[a-f0-9]{16}', new), 'Invalid UI prefix')
    for attribute, name in [('src', 'app.js'), *[('href', x) for x in
            ('style.css', 'member-landing-theme.css', 'global-interface.css', 'panel-identity.css')]]:
        original = attribute + '="/' + old + '/' + name + '"'
        require(text.count(original) == 1, 'Unexpected installed asset URL: ' + name)
        text = text.replace(original, attribute + '="/' + new + '/' + name + '"')
    require('/' + old + '/' not in text, 'Unexpected remaining old UI URL')
    return text.encode()


def read_assets(root, prefix, expected):
    result = {}
    for name, digest in expected.items():
        data = regular(child(root, 'web/' + prefix + '/' + name))[0]
        require(sha(data) == digest, 'Installed asset differs: ' + name)
        result[name] = data
    return result


def verify_served(html, prefix, expected):
    # Verify entry points through both paths and every versioned asset publicly.
    for base in (LOCAL, PUBLIC):
        for route in ('/app/', '/token/', '/admin/'):
            require(fetch(base + route) == html, 'Served HTML mismatch: ' + route)
    for name, digest in expected.items():
        require(sha(fetch(PUBLIC + '/' + prefix + '/' + name)) == digest,
                'Served asset differs: ' + name)
    check_web(LOCAL)
    check_web(PUBLIC)


def private_backups():
    require(not BACKUPS.is_symlink(), 'Unexpected backup directory')
    BACKUPS.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = BACKUPS.stat()
    require(info.st_uid == 0 and not info.st_mode & 0o077, 'Private root-owned backup directory required')


def restore(backup):
    require(backup.parent == BACKUPS and backup.resolve() == backup and backup.is_dir(),
            'Unexpected backup path')
    record = json.loads(regular(child(backup, 'record.json'))[0])
    root = Path(record['root'])
    require(check_service(properties()) == root, 'Web release changed; preserve concurrent deployment')
    target = child(root, 'web/index.html')
    current, info = regular(target)
    require(sha(current) == record['after'], 'HTML changed concurrently; preserve operator edit')
    before = regular(child(backup, 'before.html'))[0]
    require(sha(before) == record['before'], 'Backup HTML checksum mismatch')
    replace(target, before, info)
    require(fetch(LOCAL + '/app/') == before, 'Restored HTML verification failed')
    print('FTI_TRANSACTION_HASH_UI_RESTORED', flush=True)


def apply(release):
    assets, app, prefix = release_assets(release)
    saved = properties()
    root = check_service(saved)
    check_web(LOCAL)
    check_web(PUBLIC)
    target = child(root, 'web/index.html')
    before, info = regular(target)
    if ('src="/' + prefix + '/app.js"').encode() in before:
        read_assets(root, prefix, assets)
        verify_served(before, prefix, assets)
        require(properties() == saved, 'Web process changed during verification')
        print('FTI_TRANSACTION_HASH_UI_ALREADY_INSTALLED', flush=True)
        return
    after = render(before, BASE_PREFIX, prefix)
    content = read_assets(root, BASE_PREFIX, BASE_ASSETS)
    content['app.js'] = app
    protected = {name: sha(regular(child(root, name))[0]) for name in PROTECTED}
    space = os.statvfs(root)
    needed = sum(map(len, content.values())) + len(app) * 2 + 16 * 1024 * 1024
    require(space.f_bavail * space.f_frsize >= needed and space.f_favail > len(assets) + 32,
            'Insufficient free space or inodes; no files removed')
    private_backups()
    backup = Path(tempfile.mkdtemp(prefix='install-', dir=BACKUPS))
    record = {'root': str(root), 'before': sha(before), 'after': sha(after), 'prefix': prefix,
              'protected': protected, 'basePrefix': BASE_PREFIX}
    save_new(backup / 'before.html', before)
    save_new(backup / 'record.json', json.dumps(record, sort_keys=True).encode())
    installer = regular(Path(__file__).resolve(), 8_000_000)[0]
    save_new(backup / 'installer.py', installer)
    print('ROLLBACK_COMMAND=python3 ' + str(backup / 'installer.py') + ' --restore ' + str(backup), flush=True)
    destination = child(root, 'web/' + prefix)
    destination.mkdir(mode=0o755, exist_ok=True)
    destination.chmod(0o755)
    for name, data in content.items():
        file = child(destination, name)
        file.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        file.parent.chmod(0o755)
        if file.exists():
            require(regular(file)[0] == data, 'Versioned asset already differs: ' + name)
        else:
            save_new(file, data, 0o644)
        require(sha(fetch(PUBLIC + '/' + prefix + '/' + name)) == assets[name],
                'New asset not reachable: ' + name)
    changed = False
    try:
        require(properties() == saved, 'Web process changed during preparation')
        require(regular(target)[0] == before, 'Concurrent HTML edit')
        for name, expected in protected.items():
            require(sha(regular(child(root, name))[0]) == expected, 'Protected runtime changed: ' + name)
        replace(target, after, info)
        changed = True
        verify_served(after, prefix, assets)
        require(properties() == saved, 'Web process changed after UI switch')
        for name, expected in protected.items():
            require(sha(regular(child(root, name))[0]) == expected, 'Protected runtime changed: ' + name)
    except BaseException:
        if changed:
            restore(backup)
        raise
    print(json.dumps({'result': 'FTI_TRANSACTION_HASH_UI_INSTALLED', 'chainId': 56,
        'backup': str(backup), 'frontendBundle': prefix, 'contractsChanged': False,
        'keeperActivated': False, 'serviceRestarted': False}), flush=True)


def package(root, output):
    app = regular(child(root, 'web/app.js'), 4_000_000)[0]
    assets = dict(BASE_ASSETS, **{'app.js': sha(app)})
    release = {'schema': 'FTI_TRANSACTION_HASH_UI_V1', 'appSHA256': sha(app),
        'appGzipBase64': base64.b64encode(gzip.compress(app, mtime=0)).decode(),
        'prefix': 'fti-mainnet-ui-' + sha(json.dumps(assets, sort_keys=True).encode())[:16]}
    release_assets(release)
    source = regular(Path(__file__).resolve(), 8_000_000)[0].decode()
    pattern = r'(# BEGIN EMBEDDED RELEASE\n).*?(\n# END EMBEDDED RELEASE)'
    text, count = re.subn(pattern, lambda m: m[1] + 'RELEASE = json.loads(' +
                         repr(json.dumps(release, sort_keys=True)) + ')' + m[2], source,
                         flags=re.S)
    require(count == 1, 'Package marker mismatch')
    save_new(output, text.encode(), 0o644)
    print(json.dumps({'installer': str(output), 'sha256': sha(text.encode()),
                      'appSHA256': sha(app), 'prefix': release['prefix']}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group()
    action.add_argument('--package', type=Path)
    action.add_argument('--restore', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.package:
        require(args.output is not None, '--package requires --output')
        package(args.package.resolve(), args.output)
        return
    require(args.output is None, '--output requires --package')
    require(os.geteuid() == 0, 'Run this packaged installer on the FTI VPS as root')
    os.umask(0o077)
    with open('/run/lock/fti-service-cutover.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        def interrupted(*_):
            raise RuntimeError('Interrupted')
        signal.signal(signal.SIGTERM, interrupted)
        signal.signal(signal.SIGHUP, interrupted)
        if args.restore:
            restore(args.restore)
        else:
            apply(RELEASE)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('FTI_TRANSACTION_HASH_UI_STOPPED: ' + str(error), file=sys.stderr)
        sys.exit(1)
