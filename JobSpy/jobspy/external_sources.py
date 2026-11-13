import json
import logging
import math
import os
from concurrent.futures import (
    ThreadPoolExecutor,
    TimeoutError as FuturesTimeoutError,
    as_completed,
)
from urllib.parse import urlencode, urlsplit
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from .normalizer import (
    normalize_remoteok,
    normalize_arbeitnow,
    normalize_jobicy,
)

logger = logging.getLogger("jobpulse-sources")

MAX_PROVIDER_JOBS = 100


# ============================================================
# CONFIGURATION
# ============================================================

USER_AGENT = os.getenv(
    "JOBPULSE_USER_AGENT",
    "JobPulse/1.0 (job discovery project)",
)

FETCH_POOL_SIZE = int(
    os.getenv(
        "JOBPULSE_FETCH_POOL",
        str(MAX_PROVIDER_JOBS),
    )
)
FETCH_POOL_SIZE = min(
    MAX_PROVIDER_JOBS,
    max(1, FETCH_POOL_SIZE),
)

REQUEST_TIMEOUT = int(
    os.getenv(
        "JOBPULSE_HTTP_TIMEOUT",
        "10",
    )
)

PROVIDER_TIMEOUT = max(
    5,
    int(os.getenv("JOBPULSE_PROVIDER_TIMEOUT", "75")),
)

JOBSPY_QUERY_TIMEOUT = max(
    5,
    int(os.getenv("JOBPULSE_JOBSPY_QUERY_TIMEOUT", "60")),
)

JOBSPY_RESULTS_WANTED = max(
    1,
    int(os.getenv("JOBPULSE_JOBSPY_RESULTS_WANTED", "500")),
)

MAX_THE_MUSE_PAGES = int(
    os.getenv(
        "JOBPULSE_THE_MUSE_MAX_PAGES",
        "3",
    )
)

MAX_ADZUNA_PAGES = int(
    os.getenv(
        "JOBPULSE_ADZUNA_MAX_PAGES",
        "10",
    )
)

ADZUNA_RESULTS_PER_PAGE = max(
    1,
    int(
        os.getenv(
            "JOBPULSE_ADZUNA_RESULTS_PER_PAGE",
            "50",
        )
    ),
)

GEMINI_SEARCH_TIMEOUT = max(
    10,
    int(os.getenv("GEMINI_JOB_SEARCH_TIMEOUT", "45")),
)

GEMINI_SEARCH_MODEL = os.getenv(
    "GEMINI_JOB_SEARCH_MODEL",
    "gemini-3.8-flash",
)

JOBICY_COUNT = int(
    os.getenv(
        "JOBPULSE_JOBICY_COUNT",
        "500",
    )
)

JOB_OPPORTUNITIES_LIMIT = int(
    os.getenv(
        "JOBPULSE_JOB_OPPORTUNITIES_LIMIT",
        "500",
    )
)

JOBSPY_SOURCE_NAMES = {
    "linkedin": "LinkedIn",
    "indeed": "Indeed",
    "zip_recruiter": "ZipRecruiter",
    "glassdoor": "Glassdoor",
    "google": "Google",
    "bayt": "Bayt",
    "naukri": "Naukri",
    "bdjobs": "BDJobs",
}

SDE_INTERNSHIP_SEARCH_TERMS = (
    "software engineer intern",
    "software developer internship",
    "full stack developer internship",
    "web developer internship",
)


# ============================================================
# GENERIC HTTP / JSON
# ============================================================

def fetch_json(
    base_url,
    params=None,
    headers=None,
):
    url = base_url

    if params:
        encoded = urlencode(
            params,
            doseq=True,
        )
        url = f"{base_url}?{encoded}"

    request_headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    }

    if headers:
        request_headers.update(headers)

    request = Request(
        url,
        headers=request_headers,
    )

    with urlopen(
        request,
        timeout=REQUEST_TIMEOUT,
    ) as response:
        body = response.read()

    return json.loads(
        body.decode(
            "utf-8",
            errors="replace",
        )
    )


def safe_string(
    value,
):
    if value is None:
        return ""

    try:
        if math.isnan(float(value)):
            return ""
    except (TypeError, ValueError, OverflowError):
        pass

    return str(
        value
    ).strip()


def safe_join(
    values,
):
    result = []

    for value in values:
        text = safe_string(
            value
        )

        if text:
            result.append(
                text
            )

    return " ".join(
        result
    )


def safe_int(
    value,
    default=0,
):
    try:
        return int(value)
    except (
        TypeError,
        ValueError,
    ):
        return default


def safe_array(value):
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        values = value
    else:
        values = re.split(r"[,;|\n]+", str(value))
    result = []
    seen = set()
    for item in values:
        text = safe_string(item)
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(text)
    return result


# ============================================================
# SEARCH HELPER
# ============================================================

def text_matches_search(
    text,
    search_term,
):
    """
    Provider-side search filtering is intentionally disabled.

    Retrieval must remain broad.

    Search relevance is handled later by:
        server.py
        matcher.py
    """

    return True


# ============================================================
# REMOTEOK
# ============================================================

def fetch_remoteok(
    search_term="",
):
    try:
        data = fetch_json(
            "https://remoteok.com/api"
        )

        if not isinstance(
            data,
            list,
        ):
            return {
                "source": "RemoteOK",
                "success": False,
                "jobs": [],
                "error":
                    "Invalid RemoteOK response",
            }

        jobs = []

        for item in data:
            if not isinstance(
                item,
                dict,
            ):
                continue

            position = safe_string(
                item.get(
                    "position"
                )
            )

            if not position:
                continue

            normalized = normalize_remoteok(
                item
            )

            if normalized:
                jobs.append(
                    normalized
                )

        return {
            "source":
                "RemoteOK",

            "success":
                True,

            "jobs":
                jobs,

            "error":
                None,
        }

    except Exception as error:
        return {
            "source":
                "RemoteOK",

            "success":
                False,

            "jobs":
                [],

            "error":
                str(error),
        }


# ============================================================
# ARBEITNOW
# ============================================================

def fetch_arbeitnow(
    search_term="",
    location="",
):
    try:
        data = fetch_json(
            "https://www.arbeitnow.com/api/job-board-api"
        )

        raw_jobs = []

        if isinstance(
            data,
            dict,
        ):
            raw_jobs = data.get(
                "data",
                [],
            )

        if not isinstance(
            raw_jobs,
            list,
        ):
            raw_jobs = []

        jobs = []

        for item in raw_jobs:
            if not isinstance(
                item,
                dict,
            ):
                continue

            normalized = normalize_arbeitnow(
                item
            )

            if normalized:
                jobs.append(
                    normalized
                )

        return {
            "source":
                "Arbeitnow",

            "success":
                True,

            "jobs":
                jobs,

            "error":
                None,
        }

    except Exception as error:
        return {
            "source":
                "Arbeitnow",

            "success":
                False,

            "jobs":
                [],

            "error":
                str(error),
        }


# ============================================================
# JOBICY
# ============================================================

def fetch_jobicy(
    search_term="",
):
    try:
        count = max(
            50,
            JOBICY_COUNT,
        )
        count = min(
            MAX_PROVIDER_JOBS,
            count,
        )

        data = fetch_json(
            "https://jobicy.com/api/v2/remote-jobs",
            {
                "count":
                    count,
            },
        )

        raw_jobs = []

        if isinstance(
            data,
            dict,
        ):
            raw_jobs = data.get(
                "jobs",
                [],
            )

        if not isinstance(
            raw_jobs,
            list,
        ):
            raw_jobs = []

        jobs = []

        for item in raw_jobs:
            if not isinstance(
                item,
                dict,
            ):
                continue

            normalized = normalize_jobicy(
                item
            )

            if normalized:
                jobs.append(
                    normalized
                )

        return {
            "source":
                "Jobicy",

            "success":
                True,

            "jobs":
                jobs,

            "error":
                None,
        }

    except Exception as error:
        return {
            "source":
                "Jobicy",

            "success":
                False,

            "jobs":
                [],

            "error":
                str(error),
        }


# ============================================================
# THE MUSE
# ============================================================

