from __future__ import annotations

DEFAULT_YEAR = 2026
DEFAULT_SERIES_MAX_EARNINGS = 100_000
DEFAULT_SERIES_STEP = 500
DEFAULT_CLIFF_DELTA = 1_000
DEFAULT_SERIES_EARNINGS_BUFFER = 30_000
DEFAULT_SERIES_MIN_EARNINGS_WINDOW = 40_000
DEFAULT_SERIES_TARGET_POINTS = 201
DEFAULT_SERIES_STEP_INCREMENT = 250
DEFAULT_FILING_STATUS = "HEAD_OF_HOUSEHOLD"
FILING_STATUS_OPTIONS = [
    {"code": "SINGLE", "label": "Single"},
    {
        "code": "HEAD_OF_HOUSEHOLD",
        "label": "Head of household",
    },
    {
        "code": "JOINT",
        "label": "Married filing jointly",
    },
    {
        "code": "SEPARATE",
        "label": "Married filing separately",
    },
]
MARRIED_FILING_STATUSES = ("JOINT", "SEPARATE")

STATE_INFO = [
    {"code": "AL", "name": "Alabama"},
    {"code": "AK", "name": "Alaska"},
    {"code": "AZ", "name": "Arizona"},
    {"code": "AR", "name": "Arkansas"},
    {"code": "CA", "name": "California"},
    {"code": "CO", "name": "Colorado"},
    {"code": "CT", "name": "Connecticut"},
    {"code": "DE", "name": "Delaware"},
    {"code": "DC", "name": "District of Columbia"},
    {"code": "FL", "name": "Florida"},
    {"code": "GA", "name": "Georgia"},
    {"code": "HI", "name": "Hawaii"},
    {"code": "ID", "name": "Idaho"},
    {"code": "IL", "name": "Illinois"},
    {"code": "IN", "name": "Indiana"},
    {"code": "IA", "name": "Iowa"},
    {"code": "KS", "name": "Kansas"},
    {"code": "KY", "name": "Kentucky"},
    {"code": "LA", "name": "Louisiana"},
    {"code": "ME", "name": "Maine"},
    {"code": "MD", "name": "Maryland"},
    {"code": "MA", "name": "Massachusetts"},
    {"code": "MI", "name": "Michigan"},
    {"code": "MN", "name": "Minnesota"},
    {"code": "MS", "name": "Mississippi"},
    {"code": "MO", "name": "Missouri"},
    {"code": "MT", "name": "Montana"},
    {"code": "NE", "name": "Nebraska"},
    {"code": "NV", "name": "Nevada"},
    {"code": "NH", "name": "New Hampshire"},
    {"code": "NJ", "name": "New Jersey"},
    {"code": "NM", "name": "New Mexico"},
    {"code": "NY", "name": "New York"},
    {"code": "NC", "name": "North Carolina"},
    {"code": "ND", "name": "North Dakota"},
    {"code": "OH", "name": "Ohio"},
    {"code": "OK", "name": "Oklahoma"},
    {"code": "OR", "name": "Oregon"},
    {"code": "PA", "name": "Pennsylvania"},
    {"code": "RI", "name": "Rhode Island"},
    {"code": "SC", "name": "South Carolina"},
    {"code": "SD", "name": "South Dakota"},
    {"code": "TN", "name": "Tennessee"},
    {"code": "TX", "name": "Texas"},
    {"code": "UT", "name": "Utah"},
    {"code": "VT", "name": "Vermont"},
    {"code": "VA", "name": "Virginia"},
    {"code": "WA", "name": "Washington"},
    {"code": "WV", "name": "West Virginia"},
    {"code": "WI", "name": "Wisconsin"},
    {"code": "WY", "name": "Wyoming"},
]

STATE_NAME_BY_CODE = {item["code"]: item["name"] for item in STATE_INFO}

# States with a modeled CCDF child care subsidy in policyengine-us. For all
# other states the aggregate returns 0 no matter what, so we skip computing
# and reporting it to avoid showing a misleading empty line.
CCDF_MODELED_STATES = frozenset(
    {"CA", "CO", "DE", "MA", "ME", "NE", "NH", "PA", "RI", "VT"}
)

STATE_TANF_VARIABLES = {
    "AK": "ak_atap",
    "AL": "al_tanf",
    "AR": "ar_tea",
    "AZ": "az_tanf",
    "CA": "ca_tanf",
    "CO": "co_tanf",
    "CT": "ct_tfa",
    "DC": "dc_tanf",
    "DE": "de_tanf",
    "FL": "fl_tca",
    "GA": "ga_tanf",
    "HI": "hi_tanf",
    "IA": "ia_fip",
    "ID": "id_tafi",
    "IL": "il_tanf",
    "IN": "in_tanf",
    "KS": "ks_tanf",
    "KY": "ky_ktap",
    "LA": "la_fitap",
    "MA": "ma_tafdc",
    "MD": "md_tca",
    "ME": "me_tanf",
    "MI": "mi_fip",
    "MN": "mn_mfip",
    "MO": "mo_tanf",
    "MS": "ms_tanf",
    "MT": "mt_tanf",
    "NC": "nc_tanf",
    "ND": "nd_tanf",
    "NE": "ne_adc",
    "NH": "nh_fanf",
    "NJ": "nj_wfnj",
    "NM": "nm_works",
    "NV": "nv_tanf",
    "NY": "ny_tanf",
    "OH": "oh_owf",
    "OK": "ok_tanf",
    "OR": "or_tanf",
    "PA": "pa_tanf",
    "RI": "ri_works",
    "SC": "sc_tanf",
    "SD": "sd_tanf",
    "TN": "tn_ff",
    "TX": "tx_tanf",
    "UT": "ut_fep",
    "VA": "va_tanf",
    "VT": "vt_reach_up",
    "WA": "wa_tanf",
    "WI": "wi_works",
    "WV": "wv_works",
    "WY": "wy_power",
}

