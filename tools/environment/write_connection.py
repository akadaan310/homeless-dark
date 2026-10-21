#!/usr/bin/env python3
"""Write private Unity connection configuration without echoing credentials."""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--token-file', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--url', default='http://127.0.0.1:8765')
    args = parser.parse_args()
    try:
        uri = urlsplit(args.url)
        loopback = uri.hostname == 'localhost'
        try:
            loopback = loopback or ipaddress.ip_address(uri.hostname).is_loopback
        except ValueError:
            pass
        if (uri.scheme not in ('http', 'https') or not uri.hostname or uri.username is not None
                or uri.password is not None or uri.path not in ('', '/') or uri.query or uri.fragment
                or uri.scheme == 'http' and not loopback):
            raise ValueError('HTTPS origin or explicit loopback origin required')
        _ = uri.port  # Reject malformed port before creating a private file.
        if args.token_file.stat().st_size > 4096:
            raise ValueError('token file too large')
        token = args.token_file.read_text(encoding='utf-8').strip()
        if not re.fullmatch(r'[A-Za-z0-9_-]{32,256}', token):
            raise ValueError('credential format refused')
        args.output.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(args.output, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, 'w') as stream:
            stream.write(json.dumps({'url': args.url.rstrip('/'), 'token': token}) + '\n')
        print(json.dumps({'status': 'CREATED', 'private_file': str(args.output.resolve())}))
        return 0
    except (OSError, ValueError, UnicodeError, TypeError) as error:
        print(json.dumps({'status': 'REFUSED', 'kind': type(error).__name__}))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