def fetch_themuse(
    search_term="",
    location="",
):
    try:
        all_jobs = []

        page_size = 20

        max_pages = max(
            1,
            MAX_THE_MUSE_PAGES,
        )

        for page in range(
            max_pages
        ):
            params = {
                "page":
                    page,
            }

            data = fetch_json(
                "https://www.themuse.com/api/public/jobs",
                params,
            )

            if not isinstance(
                data,
                dict,
            ):
                break

            results = data.get(
                "results",
                [],
            )

            if not isinstance(
                results,
                list,
            ):
                break

            if not results:
                break

            all_jobs.extend(
                results
            )

            page_count = data.get(
                "page_count"
            )

            if page_count is not None:
                page_count_int = safe_int(
                    page_count,
                    0,
                )

                if (
                    page_count_int > 0
                    and page + 1
                    >= page_count_int
                ):
                    break

            if len(all_jobs) >= FETCH_POOL_SIZE:
                break

        all_jobs = all_jobs[
            :FETCH_POOL_SIZE
        ]

        jobs = []

        for item in all_jobs:
            if not isinstance(
                item,
                dict,
            ):
                continue

            company = (
                item.get(
                    "company"
                )
                or {}
            )

            if not isinstance(
                company,
                dict,
            ):
                company = {}

            title = safe_string(
                item.get(
                    "name",
                    "",
                )
            )

            company_name = safe_string(
                company.get(
                    "name",
                    "",
                )
            )

            description = safe_string(
                item.get(
                    "contents",
                    "",
                )
            )

            locations = (
                item.get(
                    "locations"
                )
                or []
            )

            location_names = []

            if isinstance(
                locations,
                list,
            ):
                for loc in locations:
                    if not isinstance(
                        loc,
                        dict,
                    ):
                        continue

                    name = safe_string(
                        loc.get(
                            "name",
                            "",
                        )
                    )

                    if name:
                        location_names.append(
                            name
                        )

            refs = (
                item.get(
                    "refs"
                )
                or {}
            )

            if not isinstance(
                refs,
                dict,
            ):
                refs = {}

            landing_page = safe_string(
                refs.get(
                    "landing_page",
                    "",
                )
            )

            if (
                not title
                or not landing_page
            ):
                continue

            location_text = ", ".join(
                location_names
            )

            searchable = safe_join(
                [
                    title,
                    company_name,
                    description,
                    location_text,
                ]
            )

            jobs.append(
                {
                    "title":
                        title,

                    "company":
                        company_name
                        or "Unknown Company",

                    "companyUrl":
                        (
                            safe_string(
                                company.get(
                                    "refs",
                                    {}
                                ).get(
                                    "landing_page",
                                    ""
                                )
                            )
                            if isinstance(
                                company.get(
                                    "refs",
                                    {}
                                ),
                                dict,
                            )
                            else ""
                        ),

                    "location":
                        location_text
                        or "Not specified",

                    "isRemote":
                        "remote"
                        in searchable.lower(),

                    "jobType":
                        safe_string(
                            item.get(
                                "type",
                                "",
                            )
                        ),

                    "description":
                        description,

                    "skills":
                        [],

                    "salary":
                        "Not specified",

                    "minSalary":
                        None,

                    "maxSalary":
                        None,

                    "salaryCurrency":
                        "",

                    "salarySource":
                        "",

                    "source":
                        "The Muse",

                    "jobUrl":
                        landing_page,

                    "jobUrlDirect":
                        landing_page,

                    "applicationUrl":
                        landing_page,

                    "postedDate":
                        item.get(
                            "publication_date"
                        ),
                }
            )

        return {
            "source":
                "The Muse",

            "success":
                True,

            "jobs":
                jobs,

            "error":
                None,
        }

    except Exception as error:
        return {
            "source":
                "The Muse",

            "success":
                False,

            "jobs":
                [],

            "error":
                str(error),
        }


# ============================================================
# ADZUNA
# ============================================================

def fetch_adzuna(
    search_term="",
    location="",
):
    app_id = os.getenv(
        "ADZUNA_APP_ID"
    )

    app_key = os.getenv(
        "ADZUNA_APP_KEY"
    )

    if not app_id or not app_key:
        return {
            "source":
                "Adzuna",

            "success":
                False,

            "jobs":
                [],

            "error":
                (
                    "ADZUNA_APP_ID and "
                    "ADZUNA_APP_KEY are not configured"
                ),
        }

    countries_raw = os.getenv(
        "ADZUNA_COUNTRIES",
        "",
    ).strip()

    countries = [
        country.strip().lower()
        for country in countries_raw.split(",")
        if country.strip()
    ]

    if not countries:
        return {
            "source":
                "Adzuna",

            "success":
                False,

            "jobs":
                [],

            "error":
                "ADZUNA_COUNTRIES is not configured",
        }

    jobs = []

    try:
        pages_per_country = max(
            1,
            MAX_ADZUNA_PAGES,
        )
        pages_per_country = min(
            pages_per_country,
            max(
                1,
                (MAX_PROVIDER_JOBS + ADZUNA_RESULTS_PER_PAGE - 1)
                // ADZUNA_RESULTS_PER_PAGE,
            ),
        )

        for country in countries:
            for page in range(
                1,
                pages_per_country + 1,
            ):
                params = {
                    "app_id":
                        app_id,

                    "app_key":
                        app_key,

                    "results_per_page":
                        ADZUNA_RESULTS_PER_PAGE,
                }
                if safe_string(search_term):
                    params["what"] = safe_string(search_term)
                if safe_string(location):
                    params["where"] = safe_string(location)

                data = fetch_json(
                    (
                        "https://api.adzuna.com/"
                        f"v1/api/jobs/{country}/search/{page}"
                    ),
                    params,
                )

                if not isinstance(
                    data,
                    dict,
                ):
                    continue

                results = data.get(
                    "results",
                    [],
                )

                if not isinstance(
                    results,
                    list,
                ):
                    continue

                if not results:
                    break

                for item in results:
                    if not isinstance(
                        item,
                        dict,
                    ):
                        continue

                    location_obj = (
                        item.get(
                            "location"
                        )
                        or {}
                    )

                    if not isinstance(
                        location_obj,
                        dict,
                    ):
                        location_obj = {}

                    display_location = safe_string(
                        location_obj.get(
                            "display_name",
                            "",
                        )
                    )

                    company_obj = (
                        item.get(
                            "company"
                        )
                        or {}
                    )

                    if not isinstance(
                        company_obj,
                        dict,
                    ):
                        company_obj = {}

                    company_name = safe_string(
                        company_obj.get(
                            "display_name",
                            "",
                        )
                    )

                    title = safe_string(
                        item.get(
                            "title",
                            "",
                        )
                    )

                    description = safe_string(
                        item.get(
                            "description",
                            "",
                        )
                    )

                    url = safe_string(
                        item.get(
                            "redirect_url",
                            "",
                        )
                    )

                    if (
                        not title
                        or not url
                    ):
                        continue

                    salary_min = item.get(
                        "salary_min"
                    )

                    salary_max = item.get(
                        "salary_max"
                    )

                    salary = "Not specified"

                    if (
                        salary_min is not None
                        or salary_max is not None
                    ):
                        salary = (
                            f"{salary_min or ''} - "
                            f"{salary_max or ''}"
                        ).strip(
                            " -"
                        )

                    searchable = safe_join(
                        [
                            title,
                            company_name,
                            description,
                            display_location,
                        ]
                    )

                    jobs.append(
                        {
                            "title":
                                title,

                            "company":
                                company_name
                                or "Unknown Company",

                            "companyUrl":
                                "",

                            "location":
                                display_location
                                or "Not specified",

                            "isRemote":
                                "remote"
                                in searchable.lower(),

                            "jobType":
                                safe_string(
                                    item.get(
                                        "contract_type",
                                        "",
                                    )
                                ),

                            "description":
                                description,

                            "skills":
                                [],

                            "salary":
                                salary,

                            "minSalary":
                                salary_min,

                            "maxSalary":
                                salary_max,

                            "salaryCurrency":
                                safe_string(
                                    item.get(
                                        "salary_currency",
                                        os.getenv(
                                            "ADZUNA_DEFAULT_CURRENCY",
                                            "",
                                        ),
                                    )
                                ),

                            "salarySource":
                                "Adzuna",

                            "source":
                                "Adzuna",

                            "jobUrl":
                                url,

                            "jobUrlDirect":
                                url,

                            "applicationUrl":
                                url,

                            "postedDate":
                                item.get(
                                    "created"
                                ),
                        }
                    )

                    if len(jobs) >= FETCH_POOL_SIZE:
                        break

                if len(jobs) >= FETCH_POOL_SIZE:
                    break

            if len(jobs) >= FETCH_POOL_SIZE:
                break

        return {
            "source":
                "Adzuna",

            "success":
                True,

            "jobs":
                jobs,

            "error":
                None,
        }

    except Exception as error:
        return {
            "source":
                "Adzuna",

            "success":
                False,

            "jobs":
                [],

            "error":
                str(error),
        }


