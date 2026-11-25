"""One plain-language dictionary and money-unit bounds for all clients."""
import json
from pathlib import Path

DATA = json.loads(Path(__file__).with_name('financial_terms.json').read_text())
TERMS = DATA['terms']
MAX_PORTFOLIO_MILLIONS = DATA['limits']['portfolio_millions']
MAX_SPENDING_THOUSANDS = DATA['limits']['spending_thousands']
