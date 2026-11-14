# SPDX-FileCopyrightText: 2026 Leon Manuel Töpper
# SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0

import os
from urllib.parse import urlsplit

from . import brand

ENV_NAME = 'HORA_ACCOUNT_SERVICE'
DEFAULT_PORTS = {'http': 80, 'https': 443}


def service_origin(value=None):
    """The origin of the account service, or None to keep the account core off.

    Without HORA_ACCOUNT_SERVICE it is the service in brand/brand.json. The variable overrides it, and an
    empty value, `off` or anything else that is not a bare http or https origin switches accounts off.
    """
    if value is None:
        value = os.environ.get(ENV_NAME, brand.ACCOUNT_SERVICE)
    text = value.strip()
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