# ============================================================
# JOB OPPORTUNITIES API
# ============================================================

def fetch_job_opportunities(
    search_term="",
    location="",
):
    try:
        params = {
            "limit":
                min(
                    MAX_PROVIDER_JOBS,
                    max(50, JOB_OPPORTUNITIES_LIMIT),
                )
        }

        data = fetch_json(
            "https://jobopportunitiesapi.org/public/jobs",
            params,
        )

        if isinstance(
            data,
            dict,
        ):
            raw_jobs = (
                data.get("jobs")
                or data.get("results")
                or data.get("data")
                or []
            )

        elif isinstance(
            data,
            list,
        ):
            raw_jobs = data

        else:
            raw_jobs = []

        if not isinstance(
            raw_jobs,
            list,
        ):
            raw_jobs = []

        jobs = []

        for item in raw_jobs:
            if not isinstance(
                item,
                dict,
            ):
                continue

            title = safe_string(
                item.get(
                    "title",
                    item.get(
                        "name",
                        "",
                    ),
                )
            )

            company = safe_string(
                item.get(
                    "company",
                    item.get(
                        "company_name",
                        "",
                    ),
                )
            )

            description = safe_string(
                item.get(
                    "description",
                    item.get(
                        "content",
                        "",
                    ),
                )
            )

            job_location = safe_string(
                item.get(
                    "location",
                    "",
                )
            )

            url = safe_string(
                item.get(
                    "url",
                    item.get(
                        "apply_url",
                        item.get(
                            "job_url",
                            "",
                        ),
                    ),
                )
            )

            if (
                not title
                or not url
            ):
                continue

            searchable = safe_join(
                [
                    title,
                    company,
                    description,
                    job_location,
                ]
            )

            jobs.append(
                {
                    "title":
                        title,

                    "company":
                        company
                        or "Unknown Company",

                    "companyUrl":
                        "",

                    "location":
                        job_location
                        or "Not specified",

                    "isRemote":
                        "remote"
                        in searchable.lower(),

                    "jobType":
                        safe_string(
                            item.get(
                                "job_type",
                                item.get(
                                    "type",
                                    "",
                                ),
                            )
                        ),

                    "description":
                        description,

                    "skills":
                        [],

                    "salary":
                        safe_string(
                            item.get(
                                "salary",
                                "Not specified",
                            )
                        ),

                    "minSalary":
                        None,

                    "maxSalary":
                        None,

                    "salaryCurrency":
                        "",

                    "salarySource":
                        "",

                    "source":
                        "Job Opportunities API",

                    "jobUrl":
                        url,

                    "jobUrlDirect":
                        url,

                    "applicationUrl":
                        url,

                    "postedDate":
                        item.get(
                            "posted_at",
                            item.get(
                                "created_at"
                            ),
                        ),
                }
            )

            if len(jobs) >= FETCH_POOL_SIZE:
                break

        return {
            "source":
                "Job Opportunities API",

            "success":
                True,

            "jobs":
                jobs,

            "error":
                None,
        }

    except Exception as error:
        return {
            "source":
                "Job Opportunities API",

            "success":
                False,

            "jobs":
                [],

            "error":
                str(error),
        }


# ============================================================
# GREENHOUSE
# ============================================================

def get_greenhouse_companies():
    raw = os.getenv(
        "GREENHOUSE_COMPANIES",
        "",
    )

    return [
        slug.strip()
        for slug in raw.split(",")
        if slug.strip()
    ]


def fetch_greenhouse(
    search_term="",
    company_slugs=None,
):
    if company_slugs is None:
        company_slugs = (
            get_greenhouse_companies()
        )

    if not company_slugs:
        return {
            "source":
                "Greenhouse",

            "success":
                False,

            "jobs":
                [],

            "error":
                "No GREENHOUSE_COMPANIES configured",
        }

    jobs = []

    try:
        for slug in company_slugs:
            url = (
                "https://boards-api.greenhouse.io/"
                f"v1/boards/{slug}/jobs"
            )

            data = fetch_json(
                url,
                {
                    "content":
                        "true",
                },
            )

            if not isinstance(
                data,
                dict,
            ):
                continue

            results = data.get(
                "jobs",
                [],
            )

            if not isinstance(
                results,
                list,
            ):
                continue

            for item in results:
                if not isinstance(
                    item,
                    dict,
                ):
                    continue

                title = safe_string(
                    item.get(
                        "title",
                        "",
                    )
                )

                location_obj = (
                    item.get(
                        "location"
                    )
                    or {}
                )

                if not isinstance(
                    location_obj,
                    dict,
                ):
                    location_obj = {}

                job_location = safe_string(
                    location_obj.get(
                        "name",
                        "",
                    )
                )

                absolute_url = safe_string(
                    item.get(
                        "absolute_url",
                        "",
                    )
                )

                content = safe_string(
                    item.get(
                        "content",
                        "",
                    )
                )

                if (
                    not title
                    or not absolute_url
                ):
                    continue

                searchable = safe_join(
                    [
                        title,
                        job_location,
                        content,
                    ]
                )

                jobs.append(
                    {
                        "title":
                            title,

                        "company":
                            slug,

                        "companyUrl":
                            "",

                        "location":
                            job_location
                            or "Not specified",

                        "isRemote":
                            "remote"
                            in searchable.lower(),

                        "jobType":
                            "",

                        "description":
                            content,

                        "skills":
                            [],

                        "salary":
                            "Not specified",

                        "minSalary":
                            None,

                        "maxSalary":
                            None,

                        "salaryCurrency":
                            "",

                        "salarySource":
                            "",

                        "source":
                            "Greenhouse",

                        "jobUrl":
                            absolute_url,

                        "jobUrlDirect":
                            absolute_url,

                        "applicationUrl":
                            absolute_url,

                        "postedDate":
                            item.get(
                                "updated_at"
                            ),
                    }
                )

                if len(jobs) >= FETCH_POOL_SIZE:
                    break

            if len(jobs) >= FETCH_POOL_SIZE:
                break

        return {
            "source":
                "Greenhouse",

            "success":
                True,

            "jobs":
                jobs,

            "error":
                None,
        }

    except Exception as error:
        return {
            "source":
                "Greenhouse",

            "success":
                False,

            "jobs":
                [],

            "error":
                str(error),
        }


# ============================================================
# LEVER
# ============================================================

def get_lever_companies():
    raw = os.getenv(
        "LEVER_COMPANIES",
        "",
    )

    return [
        slug.strip()
        for slug in raw.split(",")
        if slug.strip()
    ]


