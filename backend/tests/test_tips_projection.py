"""Tax tips consume the interest projection, not ORM loan rows."""
import pytest

from tests.conftest import register_user


@pytest.mark.parametrize('deduct', [False, True])
def test_tips_with_multiple_loans_use_projected_interest(client, monkeypatch, deduct):
    from app.routers import tips
    register_user(client)
    assert client.post('/api/grants', json={
        'year': 2026, 'type': 'Purchase', 'shares': 10000, 'price': 10,
        'exercise_date': '2026-01-01', 'vest_start': '2030-01-01',
        'periods': 4, 'dp_shares': 0, 'election_83b': True,
    }).status_code == 201
    for year, price in [(2026, 10), (2030, 30)]:
        assert client.post('/api/prices', json={
            'effective_date': f'{year}-01-01', 'price': price,
        }).status_code == 201
    for kind, amount in [('Purchase', 50000), ('Interest', 10000)]:
        assert client.post('/api/loans?generate_payoff_sale=false', json={
            'grant_year': 2026, 'grant_type': 'Purchase', 'loan_type': kind,
            'loan_year': 2026, 'amount': amount, 'interest_rate': 0.05,
            'due_date': '2033-06-30',
        }).status_code == 201
    assert client.put('/api/tax-settings', json={
        'deduct_investment_interest': deduct, 'projected_loan_rate': 0.08,
    }).status_code == 200
    pools = []
    apply = tips._apply_interest_deduction

    def capture(events, pool, **kwargs):
        pools.append(pool)
        return apply(events, pool, **kwargs)

    monkeypatch.setattr(tips, '_apply_interest_deduction', capture)
    response = client.get('/api/tips')
    assert response.status_code == 200, response.text
    assert isinstance(response.json(), list)
    assert pools
    assert all(isinstance(pool, dict) for pool in pools)
    assert all(sum(pool.values()) > 10000 for pool in pools)
    assert all(pool == pools[0] for pool in pools)
