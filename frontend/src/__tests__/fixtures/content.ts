import type { ContentBlob } from '../../api.ts'

// Matches the seeded Epic values in backend/app/content_service.py.
// Typed as ContentBlob here rather than cast at each use, so the fixture is
// checked against the real API shape instead of asserted to match it.
export const MOCK_CONTENT: ContentBlob = {
  grant_templates: [
    { id: 1, display_order: 0, year: 2018, type: 'Purchase', vest_start: '2020-06-15', periods: 6, exercise_date: '2018-12-31', default_catch_up: true,  show_dp_shares: false, default_purchase_due_date: '2025-07-15', default_tax_due_date: null },
    { id: 2, display_order: 1, year: 2019, type: 'Purchase', vest_start: '2021-06-15', periods: 6, exercise_date: '2019-12-31', default_catch_up: true,  show_dp_shares: false, default_purchase_due_date: '2026-07-15', default_tax_due_date: null },
    { id: 3, display_order: 2, year: 2020, type: 'Purchase', vest_start: '2021-09-30', periods: 5, exercise_date: '2020-12-31', default_catch_up: true,  show_dp_shares: false, default_purchase_due_date: '2025-07-15', default_tax_due_date: null },
    { id: 4, display_order: 3, year: 2020, type: 'Bonus',    vest_start: '2021-09-30', periods: 4, exercise_date: '2020-12-31', default_catch_up: false, show_dp_shares: false, default_purchase_due_date: null,         default_tax_due_date: '2025-07-15' },
    { id: 5, display_order: 4, year: 2020, type: 'Developer Bonus Shares', vest_start: '2022-09-30', periods: 5, exercise_date: '2020-12-31', default_catch_up: false, show_dp_shares: false, default_purchase_due_date: null, default_tax_due_date: null },
    { id: 6, display_order: 5, year: 2021, type: 'Purchase', vest_start: '2022-09-30', periods: 5, exercise_date: '2021-12-31', default_catch_up: true,  show_dp_shares: false, default_purchase_due_date: '2030-07-15', default_tax_due_date: null },
    { id: 7, display_order: 6, year: 2021, type: 'Bonus',    vest_start: '2022-09-30', periods: 3, exercise_date: '2021-12-31', default_catch_up: false, show_dp_shares: false, default_purchase_due_date: null,         default_tax_due_date: null },
    { id: 8, display_order: 7, year: 2021, type: 'Developer Bonus Shares', vest_start: '2022-09-30', periods: 5, exercise_date: '2021-12-31', default_catch_up: false, show_dp_shares: false, default_purchase_due_date: null, default_tax_due_date: null },
    { id: 9, display_order: 8, year: 2022, type: 'Purchase', vest_start: '2023-09-30', periods: 4, exercise_date: '2022-12-31', default_catch_up: false, show_dp_shares: false, default_purchase_due_date: '2031-06-30', default_tax_due_date: null },
    { id: 10, display_order: 9, year: 2022, type: 'Bonus',    vest_start: '2023-09-30', periods: 3, exercise_date: '2022-12-31', default_catch_up: false, show_dp_shares: false, default_purchase_due_date: null,         default_tax_due_date: null },
    { id: 11, display_order: 10, year: 2022, type: 'Free',     vest_start: '2027-09-30', periods: 1, exercise_date: '2022-12-31', default_catch_up: false, show_dp_shares: false, default_purchase_due_date: null,         default_tax_due_date: '2031-06-30' },
    { id: 12, display_order: 11, year: 2023, type: 'Purchase', vest_start: '2024-09-30', periods: 4, exercise_date: '2023-12-31', default_catch_up: false, show_dp_shares: true,  default_purchase_due_date: '2032-06-30', default_tax_due_date: null },
    { id: 13, display_order: 12, year: 2023, type: 'Bonus',    vest_start: '2024-09-30', periods: 3, exercise_date: '2023-12-31', default_catch_up: false, show_dp_shares: false, default_purchase_due_date: null,         default_tax_due_date: null },
    { id: 14, display_order: 13, year: 2024, type: 'Purchase', vest_start: '2025-09-30', periods: 4, exercise_date: '2024-12-31', default_catch_up: false, show_dp_shares: true,  default_purchase_due_date: '2033-06-30', default_tax_due_date: null },
    { id: 15, display_order: 14, year: 2024, type: 'Bonus',    vest_start: '2025-09-30', periods: 3, exercise_date: '2024-12-31', default_catch_up: false, show_dp_shares: false, default_purchase_due_date: null,         default_tax_due_date: null },
    { id: 16, display_order: 15, year: 2025, type: 'Purchase', vest_start: '2026-09-30', periods: 4, exercise_date: '2025-12-31', default_catch_up: false, show_dp_shares: true,  default_purchase_due_date: '2034-06-30', default_tax_due_date: null },
    { id: 17, display_order: 16, year: 2025, type: 'Bonus',    vest_start: '2026-09-30', periods: 3, exercise_date: '2025-12-31', default_catch_up: false, show_dp_shares: false, default_purchase_due_date: null,         default_tax_due_date: null },
  ],
  bonus_schedule_variants: [
    { id: 1, grant_year: 2020, grant_type: 'Bonus', variant_code: 'A', periods: 2, label: 'A (2 years)', is_default: false },
    { id: 2, grant_year: 2020, grant_type: 'Bonus', variant_code: 'B', periods: 3, label: 'B (3 years)', is_default: false },
    { id: 3, grant_year: 2020, grant_type: 'Bonus', variant_code: 'C', periods: 4, label: 'C (4 years)', is_default: true  },
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
  // The server derives these flat listings from the tables above; nothing in the
  // wizard reads them, but ContentBlob has them, so the fixture must too.
  loan_rates_all: [],
  loan_refinances_all: [],
}