def fetch_lever(
    search_term="",
    company_slugs=None,
):
    if company_slugs is None:
        company_slugs = (
            get_lever_companies()
        )

    if not company_slugs:
        return {
            "source":
                "Lever",

            "success":
                False,

            "jobs":
                [],

            "error":
                "No LEVER_COMPANIES configured",
        }

    jobs = []

    try:
        for slug in company_slugs:
            url = (
                "https://api.lever.co/v0/postings/"
                f"{slug}"
            )

            data = fetch_json(
                url
            )

            if not isinstance(
                data,
                list,
            ):
                continue

            for item in data:
                if not isinstance(
                    item,
                    dict,
                ):
                    continue

                title = safe_string(
                    item.get(
                        "text",
                        "",
                    )
                )

                categories = (
                    item.get(
                        "categories"
                    )
                    or {}
                )

                if not isinstance(
                    categories,
                    dict,
                ):
                    categories = {}

                job_location = safe_string(
                    categories.get(
                        "location",
                        "",
                    )
                )

                content = (
                    item.get(
                        "descriptionPlain",
                        "",
                    )
                    or item.get(
                        "description",
                        "",
                    )
                )

                content = safe_string(
                    content
                )

                urls = (
                    item.get(
                        "urls"
                    )
                    or {}
                )

                if not isinstance(
                    urls,
                    dict,
                ):
                    urls = {}

                posting_url = safe_string(
                    urls.get(
                        "show",
                        "",
                    )
                )

                if (
                    not title
                    or not posting_url
                ):
                    continue

                workplace_type = safe_string(
                    item.get(
                        "workplaceType",
                        "",
                    )
                )

                jobs.append(
                    {
                        "title":
                            title,

                        "company":
                            slug,

                        "companyUrl":
                            "",

                        "location":
                            job_location
                            or "Not specified",

                        "isRemote":
                            workplace_type.lower()
                            == "remote",

                        "jobType":
                            safe_string(
                                categories.get(
                                    "commitment",
                                    "",
                                )
                            ),

                        "description":
                            content,

                        "skills":
                            [],

                        "salary":
                            safe_string(
                                item.get(
                                    "salaryDescription",
                                    "Not specified",
                                )
                            ),

                        "minSalary":
                            None,

                        "maxSalary":
                            None,

                        "salaryCurrency":
                            "",

                        "salarySource":
                            "",

                        "source":
                            "Lever",

                        "jobUrl":
                            posting_url,

                        "jobUrlDirect":
                            posting_url,

                        "applicationUrl":
                            posting_url,

                        "postedDate":
                            item.get(
                                "createdAt"
                            ),
                    }
                )

                if len(jobs) >= FETCH_POOL_SIZE:
                    break

            if len(jobs) >= FETCH_POOL_SIZE:
                break

        return {
            "source":
                "Lever",

            "success":
                True,

            "jobs":
                jobs,

            "error":
                None,
        }

    except Exception as error:
        return {
            "source":
                "Lever",

            "success":
                False,

            "jobs":
                [],

            "error":
                str(error),
        }


# ============================================================
# REMOTIVE API
# ============================================================

def fetch_remotive(
    search_term="",
):
    try:
        url = "https://remotive.com/api/remote-jobs"
        data = fetch_json(url)

        raw_jobs = []
        if isinstance(data, dict):
            raw_jobs = data.get("jobs", [])
        elif isinstance(data, list):
            raw_jobs = data

        jobs = []
        for item in raw_jobs:
            if not isinstance(item, dict):
                continue

            title = safe_string(item.get("title"))
            company = safe_string(item.get("company_name"))
            url_link = safe_string(item.get("url"))

            if not title or not url_link:
                continue

            raw_type = safe_string(item.get("job_type")).lower()
            job_type = "Full-Time"
            if "intern" in raw_type or "intern" in title.lower():
                job_type = "Internship"
            elif "contract" in raw_type:
                job_type = "Contract"
            elif "part" in raw_type and "time" in raw_type:
                job_type = "Part-Time"

            tags = item.get("tags") or []
            if not isinstance(tags, list):
                tags = [str(tags)]

            jobs.append(
                {
                    "title": title,
                    "company": company or "Unknown Company",
                    "companyUrl": "",
                    "location": safe_string(item.get("candidate_required_location")) or "Remote",
                    "isRemote": True,
                    "jobType": job_type,
                    "description": safe_string(item.get("description")),
                    "skills": [safe_string(t) for t in tags if safe_string(t)],
                    "salary": safe_string(item.get("salary")) or "Not specified",
                    "minSalary": None,
                    "maxSalary": None,
                    "salaryCurrency": "",
                    "salarySource": "",
                    "source": "Remotive",
                    "jobUrl": url_link,
                    "jobUrlDirect": url_link,
                    "applicationUrl": url_link,
                    "postedDate": item.get("publication_date"),
                }
            )

        return {
            "source": "Remotive",
            "success": True,
            "jobs": jobs,
            "error": None,
        }
    except Exception as error:
        return {
            "source": "Remotive",
            "success": False,
            "jobs": [],
            "error": str(error),
        }


# ============================================================
# JOBSPY NATIVE SCRAPERS (LINKEDIN, INDEED)
# ============================================================

def fetch_jobspy_source(
    site_name="linkedin",
    search_term="",
    location="",
    job_type="",
    work_mode="",
    results_wanted=None,
    hours_old=None,
):
    source_name = JOBSPY_SOURCE_NAMES.get(
        safe_string(site_name).lower(),
        safe_string(site_name).capitalize(),
    )
    try:
        from . import scrape_jobs

        # Let the provider search with the current query/profile intent and
        # don't silently constrain an empty location to one country or role.
        st = safe_string(search_term) or "jobs"
        loc = safe_string(location) or None

        raw_job_type = safe_string(job_type).lower()
        if "intern" in raw_job_type:
            scraper_job_type = "internship"
        elif "full" in raw_job_type:
            scraper_job_type = "fulltime"
        elif "part" in raw_job_type:
            scraper_job_type = "parttime"
        elif "contract" in raw_job_type:
            scraper_job_type = "contract"
        elif "temporary" in raw_job_type:
            scraper_job_type = "temporary"
        else:
            scraper_job_type = None

        configured_country = safe_string(
            os.getenv("JOBPULSE_INDEED_COUNTRY")
        )
        indian_locations = (
            "india",
            "mumbai",
            "bombay",
            "delhi",
            "new delhi",
            "bengaluru",
            "bangalore",
            "hyderabad",
            "chennai",
            "pune",
            "kolkata",
            "ahmedabad",
            "gurugram",
            "gurgaon",
            "noida",
            "thane",
        )
        location_text = safe_string(location).lower()
        country_indeed = configured_country or (
            "india"
            if any(city in location_text for city in indian_locations)
            else "usa"
        )

        df = scrape_jobs(
            site_name=[site_name],
            search_term=st,
            location=loc,
            job_type=scraper_job_type,
            is_remote="remote" in safe_string(work_mode).lower(),
            results_wanted=max(
                1,
                safe_int(results_wanted, JOBSPY_RESULTS_WANTED),
            ),
            hours_old=hours_old,
            verbose=1,
            country_indeed=country_indeed,
        )

        jobs = []
        if df is not None and not df.empty:
            for _, row in df.iterrows():
                title = safe_string(row.get("title"))
                url = safe_string(row.get("job_url"))
                if not title:
                    continue

                jobs.append(
                    {
                        "title": title,
                        "company": safe_string(row.get("company")) or "Unknown Company",
                        "companyUrl": "",
                        "location": safe_string(row.get("location")) or "Remote",
                        "isRemote": bool(row.get("is_remote")),
                        "jobType": safe_string(row.get("job_type")) or {
                            "internship": "Internship",
                            "fulltime": "Full-Time",
                            "parttime": "Part-Time",
                            "contract": "Contract",
                            "temporary": "Temporary",
                        }.get(scraper_job_type, ""),
                        "description": safe_string(row.get("description")),
                        "skills": [],
                        "salary": "Not specified",
                        "minSalary": row.get("min_amount"),
                        "maxSalary": row.get("max_amount"),
                        "salaryCurrency": safe_string(row.get("currency")),
                        "salarySource": safe_string(row.get("site")),
                        "source": source_name,
                        "jobUrl": url,
                        "jobUrlDirect": url,
                        "applicationUrl": url,
                        "postedDate": str(row.get("date_posted")) if row.get("date_posted") is not None else None,
                        "sourceSearchLocation": loc or "",
                    }
                )

        return {
            "source": source_name,
            "success": True,
            "jobs": jobs,
            "error": None,
        }
    except Exception as error:
        return {
            "source": source_name,
            "success": False,
            "jobs": [],
            "error": str(error),
        }


# ============================================================
# PROVIDER RESULT NORMALIZATION
# ============================================================

