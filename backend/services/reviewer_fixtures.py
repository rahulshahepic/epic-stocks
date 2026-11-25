"""Application-supplied fictional fixture provider; authentication owns no financial model."""
_seed = None
scenarios = ()
version = None


def configure(seed, profiles, fixture_version):
    global _seed, scenarios, version
    _seed, scenarios, version = seed, tuple(profiles), fixture_version


def seed(db, user, scenario):
    if _seed is None:
        raise ValueError('Fictional fixture provider is unavailable')
    _seed(db, user, scenario)