HOUSEHOLD_TYPES = [
    {
        "id": "single_adult",
        "label": "Single adult",
        "short_label": "1 adult",
        "description": "One working-age adult with no children.",
        "summary": "Useful for spotting tax-credit cliffs without child-based supports.",
        "people": [{"id": "adult_1", "role": "head", "age": 30}],
    },
    {
        "id": "single_parent_toddler",
        "label": "Single parent + toddler",
        "short_label": "1 adult, 1 child",
        "description": "One adult with a two-year-old child.",
        "summary": "Captures WIC, Medicaid or CHIP, and early TANF or SNAP interactions.",
        "people": [
            {"id": "adult_1", "role": "head", "age": 31},
            {"id": "child_1", "role": "dependent", "age": 2},
        ],
    },
    {
        "id": "single_parent_two_children",
        "label": "Single parent + two children",
        "short_label": "1 adult, 2 children",
        "description": "One adult with elementary-age children.",
        "summary": "A strong default for state-to-state cliff comparisons.",
        "people": [
            {"id": "adult_1", "role": "head", "age": 33},
            {"id": "child_1", "role": "dependent", "age": 6},
            {"id": "child_2", "role": "dependent", "age": 10},
        ],
    },
    {
        "id": "two_adults_two_children",
        "label": "Two adults + two children",
        "short_label": "2 adults, 2 children",
        "description": "Two adults with one preschooler and one school-age child.",
        "summary": "Shows how a second adult changes taxes and benefit phaseouts.",
        "people": [
            {"id": "adult_1", "role": "head", "age": 35},
            {"id": "adult_2", "role": "spouse", "age": 34},
            {"id": "child_1", "role": "dependent", "age": 4},
            {"id": "child_2", "role": "dependent", "age": 8},
        ],
    },
    {
        "id": "two_adults_three_children",
        "label": "Two adults + three children",
        "short_label": "2 adults, 3 children",
        "description": "Two adults with a young child, a school-age child, and a teen.",
        "summary": "Helpful for comparing broader support bundles across states.",
        "people": [
            {"id": "adult_1", "role": "head", "age": 37},
            {"id": "adult_2", "role": "spouse", "age": 36},
            {"id": "child_1", "role": "dependent", "age": 2},
            {"id": "child_2", "role": "dependent", "age": 7},
            {"id": "child_3", "role": "dependent", "age": 15},
        ],
    },
]

HOUSEHOLD_TYPE_BY_ID = {item["id"]: item for item in HOUSEHOLD_TYPES}

PROGRAM_DEFINITIONS = [
    {
        "key": "snap",
        "label": "SNAP",
        "short_label": "SNAP",
        "description": "Supplemental Nutrition Assistance Program.",
    },
    {
        "key": "tanf",
        "label": "TANF",
        "short_label": "TANF",
        "description": "Temporary Assistance for Needy Families or state equivalent.",
    },
    {
        "key": "wic",
        "label": "WIC",
        "short_label": "WIC",
        "description": "Nutrition support for eligible women, infants, and children.",
    },
    {
        "key": "free_school_meals",
        "label": "Free school meals",
        "short_label": "Meals",
        "description": "Modeled value of free school breakfast and lunch.",
    },
    {
        "key": "child_care_subsidies",
        "label": "Child care subsidies",
        "short_label": "Child care",
        "description": "State CCDF child care subsidy net of family copay (modeled in CA, CO, DE, MA, ME, NE, NH, PA, RI, VT).",
    },
    {
        "key": "federal_refundable_credits",
        "label": "Federal refundable tax credits",
        "short_label": "Federal credits",
        "description": "Modeled refundable federal income tax credits combined.",
    },
    {
        "key": "state_refundable_credits",
        "label": "State refundable tax credits",
        "short_label": "State credits",
        "description": "Modeled refundable state income tax credits combined.",
    },
    {
        "key": "medicaid",
        "label": "Medicaid",
        "short_label": "Medicaid",
        "description": "Public health coverage for eligible low-income individuals.",
    },
    {
        "key": "chip",
        "label": "CHIP",
        "short_label": "CHIP",
        "description": "Children's Health Insurance Program coverage.",
    },
    {
        "key": "aca_ptc",
        "label": "ACA premium tax credits",
        "short_label": "ACA",
        "description": "Marketplace premium subsidies for eligible households.",
    },
]

HOUSEHOLD_COST_DEFINITIONS = [
    {
        "key": "chip_premium",
        "label": "CHIP premium",
        "short_label": "CHIP premium",
        "description": "Annual CHIP premium or enrollment fee paid by the household. Subtracted from net resources.",
    },
]