def normalize_provider_result(
    source,
    result,
):
    if not isinstance(
        result,
        dict,
    ):
        return {
            "source":
                source,

            "success":
                False,

            "jobs":
                [],

            "error":
                "Provider returned invalid result",
        }

    jobs = result.get(
        "jobs",
        [],
    )

    if not isinstance(
        jobs,
        list,
    ):
        jobs = []

    return {
        "source":
            result.get(
                "source",
                source,
            )
            or source,

        "success":
            bool(
                result.get(
                    "success",
                    False,
                )
            ),

        "jobs":
            jobs,

        "error":
            result.get(
                "error"
            ),
    }


# ============================================================
# RUN ALL SOURCES CONCURRENTLY
# ============================================================

def jobspy_search_terms(search_term, job_type):
    term = safe_string(search_term)
    if not term:
        return ["jobs"]

    normalized_term = " ".join(term.lower().split())
    normalized_job_type = safe_string(job_type).lower()

    if "intern" in normalized_job_type and normalized_term in {
        "sde",
        "software engineer",
        "software development engineer",
    }:
        return list(SDE_INTERNSHIP_SEARCH_TERMS)

    terms = [term]
    if "intern" in normalized_job_type:
        lowered = normalized_term
        for suffix in (" internship", " intern"):
            if not lowered.endswith(suffix):
                terms.append(f"{term}{suffix}")

    if normalized_term == "software engineer" and "intern" in normalized_job_type:
        additional = [
            "software developer internship",
            "full stack developer internship",
            "web developer internship",
        ]
        terms.extend(additional)

    return list(dict.fromkeys(terms))


def jobspy_search_locations(location):
    requested_location = safe_string(location)
    city = requested_location.split(",", 1)[0].strip().lower()
    if city in {"mumbai", "bombay", "navi mumbai", "thane"}:
        return ["Mumbai", "Navi Mumbai", "Thane"]
    return [requested_location]


def deduplicate_provider_jobs(jobs):
    seen = set()
    unique = []
    for job in jobs:
        identity = safe_string(
            job.get("jobUrl")
            or job.get("jobUrlDirect")
            or job.get("applicationUrl")
        )
        if not identity:
            identity = "|".join(
                (
                    safe_string(job.get("title")),
                    safe_string(job.get("company")),
                    safe_string(job.get("location")),
                )
            )
        key = identity.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(job)
    return unique


def fetch_jobspy_queries(
    site_name,
    search_terms,
    location,
    job_type,
    work_mode,
    results_wanted=JOBSPY_RESULTS_WANTED,
    hours_old=None,
):
    source_name = JOBSPY_SOURCE_NAMES.get(
        safe_string(site_name).lower(),
        safe_string(site_name).capitalize(),
    )
    query_result_limit = max(
        1,
        safe_int(results_wanted, JOBSPY_RESULTS_WANTED),
    )
    query_result_limit = min(
        MAX_PROVIDER_JOBS,
        query_result_limit,
    )
    queries = [
        (search_term, query_location)
        for search_term in search_terms
        for query_location in jobspy_search_locations(location)
    ]
    if not queries:
        queries = [("", safe_string(location))]
    budget_per_query, remaining_budget = divmod(
        query_result_limit,
        len(queries),
    )
    query_budgets = [
        budget_per_query + int(index < remaining_budget)
        for index in range(len(queries))
    ]
    results = []
    max_workers = max(1, min(3, len(queries)))
    executor = ThreadPoolExecutor(max_workers=max_workers)
    futures = {
        executor.submit(
            fetch_jobspy_source,
            site_name,
            search_term,
            query_location,
            job_type,
            work_mode,
            query_budgets[index],
            hours_old,
        ): (search_term, query_location)
        for index, (search_term, query_location) in enumerate(queries)
    }
    try:
        for future in as_completed(
            futures,
            timeout=JOBSPY_QUERY_TIMEOUT,
        ):
            search_term, query_location = futures[future]
            try:
                results.append((search_term, query_location, future.result()))
            except Exception as error:
                results.append(
                    (
                        search_term,
                        query_location,
                        {
                            "success": False,
                            "jobs": [],
                            "error": str(error),
                        },
                    )
                )
    except FuturesTimeoutError:
        completed_queries = {
            (term, query_location)
            for term, query_location, _ in results
        }
        for future, (search_term, query_location) in futures.items():
            if (search_term, query_location) in completed_queries:
                continue
            if future.done():
                try:
                    results.append((search_term, query_location, future.result()))
                except Exception as error:
                    results.append(
                        (
                            search_term,
                            query_location,
                            {
                                "success": False,
                                "jobs": [],
                                "error": str(error),
                            },
                        )
                    )
                continue
            future.cancel()
            results.append(
                (
                    search_term,
                    query_location,
                    {
                        "success": False,
                        "jobs": [],
                        "error": (
                            f"Search query for {query_location} timed out after "
                            f"{JOBSPY_QUERY_TIMEOUT} seconds"
                        ),
                    },
                )
            )
    finally:
        executor.shutdown(wait=False, cancel_futures=True)

    jobs = deduplicate_provider_jobs(
        [
            job
            for _, _, result in results
            for job in result.get("jobs", [])
            if isinstance(job, dict)
        ]
    )
    jobs = jobs[:query_result_limit]
    successful_queries = [
        f"{search_term} in {query_location}".strip()
        for search_term, query_location, result in results
        if result.get("success")
    ]
    failed_queries = [
        {
            "searchTerm": search_term,
            "location": query_location,
            "error": result.get("error") or "Provider request failed",
        }
        for search_term, query_location, result in results
        if not result.get("success")
    ]

    return {
        "source": source_name,
        "success": bool(successful_queries),
        "jobs": jobs,
        "error": None if not failed_queries else {
            "failedQueries": failed_queries,
            "successfulQueries": successful_queries,
        },
    }


def canonical_citation_url(value):
    try:
        parsed = urlsplit(safe_string(value))
    except ValueError:
        return ""
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        return ""
    return (
        parsed.hostname.lower(),
        parsed.path.rstrip("/").lower(),
    )


def source_name_from_url(value):
    hostname = urlsplit(value).hostname or ""
    hostname = hostname.lower().removeprefix("www.")
    source_domains = {
        "naukri.com": "Naukri",
        "internshala.com": "Internshala",
        "indeed.com": "Indeed",
        "linkedin.com": "LinkedIn",
        "foundit.in": "Foundit",
        "hirist.tech": "Hirist",
        "hirist.com": "Hirist",
        "cutshort.io": "Cutshort",
        "wellfound.com": "Wellfound",
        "glassdoor.com": "Glassdoor",
        "glassdoor.co.in": "Glassdoor",
        "shine.com": "Shine",
        "timesjobs.com": "TimesJobs",
        "unstop.com": "Unstop",
        "cuvette.tech": "Cuvette",
        "instahyre.com": "Instahyre",
        "freshersworld.com": "Freshersworld",
        "jobs.lever.co": "Lever",
        "boards.greenhouse.io": "Greenhouse",
    }
    for domain, source in source_domains.items():
        if hostname == domain or hostname.endswith(f".{domain}"):
            return source
    return hostname or "Google Search"


