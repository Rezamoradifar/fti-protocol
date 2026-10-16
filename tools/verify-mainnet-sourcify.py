#!/usr/bin/env python3
"""Submit public source verification or poll saved jobs. Never sends transactions."""
import argparse
import json
from pathlib import Path
import urllib.error
import urllib.request

BASE = 'https://sourcify.dev/server'


def request(route, body=None):
    req = urllib.request.Request(BASE + route,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Content-Type': 'application/json', 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--submit', action='store_true')
    args = parser.parse_args()
    jobs = json.loads((args.directory / 'jobs.json').read_text())
    source = json.loads((args.directory / 'standard-input.json').read_text())
    for job in jobs:
        record_path = args.directory / (job['key'] + '-sourcify.json')
        if args.submit:
            if record_path.exists():
                print(job['key'], 'SAVED_REQUEST_EXISTS; poll first')
                continue
            body = {key: job[key] for key in ('compilerVersion', 'contractIdentifier', 'creationTransactionHash')}
            body['stdJsonInput'] = source
            # An intent marker makes a transport failure explicit instead of silently resubmitting.
            record_path.write_text(json.dumps({'state': 'SUBMISSION_STARTED', 'address': job['address']}))
            code, result = request('/v2/verify/56/' + job['address'], body)
            record_path.write_text(json.dumps({'httpStatus': code, 'response': result}, indent=2))
        else:
            saved = json.loads(record_path.read_text()) if record_path.exists() else {}
            ticket = saved.get('response', {}).get('verificationId')
            route = '/v2/verify/' + ticket if ticket else '/v2/contract/56/' + job['address']
            code, result = request(route)
            (args.directory / (job['key'] + '-status.json')).write_text(json.dumps(result, indent=2))
        print(json.dumps({'contract': job['key'], 'httpStatus': code, 'response': result}), flush=True)


if __name__ == '__main__':
    main()
