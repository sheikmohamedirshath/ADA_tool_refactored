"""URL validation and SSRF protection utilities."""
from urllib.parse import urlparse
import socket
import ipaddress


_BLOCKED_NETWORKS = [
    ipaddress.ip_network('127.0.0.0/8'),
    ipaddress.ip_network('10.0.0.0/8'),
    ipaddress.ip_network('172.16.0.0/12'),
    ipaddress.ip_network('192.168.0.0/16'),
    ipaddress.ip_network('169.254.0.0/16'),
    ipaddress.ip_network('::1/128'),
    ipaddress.ip_network('fc00::/7'),
    ipaddress.ip_network('fe80::/10'),
]


class URLValidationError(ValueError):
    pass


def validate_url_for_scan(url: str) -> str:
    """Validate a URL is safe to fetch from the server for scanning.

    Returns the stripped URL on success.
    Raises URLValidationError on invalid or disallowed URLs.
    """
    if not url or not url.strip():
        raise URLValidationError('URL is required')
    url = url.strip()
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https'):
        raise URLValidationError('Only http and https schemes are allowed')
    if parsed.username or parsed.password:
        raise URLValidationError('URLs containing credentials are not allowed')
    host = parsed.hostname
    if not host:
        raise URLValidationError('URL must include a hostname')

    # Resolve DNS and check every returned address against the blocked ranges.
    # Checking resolved IPs (not just the raw hostname string) prevents bypasses
    # via alternative representations like 0x7f000001 or 127.1.
    try:
        infos = socket.getaddrinfo(host, parsed.port or 80, proto=socket.IPPROTO_TCP)
    except Exception as e:
        raise URLValidationError(f'Failed to resolve hostname: {e}')

    resolved_ips = set()
    for fam, socktype, proto, canonname, sa in infos:
        resolved_ips.add(sa[0])

    for ip in resolved_ips:
        try:
            addr = ipaddress.ip_address(ip)
        except Exception:
            continue
        for net in _BLOCKED_NETWORKS:
            if addr in net:
                raise URLValidationError('Refusing to scan private or loopback network addresses')

    return url
