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
MAX_ADULTS = 6
MAX_DEPENDENTS = 6
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

STATE_TANF_LABELS = {
    "AK": "Alaska ATAP benefit",
    "AL": "Alabama TANF",
    "AR": "Arkansas Transitional Employment Assistance",
    "AZ": "Arizona TANF",
    "CA": "California CalWORKs Cash Benefit",
    "CO": "Colorado TANF",
    "CT": "Connecticut Temporary Family Assistance (TFA) benefit amount",
    "DC": "DC Temporary Assistance for Needy Families (TANF)",
    "DE": "Delaware TANF",
    "FL": "Florida Temporary Cash Assistance",
    "GA": "Georgia Temporary Assistance for Needy Families (TANF)",
    "HI": "Hawaii TANF benefit amount",
    "IA": "Iowa Family Investment Program (FIP)",
    "ID": "Idaho Temporary Assistance for Families in Idaho (TAFI)",
    "IL": "Illinois Temporary Assistance for Needy Families (TANF)",
    "IN": "Indiana Temporary Assistance for Needy Families (TANF)",
    "KS": "Kansas Temporary Assistance for Needy Families (TANF)",
    "KY": "Kentucky K-TAP benefit",
    "LA": "Louisiana FITAP",
    "MA": "Massachusetts Temporary Assistance for Families with Dependent Children (TAFDC)",
    "MD": "Maryland Temporary Cash Assistance",
    "ME": "Maine TANF",
    "MI": "Michigan Family Independence Program",
    "MN": "Minnesota MFIP",
    "MO": "Missouri Temporary Assistance for Needy Families (TANF)",
    "MS": "Mississippi TANF",
    "MT": "Montana Temporary Assistance for Needy Families (TANF)",
    "NC": "North Carolina TANF",
    "ND": "North Dakota Temporary Assistance for Needy Families",
    "NE": "Nebraska Aid to Dependent Children (ADC)",
    "NH": "New Hampshire Financial Assistance to Needy Families",
    "NJ": "New Jersey WFNJ benefit",
    "NM": "New Mexico Works",
    "NV": "Nevada Temporary Assistance for Needy Families (TANF)",
    "NY": "New York TANF",
    "OH": "Ohio OWF",
    "OK": "Oklahoma TANF",
    "OR": "Oregon Temporary Assistance for Needy Families (TANF)",
    "PA": "Pennsylvania TANF",
    "RI": "Rhode Island Works benefit",
    "SC": "South Carolina TANF",
    "SD": "South Dakota Temporary Assistance for Needy Families (TANF)",
    "TN": "Tennessee Families First",
    "TX": "Texas Temporary Assistance for Needy Families (TANF)",
    "UT": "Utah Family Employment Program benefit",
    "VA": "VA TANF",
    "VT": "Vermont Reach Up (TANF)",
    "WA": "Washington Temporary Assistance for Needy Families (TANF)",
    "WI": "Wisconsin Works",
    "WV": "West Virginia WV Works benefit",
    "WY": "Wyoming POWER benefit",
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
        "key": "head_start",
        "label": "Head Start",
        "short_label": "Head Start",
        "description": "Modeled value of Head Start services for eligible children.",
    },
    {
        "key": "early_head_start",
        "label": "Early Head Start",
        "short_label": "Early HS",
        "description": "Modeled value of Early Head Start services for eligible infants, toddlers, and pregnant people.",
    },
    {
        "key": "child_care_subsidies",
        "label": "Child care subsidies",
        "short_label": "Child care",
        "description": "State CCDF child care subsidy net of family copay (modeled in CA, CO, DE, MA, ME, NE, NH, PA, RI, VT).",
    },
    {
        "key": "housing_assistance",
        "label": "Housing assistance",
        "short_label": "Housing",
        "description": "Modeled value of HUD housing assistance when the household is already receiving housing assistance.",
    },
    {
        "key": "ssi",
        "label": "SSI",
        "short_label": "SSI",
        "description": "Supplemental Security Income for eligible disabled, blind, or aged people.",
    },
    {
        "key": "ssdi",
        "label": "SSDI",
        "short_label": "SSDI",
        "description": "Reported Social Security Disability Insurance income.",
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
        "key": "rent",
        "label": "Rent or mortgage",
        "short_label": "Housing",
        "description": "Annual rent or mortgage entered by the household. Subtracted from net resources.",
    },
    {
        "key": "utilities",
        "label": "Utilities",
        "short_label": "Utilities",
        "description": "Annual utility costs entered by the household. Subtracted from net resources.",
    },
    {
        "key": "childcare",
        "label": "Child care expense",
        "short_label": "Child care",
        "description": "Annual out-of-pocket child care expense entered by the household. Subtracted from net resources.",
    },
    {
        "key": "food",
        "label": "Food",
        "short_label": "Food",
        "description": "Annual food costs entered by the household. Subtracted from net resources.",
    },
    {
        "key": "transportation",
        "label": "Transportation",
        "short_label": "Transport",
        "description": "Annual transportation costs entered by the household. Subtracted from net resources.",
    },
    {
        "key": "health_insurance_premiums",
        "label": "Health insurance premiums",
        "short_label": "Health premiums",
        "description": "Annual out-of-pocket health insurance premiums entered by the household. Subtracted from net resources.",
    },
    {
        "key": "technology",
        "label": "Phone and internet",
        "short_label": "Tech",
        "description": "Annual phone and internet costs entered by the household. Subtracted from net resources.",
    },
    {
        "key": "debt_payments",
        "label": "Debt payments",
        "short_label": "Debt",
        "description": "Annual debt payments entered by the household. Subtracted from net resources.",
    },
    {
        "key": "education_training",
        "label": "Education and training",
        "short_label": "Training",
        "description": "Annual education or training costs entered by the household. Subtracted from net resources.",
    },
    {
        "key": "other_expenses",
        "label": "Other expenses",
        "short_label": "Other",
        "description": "Other annual budget costs entered by the household. Subtracted from net resources.",
    },
    {
        "key": "chip_premium",
        "label": "CHIP premium",
        "short_label": "CHIP premium",
        "description": "Annual CHIP premium or enrollment fee paid by the household. Subtracted from net resources.",
    },
]

