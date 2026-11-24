"""Score de-identified pilot attempts; no account data or participant IDs.

Input is a JSON array in observation order. Retries are explicitly marked and
excluded from first-attempt conversion rates. Output contains aggregate counts.
"""
import argparse
import json
from pathlib import Path

FIELDS = frozenset({'retry', 'coached', 'seconds', 'accurate', 'valid_files',
                    'reconciled', 'saved', 'reminders', 'returned', 'blocker'})
BOOL_FIELDS = FIELDS - {'seconds'}


def score(attempts):
    if not isinstance(attempts, list) or not 1 <= len(attempts) <= 200:
        raise ValueError('Supply 1–200 attempts.')
    for row in attempts:
        if not isinstance(row, dict) or set(row) != FIELDS:
            raise ValueError('Use exactly the documented observation fields; no identifiers or free text.')
        if any(type(row[k]) is not bool for k in BOOL_FIELDS):
            raise ValueError('Observation flags must be booleans.')
        if type(row['seconds']) is not int or not 0 <= row['seconds'] <= 86400:
            raise ValueError('Elapsed seconds must be an integer from 0 to 86400.')
        if row['accurate'] and not row['reconciled']:
            raise ValueError('Accuracy requires independently reconciled source evidence.')
    # An attempt that needed coaching remains in the denominator, as a failure.
    first = [r for r in attempts if not r['retry']]
    starts = len(first)
    successes = sum(r['accurate'] and not r['coached'] and r['seconds'] <= 300 for r in first)
    blockers = sum(r['blocker'] for r in attempts)
    return {
        'import_starts': starts,
        'retries': len(attempts) - starts,
        'accurate_within_five_minutes': successes,
        'accurate_within_five_minutes_rate': successes / starts if starts else None,
        'stages': {k: sum(r[k] for r in first) for k in
                   ('valid_files', 'reconciled', 'saved', 'reminders', 'returned')},
        'blockers': blockers,
        'pilot_threshold_met': starts >= 10 and successes * 100 >= starts * 85 and blockers == 0,
        'rollout_approved': False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('observations', type=Path)
    args = parser.parse_args()
    try:
        result = score(json.loads(args.observations.read_text()))
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
