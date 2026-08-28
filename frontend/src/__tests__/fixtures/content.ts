// Matches the seeded Epic values in backend/app/content_service.py.
export const MOCK_CONTENT = {
  grant_templates: [
    { year: 2018, type: 'Purchase', vest_start: '2020-06-15', periods: 6, exercise_date: '2018-12-31', default_catch_up: true,  show_dp_shares: false, default_purchase_due_date: '2025-07-15', default_tax_due_date: null },
    { year: 2019, type: 'Purchase', vest_start: '2021-06-15', periods: 6, exercise_date: '2019-12-31', default_catch_up: true,  show_dp_shares: false, default_purchase_due_date: '2026-07-15', default_tax_due_date: null },
    { year: 2020, type: 'Purchase', vest_start: '2021-09-30', periods: 5, exercise_date: '2020-12-31', default_catch_up: true,  show_dp_shares: false, default_purchase_due_date: '2025-07-15', default_tax_due_date: null },
    { year: 2020, type: 'Bonus',    vest_start: '2021-09-30', periods: 4, exercise_date: '2020-12-31', default_catch_up: false, show_dp_shares: false, default_purchase_due_date: null,         default_tax_due_date: '2025-07-15' },
    { year: 2021, type: 'Purchase', vest_start: '2022-09-30', periods: 5, exercise_date: '2021-12-31', default_catch_up: true,  show_dp_shares: false, default_purchase_due_date: '2030-07-15', default_tax_due_date: null },
    { year: 2021, type: 'Bonus',    vest_start: '2022-09-30', periods: 3, exercise_date: '2021-12-31', default_catch_up: false, show_dp_shares: false, default_purchase_due_date: null,         default_tax_due_date: null },
    { year: 2022, type: 'Purchase', vest_start: '2023-09-30', periods: 4, exercise_date: '2022-12-31', default_catch_up: false, show_dp_shares: false, default_purchase_due_date: '2031-06-30', default_tax_due_date: null },
    { year: 2022, type: 'Bonus',    vest_start: '2023-09-30', periods: 3, exercise_date: '2022-12-31', default_catch_up: false, show_dp_shares: false, default_purchase_due_date: null,         default_tax_due_date: null },
    { year: 2022, type: 'Free',     vest_start: '2027-09-30', periods: 1, exercise_date: '2022-12-31', default_catch_up: false, show_dp_shares: false, default_purchase_due_date: null,         default_tax_due_date: '2031-06-30' },
    { year: 2023, type: 'Purchase', vest_start: '2024-09-30', periods: 4, exercise_date: '2023-12-31', default_catch_up: false, show_dp_shares: true,  default_purchase_due_date: '2032-06-30', default_tax_due_date: null },
    { year: 2023, type: 'Bonus',    vest_start: '2024-09-30', periods: 3, exercise_date: '2023-12-31', default_catch_up: false, show_dp_shares: false, default_purchase_due_date: null,         default_tax_due_date: null },
    { year: 2024, type: 'Purchase', vest_start: '2025-09-30', periods: 4, exercise_date: '2024-12-31', default_catch_up: false, show_dp_shares: true,  default_purchase_due_date: '2033-06-30', default_tax_due_date: null },
    { year: 2024, type: 'Bonus',    vest_start: '2025-09-30', periods: 3, exercise_date: '2024-12-31', default_catch_up: false, show_dp_shares: false, default_purchase_due_date: null,         default_tax_due_date: null },
    { year: 2025, type: 'Purchase', vest_start: '2026-09-30', periods: 4, exercise_date: '2025-12-31', default_catch_up: false, show_dp_shares: true,  default_purchase_due_date: '2034-06-30', default_tax_due_date: null },
    { year: 2025, type: 'Bonus',    vest_start: '2026-09-30', periods: 3, exercise_date: '2025-12-31', default_catch_up: false, show_dp_shares: false, default_purchase_due_date: null,         default_tax_due_date: null },
  ],
  bonus_schedule_variants: [
    { grant_year: 2020, grant_type: 'Bonus', variant_code: 'A', periods: 2, label: 'A (2 years)', is_default: false },
    { grant_year: 2020, grant_type: 'Bonus', variant_code: 'B', periods: 3, label: 'B (3 years)', is_default: false },
    { grant_year: 2020, grant_type: 'Bonus', variant_code: 'C', periods: 4, label: 'C (4 years)', is_default: true  },
  ],
  loan_rates: {
    interest: { '2020': 0.0086, '2021': 0.0091, '2022': 0.0328, '2023': 0.0437, '2024': 0.037, '2025': 0.0379 },
    tax: {
      'Catch-Up': { '2021': 0.0086, '2022': 0.0187, '2023': 0.0356, '2024': 0.043, '2025': 0.0407 },
      'Bonus':    { '2021': 0.0086, '2022': 0.0293, '2023': 0.0385, '2024': 0.037 },
    },
    purchase_original: {
      '2018': { rate: 0.0307, due_date: '2025-07-15' },
      '2019': { rate: 0.0307, due_date: '2026-07-15' },
      '2020': { rate: 0.0038, due_date: '2025-07-15' },
      '2021': { rate: 0.0086, due_date: '2030-07-15' },
      '2022': { rate: 0.0187, due_date: '2031-06-30' },
      '2023': { rate: 0.0356, due_date: '2032-06-30' },
      '2024': { rate: 0.037,  due_date: '2033-06-30' },
      '2025': { rate: 0.0406, due_date: '2034-06-30' },
    },
  },
  loan_refinances: {
    purchase: {
      '2018': [
        { date: '2020-01-01', rate: 0.0169, loan_year: 2020, due_date: '2025-07-15' },
        { date: '2020-06-01', rate: 0.0043, loan_year: 2020, due_date: '2025-07-15' },
        { date: '2021-11-01', rate: 0.0086, loan_year: 2021, due_date: '2027-07-15' },
      ],
      '2019': [
        { date: '2020-06-01', rate: 0.0043, loan_year: 2020, due_date: '2026-07-15' },
        { date: '2021-11-01', rate: 0.0086, loan_year: 2021, due_date: '2028-07-15' },
      ],
      '2020': [
        { date: '2021-11-01', rate: 0.0086, loan_year: 2021, due_date: '2029-07-15' },
      ],
    },
    tax: {
      '2020-Bonus-2021': [
        { date: '2021-11-01', rate: 0.0086, loan_year: 2021, due_date: '2029-07-15', orig_due_date: '2024-07-15' },
      ],
    },
  },
  grant_program_settings: {
    tax_fallback_federal: 0.37,
    tax_fallback_state: 0.0765,
    dp_min_percent: 0.10,
    dp_min_cap: 20000,
    price_years_start: 2018,
    price_years_end: 2026,
  },
}