PUBLIC_ASSISTANCE_PROGRAM_OPTIONS = [
    {
        "key": "snap",
        "label": "Supplemental Nutrition Assistance Program (SNAP)",
    },
    {
        "key": "free_school_meals",
        "label": "Free or reduced price school meals",
    },
    {
        "key": "wic",
        "label": "Women, Infants, and Children Nutrition Program (WIC)",
    },
    {
        "key": "tanf",
        "label": "Temporary Assistance for Needy Families (TANF)",
    },
    {
        "key": "child_care_subsidies",
        "label": "Child Care Subsidy (CCDF)",
    },
    {
        "key": "head_start",
        "label": "Head Start",
    },
    {
        "key": "early_head_start",
        "label": "Early Head Start",
    },
    {
        "key": "housing_assistance",
        "label": "Section 8 Housing Choice Voucher",
    },
    {
        "key": "medicaid",
        "label": "Medicaid for adults",
    },
    {
        "key": "chip",
        "label": "Medicaid for children / CHIP",
    },
    {
        "key": "aca_ptc",
        "label": "Health Insurance Marketplace Subsidy",
    },
    {
        "key": "federal_refundable_credits",
        "label": "Federal refundable tax credits",
    },
    {
        "key": "state_refundable_credits",
        "label": "State refundable tax credits",
    },
    {
        "key": "ssi",
        "label": "Supplemental Security Income (SSI)",
    },
    {
        "key": "ssdi",
        "label": "Social Security Disability Insurance (SSDI)",
    },
]


def build_state_program_overrides() -> dict[str, dict[str, dict[str, str]]]:
    overrides = {}
    for state in STATE_INFO:
        state_code = state["code"]
        state_name = state["name"]
        state_overrides = {
            "tanf": {
                "label": STATE_TANF_LABELS.get(
                    state_code,
                    f"{state_name} Temporary Assistance for Needy Families (TANF)",
                ),
                "short_label": "TANF",
                "description": "State cash assistance for families with children.",
                "variable": STATE_TANF_VARIABLES.get(state_code, "tanf"),
            },
            "medicaid": {
                "label": f"{state_name} Medicaid",
                "short_label": "Medicaid",
                "description": f"Public health coverage through {state_name}'s Medicaid program.",
            },
            "chip": {
                "label": f"{state_name} Children's Health Insurance Program (CHIP)",
                "short_label": "CHIP",
                "description": f"Children's public health coverage through {state_name}'s CHIP program.",
            },
            "state_refundable_credits": {
                "label": f"{state_name} refundable state tax credits",
                "short_label": "State credits",
                "description": f"Refundable state income tax credits modeled for {state_name}.",
            },
        }
        if state_code in CCDF_MODELED_STATES:
            state_overrides["child_care_subsidies"] = {
                "label": f"{state_name} child care subsidy (CCDF)",
                "short_label": "Child care",
                "description": f"State CCDF child care subsidy modeled for {state_name}.",
            }
        overrides[state_code] = state_overrides
    return overrides


STATE_PROGRAM_OVERRIDES = build_state_program_overrides()
