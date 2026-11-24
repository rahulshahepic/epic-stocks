"""Pilot scoring cannot turn retries, coaching or unchecked evidence into success."""
import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location('pilot', Path(__file__).resolve().parents[2] / 'ops/score_first_use_pilot.py')
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)


def attempt(**overrides):
    return {**dict.fromkeys(pilot.BOOL_FIELDS, False), 'seconds': 200,
            'accurate': True, 'reconciled': True, **overrides}


def test_retries_and_coaching_cannot_improve_the_first_attempt_denominator():
    result = pilot.score([attempt() for _ in range(8)] + [attempt(coached=True), attempt(accurate=False)] + [attempt(retry=True)])
    assert result['import_starts'] == 10
    assert result['retries'] == 1
    assert result['accurate_within_five_minutes_rate'] == .8
    assert not result['pilot_threshold_met']


def test_blockers_and_small_samples_prevent_a_pass():
    assert not pilot.score([attempt()])['pilot_threshold_met']
    assert not pilot.score([attempt() for _ in range(10)] + [attempt(retry=True, blocker=True)])['pilot_threshold_met']
    result = pilot.score([attempt() for _ in range(9)] + [attempt(seconds=301)])
    assert result['pilot_threshold_met']
    assert result['rollout_approved'] is False


@pytest.mark.parametrize('rows', [[], [attempt(email='forbidden')], [attempt(seconds=True)],
                                  [attempt(seconds=-1)], [attempt(reconciled=False)], [attempt(saved='yes')]])
def test_reject_identifiers_and_invalid_or_unverified_observations(rows):
    with pytest.raises(ValueError):
        pilot.score(rows)
