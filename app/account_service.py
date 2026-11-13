# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import os
from urllib.parse import urlsplit

ENV_NAME = 'HORA_ACCOUNT_SERVICE'
DEFAULT_PORTS = {'http': 80, 'https': 443}


def service_origin(value=None):
    """The origin of the account service from HORA_ACCOUNT_SERVICE, or None. Without one the account core stays off."""
    text = (os.environ.get(ENV_NAME, '') if value is None else value).strip()
    if not text:
        return None
    try:
        parts = urlsplit(text)
        port = parts.port
    except ValueError:
        return None
    if parts.scheme not in DEFAULT_PORTS or not parts.hostname or parts.username or parts.password:
        return None
    if parts.path not in ('', '/') or parts.query or parts.fragment:
        return None
    host = f'[{parts.hostname}]' if ':' in parts.hostname else parts.hostname
    return f'{parts.scheme}://{host}' + (f':{port}' if port and port != DEFAULT_PORTS[parts.scheme] else '')