def gemini_output_text_and_citations(response):
    text_parts = []
    citations = set()

    def collect_citations(value):
        if isinstance(value, dict):
            if (
                value.get("type") == "url_citation"
                and safe_string(value.get("url"))
            ):
                citations.add(
                    canonical_citation_url(value["url"])
                )
            for key, nested in value.items():
                if key == "annotations" and isinstance(nested, list):
                    for annotation in nested:
                        if isinstance(annotation, dict):
                            url = safe_string(annotation.get("url"))
                            if url and annotation.get("type") in {
                                "url_citation",
                                "citation",
                            }:
                                citations.add(canonical_citation_url(url))
                else:
                    collect_citations(nested)
        elif isinstance(value, list):
            for item in value:
                collect_citations(item)

    # Interactions API format
    output = response.get("output")
    if isinstance(output, list):
        for step in output:
            if not isinstance(step, dict) or step.get("type") != "model_output":
                continue
            content = step.get("content")
            if not isinstance(content, list):
                continue
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    text_parts.append(safe_string(block.get("text")))
                collect_citations(block)

    if not text_parts and safe_string(response.get("output_text")):
        text_parts.append(safe_string(response["output_text"]))

    # Standard Gemini generateContent format
    candidates = response.get("candidates")
    if isinstance(candidates, list):
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            content = candidate.get("content", {})
            parts = content.get("parts", []) if isinstance(content, dict) else []
            if isinstance(parts, list):
                for part in parts:
                    if isinstance(part, dict) and safe_string(part.get("text")):
                        text_parts.append(safe_string(part.get("text")))
            grounding = candidate.get("groundingMetadata", {})
            if isinstance(grounding, dict):
                chunks = grounding.get("groundingChunks", [])
                if isinstance(chunks, list):
                    for chunk in chunks:
                        if isinstance(chunk, dict):
                            web = chunk.get("web", {})
                            uri = safe_string(web.get("uri") or web.get("url"))
                            if uri:
                                citations.add(canonical_citation_url(uri))

    collect_citations(response.get("output", []))
    return "\n".join(part for part in text_parts if part), citations


def parse_gemini_jobs(text):
    decoder = json.JSONDecoder()
    for start, character in enumerate(text):
        if character not in "{[":
            continue
        try:
            payload, _ = decoder.raw_decode(text[start:])
        except json.JSONDecodeError:
            continue
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict) and isinstance(payload.get("jobs"), list):
            return payload["jobs"]
    return []


def extract_candidate_profile(
    profile=None,
    search_term="",
    location="",
    job_type="",
    work_mode="",
):
    profile = profile or {}

    target_role = (
        safe_string(profile.get("targetRole"))
        or safe_string(profile.get("target_role"))
        or safe_string(search_term)
        or "Software Engineer"
    )

    raw_skills = []
    for key in ("skills", "resumeSkills", "resume_skills"):
        val = profile.get(key)
        if isinstance(val, (list, tuple, set)):
            raw_skills.extend([safe_string(s) for s in val if safe_string(s)])
        elif isinstance(val, str) and val.strip():
            raw_skills.extend([s.strip() for s in re.split(r"[,;|\n]+", val) if s.strip()])

    unique_skills = []
    seen_skills = set()
    for s in raw_skills:
        k = s.lower()
        if k not in seen_skills:
            seen_skills.add(k)
            unique_skills.append(s)

    exp_years = profile.get("yearsOfExperience")
    if exp_years is None:
        exp_years = profile.get("years_of_experience")
    if exp_years is None:
        exp_years = profile.get("experience_years")
    try:
        years_num = float(exp_years) if exp_years is not None else None
    except (ValueError, TypeError):
        years_num = None

    experience_level_str = ""
    if years_num is not None:
        if years_num <= 0.5:
            experience_level_str = "Fresher / Entry-Level (0 years)"
        elif years_num <= 2:
            experience_level_str = f"Junior / Early Career ({years_num:g} years)"
        else:
            experience_level_str = f"{years_num:g}+ years of experience"

    education_items = []
    raw_edu = profile.get("education", [])
    if isinstance(raw_edu, list):
        for item in raw_edu:
            if isinstance(item, dict):
                degree = safe_string(item.get("degree"))
                field = safe_string(item.get("field"))
                institution = safe_string(item.get("institution"))
                parts = [p for p in [degree, field, institution] if p]
                if parts:
                    education_items.append(" in ".join(parts[:2]) + (f" from {institution}" if institution else ""))
            elif isinstance(item, str) and item.strip():
                education_items.append(item.strip())

    project_items = []
    raw_proj = profile.get("projects", [])
    if isinstance(raw_proj, list):
        for item in raw_proj:
            if isinstance(item, str) and item.strip():
                project_items.append(item.strip())
            elif isinstance(item, dict):
                title = safe_string(item.get("title") or item.get("name"))
                desc = safe_string(item.get("description"))
                if title:
                    project_items.append(f"{title}: {desc}" if desc else title)

    cert_items = []
    raw_certs = profile.get("certifications", [])
    if isinstance(raw_certs, list):
        for item in raw_certs:
            if isinstance(item, str) and item.strip():
                cert_items.append(item.strip())

    preferred_loc = (
        safe_string(location)
        or safe_string(profile.get("preferredLocation"))
        or safe_string(profile.get("location"))
        or "India"
    )

    preferred_mode = (
        safe_string(work_mode)
        or safe_string(profile.get("preferredWorkMode"))
        or safe_string(profile.get("work_mode"))
        or "any"
    )

    looking_for_type = (
        safe_string(job_type)
        or safe_string(profile.get("lookingFor"))
        or safe_string(profile.get("job_type"))
        or "any"
    )

    preferred_companies = []
    raw_comps = profile.get("preferredCompanies", [])
    if isinstance(raw_comps, list):
        preferred_companies = [safe_string(c) for c in raw_comps if safe_string(c)]

    bio = safe_string(profile.get("bio")) or safe_string(profile.get("resumeText"))[:250]

    has_profile_data = bool(
        unique_skills
        or education_items
        or project_items
        or cert_items
        or years_num is not None
        or safe_string(profile.get("targetRole"))
        or safe_string(profile.get("bio"))
    )

    return {
        "target_role": target_role,
        "skills": unique_skills,
        "experience_years": years_num,
        "experience_level": experience_level_str,
        "education": education_items,
        "projects": project_items,
        "certifications": cert_items,
        "preferred_location": preferred_loc,
        "preferred_work_mode": preferred_mode,
        "looking_for": looking_for_type,
        "preferred_companies": preferred_companies,
        "bio": bio,
        "has_profile_data": has_profile_data,
    }


def build_candidate_profile_prompt_text(candidate):
    lines = [f"- Target Role: {candidate['target_role']}"]
    if candidate["skills"]:
        lines.append(f"- Key Skills: {', '.join(candidate['skills'][:15])}")
    if candidate["experience_level"]:
        lines.append(f"- Experience Level: {candidate['experience_level']}")
    if candidate["looking_for"] and candidate["looking_for"].lower() != "any":
        lines.append(f"- Looking For: {candidate['looking_for']}")
    if candidate["preferred_location"]:
        lines.append(f"- Location: {candidate['preferred_location']}")
    if candidate["preferred_work_mode"] and candidate["preferred_work_mode"].lower() != "any":
        lines.append(f"- Work Mode: {candidate['preferred_work_mode']}")
    if candidate["education"]:
        lines.append(f"- Education: {'; '.join(candidate['education'][:2])}")
    if candidate["projects"]:
        lines.append(f"- Notable Projects: {'; '.join(candidate['projects'][:3])}")
    if candidate["certifications"]:
        lines.append(f"- Certifications: {', '.join(candidate['certifications'][:3])}")
    if candidate["preferred_companies"]:
        lines.append(f"- Preferred Companies: {', '.join(candidate['preferred_companies'][:5])}")
    if candidate["bio"]:
        lines.append(f"- Summary/Bio: {candidate['bio'][:150]}")
    return "\n".join(lines)


