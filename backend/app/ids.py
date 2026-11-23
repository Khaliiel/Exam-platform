import secrets

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no I, O, 0, 1


def make_code(prefix: str) -> str:
    """e.g. REC26-8492-K7M  (~295M combinations per prefix)"""
    return f"{prefix}-{secrets.randbelow(9000) + 1000}-" + "".join(secrets.choice(ALPHABET) for _ in range(3))


def normalize(code: str) -> str:
    return "".join(code.split()).upper()