def execute_gemini_request(prompt, api_key):
    request_body = {
        "model": GEMINI_SEARCH_MODEL,
        "input": prompt,
        "tools": [{"type": "google_search"}],
    }
    request = Request(
        "https://generativelanguage.googleapis.com/v1beta/interactions",
        data=json.dumps(request_body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
            "x-goog-api-key": api_key,
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=GEMINI_SEARCH_TIMEOUT) as response:
            response_body = response.read()
        payload = json.loads(response_body.decode("utf-8", errors="replace"))
        text, citations = gemini_output_text_and_citations(payload)
        return text, citations, None
    except HTTPError as error:
        logger.warning(
            "Gemini grounded job search returned HTTP %s",
            error.code,
        )
        if error.code == 429:
            message = "Gemini API quota exceeded or rate limit reached"
            return "", set(), message
        elif error.code in {401, 403}:
            message = "Gemini API key is invalid or lacks permission"
            return "", set(), message
        elif error.code == 404:
            # Fall back to standard generateContent endpoint
            fallback_models = [
                GEMINI_SEARCH_MODEL,
                "gemini-2.5-flash",
                "gemini-2.0-flash",
                "gemini-1.5-flash",
            ]
            seen_models = set()
            for model_name in fallback_models:
                if model_name in seen_models:
                    continue
                seen_models.add(model_name)
                gen_body = {
                    "contents": [{"parts": [{"text": prompt}]}],
                    "tools": [{"google_search": {}}],
                }
                gen_req = Request(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent",
                    data=json.dumps(gen_body).encode("utf-8"),
                    headers={
                        "Content-Type": "application/json",
                        "User-Agent": USER_AGENT,
                        "x-goog-api-key": api_key,
                    },
                    method="POST",
                )
                try:
                    with urlopen(gen_req, timeout=GEMINI_SEARCH_TIMEOUT) as gen_resp:
                        gen_payload = json.loads(gen_resp.read().decode("utf-8", errors="replace"))
                    text, citations = gemini_output_text_and_citations(gen_payload)
                    return text, citations, None
                except Exception:
                    continue
            message = "Gemini model or grounded-search endpoint is unavailable"
            return "", set(), message
        else:
            message = f"Gemini grounded search returned HTTP {error.code}"
            return "", set(), message
    except Exception as error:
        logger.warning(
            "Gemini grounded job search failed (%s)",
            type(error).__name__,
        )
        return "", set(), f"Gemini grounded search failed ({type(error).__name__})"


def fetch_gemini_search(
    search_term="",
    location="",
    job_type="",
    work_mode="",
    results_wanted=20,
    hours_old=None,
    profile=None,
    sites=None,
):
    api_key = safe_string(os.getenv("GEMINI_API_KEY"))
    if not api_key:
        return {
            "source": "Gemini Search",
            "success": False,
            "jobs": [],
            "error": "GEMINI_API_KEY is not configured",
        }

    candidate = extract_candidate_profile(
        profile=profile,
        search_term=search_term,
        location=location,
        job_type=job_type,
        work_mode=work_mode,
    )

    requested_results = max(1, safe_int(results_wanted, 20))
    requested_location = candidate["preferred_location"]
    freshness_days = max(
        1,
        math.ceil(safe_int(hours_old, 24 * 60) / 24),
    )

    sites_filter = safe_string(sites).lower()

    # Legacy / single query mode: used when no detailed candidate profile is passed
    # and results_wanted <= 10, ensuring compatibility with unit tests and lightweight requests.
    if not candidate["has_profile_data"] and requested_results <= 10:
        single_result_limit = min(30, requested_results)
        prompt = (
            "Use Google Search to find real, currently open job or internship "
            "postings. Search Naukri, Internshala, LinkedIn, Indeed, Foundit, "
            "Hirist, Cutshort, Wellfound, company career pages, and any other "
            "relevant job boards. Search independently across more than one source. "
            "Match role: "
            f"{candidate['target_role']}. Location: {requested_location or 'India'}. "
            f"Employment type: {safe_string(candidate['looking_for']) or 'any'}. "
            f"Work mode: {safe_string(candidate['preferred_work_mode']) or 'any'}. Prefer postings from "
            f"the last {freshness_days} days. Return at most {single_result_limit} "
            "distinct listings. Do not invent, infer, or fill unknown values. "
            "Every job_url must be the exact public listing URL found through "
            "Google Search, not a search page or company homepage. For description, "
            "include only a short verbatim excerpt that states the job's required "
            "experience or qualifications; leave it empty when unavailable. "
            "Return only a JSON object with a jobs array. Each item must have "
            "title, company, location, job_type, work_mode, experience, "
            "posted_date, job_url, and description."
        )
        queries = [("unified", prompt, single_result_limit)]
    else:
        # Targeted multi-query mode: specifically targets Naukri, Internshala, and top job boards
        # leveraging the full candidate profile to fetch far more high-relevance jobs.
        profile_text = build_candidate_profile_prompt_text(candidate)
        per_query_limit = min(25, max(10, math.ceil(requested_results / 2)))

        queries = []

        # 1. Naukri targeted search
        if not sites_filter or "naukri" in sites_filter:
            prompt_naukri = (
                "Use Google Search to find real, currently open job postings on Naukri (site:naukri.com).\n"
                f"Candidate Profile:\n{profile_text}\n\n"
                "Search specifically for active job listings on naukri.com that match this candidate's target role, "
                f"technical skills, and experience level ({candidate['experience_level'] or 'open'}). "
                f"Target Location: {requested_location}. "
                f"Prefer postings from the last {freshness_days} days. Return at most {per_query_limit} distinct listings. "
                "Do not invent or infer values. Every job_url must be the exact public listing URL on naukri.com found through "
                "Google Search (e.g. https://www.naukri.com/job-listings-...). For description, include key requirements. "
                "Return only a JSON object with a jobs array. Each item must have title, company, location, job_type, "
                "work_mode, experience, skills, salary, posted_date, job_url, and description."
            )
            queries.append(("naukri", prompt_naukri, per_query_limit))

        # 2. Internshala targeted search (especially for internships, students, and freshers)
        if not sites_filter or "internshala" in sites_filter:
            prompt_internshala = (
                "Use Google Search to find real, currently open internship and fresher job listings on Internshala (site:internshala.com).\n"
                f"Candidate Profile:\n{profile_text}\n\n"
                "Search specifically for active listings on internshala.com for tech, software development, web development, "
                f"or data internships and entry-level positions matching the candidate's skills. "
                f"Target Location: {requested_location} (including Work From Home / Remote). "
                f"Prefer postings from the last {freshness_days} days. Return at most {per_query_limit} distinct listings. "
                "Do not invent or infer values. Every job_url must be the exact public listing URL on internshala.com found through "
                "Google Search (e.g. https://internshala.com/internship/detail/... or https://internshala.com/job/detail/...). "
                "Return only a JSON object with a jobs array. Each item must have title, company, location, job_type, "
                "work_mode, experience, skills, salary, posted_date, job_url, and description."
            )
            queries.append(("internshala", prompt_internshala, per_query_limit))

        # 3. Comprehensive tech job boards (Foundit, Unstop, Wellfound, LinkedIn, Cutshort, Hirist)
        if not sites_filter:
            prompt_tech_portals = (
                "Use Google Search to find real, currently open job or internship postings on top tech job platforms including "
                "Foundit (site:foundit.in), Unstop (site:unstop.com), Wellfound (site:wellfound.com), LinkedIn (site:linkedin.com/jobs), "
                "Hirist (site:hirist.tech), Cutshort (site:cutshort.io), and tech company career pages.\n"
                f"Candidate Profile:\n{profile_text}\n\n"
                f"Find active developer and engineer listings matching the candidate's skills and target role in {requested_location}. "
                f"Prefer postings from the last {freshness_days} days. Return at most {per_query_limit} distinct listings. "
                "Every job_url must be the exact public listing URL found through Google Search. "
                "Return only a JSON object with a jobs array. Each item must have title, company, location, job_type, "
                "work_mode, experience, skills, salary, posted_date, job_url, and description."
            )
            queries.append(("tech_portals", prompt_tech_portals, per_query_limit))

    # Execute queries
    combined_jobs = []
    seen_urls = set()
    last_error = None
    any_query_succeeded = False

    def run_one_query(query_tuple):
        tag, q_prompt, q_limit = query_tuple
        text, citations, error = execute_gemini_request(q_prompt, api_key)
        return tag, text, citations, error, q_limit

    if len(queries) == 1:
        query_results = [run_one_query(queries[0])]
    else:
        with ThreadPoolExecutor(max_workers=min(3, len(queries))) as executor:
            query_results = list(executor.map(run_one_query, queries))

    for tag, text, citations, error, q_limit in query_results:
        if error:
            last_error = error
            continue

        if not text:
            if not last_error:
                last_error = "Gemini returned no grounded job data"
            continue

        any_query_succeeded = True
        parsed_items = parse_gemini_jobs(text)

        for item in parsed_items:
            if not isinstance(item, dict):
                continue

            title = safe_string(item.get("title"))
            url = safe_string(item.get("job_url") or item.get("jobUrl"))
            canonical_url = canonical_citation_url(url)

            if not title or not canonical_url or canonical_url in seen_urls:
                continue

            # Citations verification
            if citations:
                matches_citation = (
                    canonical_url in citations
                    or any(
                        cit[0].removeprefix("www.") == canonical_url[0].removeprefix("www.")
                        and cit[1] == canonical_url[1]
                        for cit in citations
                    )
                )
                if not matches_citation:
                    continue

            seen_urls.add(canonical_url)
            company = safe_string(item.get("company"))
            job_location = safe_string(item.get("location"))
            description = safe_string(item.get("description"))
            source = source_name_from_url(url)
            work_mode_val = safe_string(item.get("work_mode") or item.get("workMode"))
            is_remote = (
                "remote" in work_mode_val.lower()
                or "remote" in job_location.lower()
                or "work from home" in work_mode_val.lower()
                or "work from home" in job_location.lower()
            )

            job_skills = safe_array(item.get("skills", []))

            combined_jobs.append(
                {
                    "title": title,
                    "company": company or "Unknown Company",
                    "companyUrl": "",
                    "location": job_location or requested_location or "Not specified",
                    "sourceSearchLocation": requested_location,
                    "isRemote": is_remote,
                    "jobType": safe_string(item.get("job_type") or item.get("jobType")),
                    "employmentType": safe_string(item.get("job_type") or item.get("employmentType")),
                    "workMode": work_mode_val,
                    "experience": safe_string(item.get("experience")),
                    "description": description,
                    "requirements": description,
                    "qualifications": description,
                    "skills": job_skills,
                    "salary": safe_string(item.get("salary")) or "Not specified",
                    "source": source,
                    "jobUrl": url,
                    "jobUrlDirect": url,
                    "applicationUrl": url,
                    "postedDate": safe_string(item.get("posted_date") or item.get("postedDate")) or None,
                }
            )

            if len(combined_jobs) >= requested_results:
                break

    if not combined_jobs and not any_query_succeeded:
        return {
            "source": "Gemini Search",
            "success": False,
            "jobs": [],
            "error": last_error or "Gemini returned no grounded job data",
        }

    return {
        "source": "Gemini Search",
        "success": True,
        "jobs": combined_jobs,
        "error": None,
    }


def fetch_external_sources(
    search_term="",
    location="",
    job_type="",
    work_mode="",
    results_wanted=JOBSPY_RESULTS_WANTED,
    hours_old=None,
    profile=None,
    sites=None,
):
    """
    WIDE RETRIEVAL LAYER

    Search intent and location are used for job-board scrapers that support
    them. Other providers remain broad and are filtered later by the ranker.

    The architecture is:

        Provider retrieval
              ↓
        Wide candidate pool
              ↓
        server.py hard filters
              ↓
        matcher.py relevance
              ↓
        ranking

    No hardcoded:
        roles
        skills
        technologies
        countries
        companies
    are used here.
    """

    jobspy_search_term = safe_string(search_term)
    jobspy_terms = jobspy_search_terms(
        jobspy_search_term,
        job_type,
    )
    requested_results = max(
        1,
        safe_int(results_wanted, JOBSPY_RESULTS_WANTED),
    )
    requested_results = min(
        MAX_PROVIDER_JOBS,
        requested_results,
    )

    tasks = {
        "RemoteOK":
            lambda: fetch_remoteok(""),

        "Arbeitnow":
            lambda: fetch_arbeitnow(
                "",
                "",
            ),

        "Jobicy":
            lambda: fetch_jobicy(""),

        "Remotive":
            lambda: fetch_remotive(""),

        "The Muse":
            lambda: fetch_themuse(
                "",
                "",
            ),

        "LinkedIn":
            lambda: fetch_jobspy_queries(
                "linkedin",
                jobspy_terms,
                location,
                job_type,
                work_mode,
                requested_results,
                hours_old,
            ),

        "Indeed":
            lambda: fetch_jobspy_queries(
                "indeed",
                jobspy_terms,
                location,
                job_type,
                work_mode,
                requested_results,
                hours_old,
            ),

        "Google":
            lambda: fetch_jobspy_source(
                "google",
                jobspy_search_term,
                location,
                job_type,
                work_mode,
                requested_results,
                hours_old,
            ),

        "Glassdoor":
            lambda: fetch_jobspy_source(
                "glassdoor",
                jobspy_search_term,
                location,
                job_type,
                work_mode,
                requested_results,
                hours_old,
            ),

        "ZipRecruiter":
            lambda: fetch_jobspy_source(
                "zip_recruiter",
                jobspy_search_term,
                location,
                job_type,
                work_mode,
                requested_results,
                hours_old,
            ),

        "Naukri":
            lambda: fetch_jobspy_source(
                "naukri",
                jobspy_search_term,
                location,
                job_type,
                work_mode,
                requested_results,
                hours_old,
            ),

        "Bayt":
            lambda: fetch_jobspy_source(
                "bayt",
                jobspy_search_term,
                location,
                job_type,
                work_mode,
                requested_results,
                hours_old,
            ),

        "BDJobs":
            lambda: fetch_jobspy_source(
                "bdjobs",
                jobspy_search_term,
                location,
                job_type,
                work_mode,
                requested_results,
                hours_old,
            ),

        "Adzuna":
            lambda: fetch_adzuna(
                jobspy_search_term,
                location,
            ),

        "Gemini Search":
            lambda: fetch_gemini_search(
                jobspy_search_term,
                location,
                job_type,
                work_mode,
                requested_results,
                hours_old,
                profile=profile,
                sites=sites,
            ),

        "Greenhouse":
            lambda: fetch_greenhouse(""),

        "Lever":
            lambda: fetch_lever(""),
    }

    results = []

    max_workers = len(
        tasks
    )

    executor = ThreadPoolExecutor(max_workers=max_workers)
    futures = {
        executor.submit(task): source
        for source, task in tasks.items()
    }

    try:
        completed = as_completed(
            futures,
            timeout=PROVIDER_TIMEOUT,
        )

        for future in completed:
            source = futures[
                future
            ]

            try:
                result = future.result()

                results.append(
                    normalize_provider_result(
                        source,
                        result,
                    )
                )

            except Exception as error:
                results.append(
                    {
                        "source":
                            source,

                        "success":
                            False,

                        "jobs":
                            [],

                        "error":
                            str(error),
                    }
                )
    except FuturesTimeoutError:
        for future, source in futures.items():
            if not future.done():
                future.cancel()
                results.append(
                    {
                        "source": source,
                        "success": False,
                        "jobs": [],
                        "error": f"Provider timed out after {PROVIDER_TIMEOUT} seconds",
                    }
                )
    finally:
        # Do not make one blocked scraper thread hold the HTTP refresh open.
        executor.shutdown(wait=False, cancel_futures=True)

    # Keep provider results in a stable order.
    provider_order = {
        source:
            index
        for index, source
        in enumerate(
            tasks.keys()
        )
    }

    results.sort(
        key=lambda item:
            provider_order.get(
                item.get(
                    "source",
                    "",
                ),
                999,
            )
    )

    total_jobs = sum(
        len(
            item.get(
                "jobs",
                [],
            )
        )
        for item in results
    )

    successful_sources = [
        item.get(
            "source",
            "Unknown",
        )
        for item in results
        if item.get(
            "success",
            False,
        )
    ]

    failed_sources = [
        {
            "source":
                item.get(
                    "source",
                    "Unknown",
                ),

            "error":
                item.get(
                    "error"
                ),
        }
        for item in results
        if not item.get(
            "success",
            False,
        )
    ]

    for provider in results:
        source = provider.get("source", "Unknown")
        count = len(provider.get("jobs", []))
        if provider.get("success"):
            logger.info("Provider %s returned %d jobs", source, count)
        else:
            logger.warning(
                "Provider %s failed: %s",
                source,
                provider.get("error", "unknown error"),
            )

    return {
        "success":
            True,

        "jobs":
            [
                job
                for provider in results
                for job in provider.get(
                    "jobs",
                    [],
                )
            ],

        "providers":
            results,

        "totalJobs":
            total_jobs,

        "successfulSources":
            successful_sources,

        "failedSources":
            failed_sources,
    }
