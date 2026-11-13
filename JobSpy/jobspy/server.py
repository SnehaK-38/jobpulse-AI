from __future__ import annotations

import logging
import math
import os
import re
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import uvicorn
from dotenv import load_dotenv

# Load configuration before importing modules that read environment values
# during import (for example provider pool sizes and the embedding model).
load_dotenv()

from fastapi import FastAPI
from pydantic import BaseModel, Field

from . import external_sources
from .matcher import (
    ProfileReader,
    detect_job_skills,
    experience_within_tolerance,
    matcher,
)


# ============================================================
# CONFIG
# ============================================================

HOST = os.getenv(
    "JOBPULSE_HOST",
    "127.0.0.1",
)

PORT = int(
    os.getenv(
        "JOBPULSE_PORT",
        "8000",
    )
)

DEFAULT_RESULTS = int(
    os.getenv(
        "JOBPULSE_RESULTS_WANTED",
        "200",
    )
)

MAX_JOB_AGE_DAYS = int(
    os.getenv(
        "MAX_JOB_AGE_DAYS",
        "60",
    )
)

CANDIDATE_POOL_SIZE = int(
    os.getenv(
        "JOBPULSE_CANDIDATE_POOL_SIZE",
        "500",
    )
)


# ============================================================
# LOGGING
# ============================================================

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s",
)

logger = logging.getLogger("jobpulse")


# ============================================================
# APP
# ============================================================

app = FastAPI(
    title="JobPulse AI Python Service",
    version="5.0.0",
    description=(
        "Wide job aggregation, normalization, hard filtering "
        "and AI matching service"
    ),
)


# ============================================================
# REQUEST MODELS
# ============================================================

class SearchRequest(BaseModel):
    search_term: str = ""
    location: str = ""
    job_type: str = ""
    work_mode: str = ""
    hours_old: Optional[int] = None

    results_wanted: int = Field(
        default=DEFAULT_RESULTS,
        ge=1,
    )

    sites: Optional[List[str] | str] = None

    profile: Dict[str, Any] = Field(
        default_factory=dict
    )


class RankRequest(BaseModel):
    search_term: str = ""
    location: str = ""
    job_type: str = ""
    work_mode: str = ""

    profile: Dict[str, Any] = Field(
        default_factory=dict
    )

    jobs: List[Dict[str, Any]] = Field(
        default_factory=list
    )


class RefreshRequest(BaseModel):
    search_term: str = ""
    location: str = ""
    job_type: str = ""
    work_mode: str = ""
    hours_old: Optional[int] = None

    results_wanted: int = Field(
        default=DEFAULT_RESULTS,
        ge=1,
    )

    sites: Optional[List[str] | str] = None

    profile: Dict[str, Any] = Field(
        default_factory=dict
    )

# ============================================================
# TEXT HELPERS
# ============================================================

def clean_text(value: Any) -> str:
    if value is None:
        return ""

    if isinstance(
        value,
        (list, tuple, set),
    ):
        return " ".join(
            clean_text(item)
            for item in value
        )

    text = str(value)

    text = re.sub(
        r"<script\b[^>]*>.*?</script>",
        " ",
        text,
        flags=re.I | re.S,
    )

    text = re.sub(
        r"<style\b[^>]*>.*?</style>",
        " ",
        text,
        flags=re.I | re.S,
    )

    text = re.sub(
        r"<[^>]+>",
        " ",
        text,
    )

    replacements = {
        "&nbsp;": " ",
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&#39;": "'",
        "&#038;": "&",
    }

    for source, target in replacements.items():
        text = text.replace(
            source,
            target,
        )

    return re.sub(
        r"\s+",
        " ",
        text,
    ).strip()


def clean_array(value: Any) -> List[str]:
    if value is None:
        return []

    if isinstance(
        value,
        (list, tuple, set),
    ):
        values = value
    else:
        values = re.split(
            r"[,;|\n]+",
            str(value),
        )

    result = []
    seen = set()

    for item in values:
        text = clean_text(item)

        if not text:
            continue

        key = text.lower()

        if key in seen:
            continue

        seen.add(key)
        result.append(text)

    return result


# ============================================================
# DATE
# ============================================================

def parse_datetime(
    value: Any,
) -> Optional[datetime]:
    if not value:
        return None

    text = clean_text(value)

    if not text:
        return None

    try:
        parsed = datetime.fromisoformat(
            text.replace(
                "Z",
                "+00:00",
            )
        )

        if parsed.tzinfo is None:
            parsed = parsed.replace(
                tzinfo=timezone.utc
            )

        return parsed.astimezone(
            timezone.utc
        )

    except Exception:
        pass

    try:
        import pandas as pd

        parsed = pd.to_datetime(
            text,
            errors="coerce",
            utc=True,
        )

        if pd.isna(parsed):
            return None

        return (
            parsed
            .to_pydatetime()
            .astimezone(
                timezone.utc
            )
        )

    except Exception:
        return None


def recent_enough(
    job: Dict[str, Any],
    hours_old: Optional[int] = None,
) -> bool:
    posted = parse_datetime(
        job.get("postedDate")
    )

    now = datetime.now(
        timezone.utc
    )

    age_limit = timedelta(
        days=MAX_JOB_AGE_DAYS
    )

    if (
        hours_old is not None
        and hours_old > 0
    ):
        age_limit = min(
            age_limit,
            timedelta(
                hours=hours_old
            ),
        )

    scraped = parse_datetime(
        job.get("scrapedAt")
    )

    # Use scrape time only when the provider did not supply a posting date.
    if posted is None:
        if scraped:
            posted = scraped
        else:
            # Newly scraped without timestamp is treated as recent
            return True

    # Allow 48 hours clock-skew / future timezone tolerance
    if posted > now:
        if (posted - now) > timedelta(hours=48):
            return False
        return True

    return (
        now - posted
    ) <= age_limit


# ============================================================
# SALARY
# ============================================================

def extract_salary(
    description: str,
) -> Optional[Dict[str, Any]]:
    text = clean_text(
        description
    )

    if not text:
        return None

    patterns = [
        re.compile(
            r"(?:compensation|salary|base wage|pay|pay range|base compensation)"
            r"[^$₹€£\d]{0,80}"
            r"([$₹€£])"
            r"\s*([\d,.]+)"
            r"\s*([kKmM]?)"
            r"\s*(?:-|to|–|—)"
            r"\s*[$₹€£]?"
            r"\s*([\d,.]+)"
            r"\s*([kKmM]?)",
            flags=re.I,
        ),
        re.compile(
            r"([$₹€£])"
            r"\s*([\d,.]+)"
            r"\s*([kKmM]?)"
            r"\s*(?:-|to|–|—)"
            r"\s*[$₹€£]?"
            r"\s*([\d,.]+)"
            r"\s*([kKmM]?)",
            flags=re.I,
        ),
    ]

    for pattern in patterns:
        match = pattern.search(text)

        if not match:
            continue

        try:
            minimum = float(
                match.group(2).replace(
                    ",",
                    "",
                )
            )

            maximum = float(
                match.group(4).replace(
                    ",",
                    "",
                )
            )
        except Exception:
            continue

        min_suffix = (
            match.group(3) or ""
        ).lower()

        max_suffix = (
            match.group(5) or ""
        ).lower()

        if min_suffix == "k":
            minimum *= 1000
        elif min_suffix == "m":
            minimum *= 1000000

        if max_suffix == "k":
            maximum *= 1000
        elif max_suffix == "m":
            maximum *= 1000000

        if (
            minimum <= 0
            or maximum < minimum
        ):
            continue

        matched_text = match.group(0)

        period = ""

        if re.search(
            r"hour|/hr|per hour|hourly",
            matched_text,
            flags=re.I,
        ):
            period = "hour"

        elif re.search(
            r"month|/mo|per month|monthly",
            matched_text,
            flags=re.I,
        ):
            period = "month"

        elif re.search(
            r"year|/yr|per year|annual|annually|base wage",
            matched_text,
            flags=re.I,
        ):
            period = "year"

        return {
            "minSalary": minimum,
            "maxSalary": maximum,
            "salary": (
                f"{minimum:g} - "
                f"{maximum:g}"
            ),
            "salaryCurrency": match.group(1),
            "salaryPeriod": period,
            "salarySource": "Description",
        }

    return None


# ============================================================
# WORK MODE
# ============================================================

def infer_work_mode(
    job: Dict[str, Any],
) -> str:
    title = clean_text(
        job.get("title")
    ).lower()

    description = clean_text(
        job.get("description")
    ).lower()

    raw_mode = clean_text(
        job.get("workMode")
    ).lower()

    location = clean_text(
        job.get("location")
    ).lower()

    is_remote_flag = bool(
        job.get("isRemote")
    )

    # Strong explicit on-site evidence in description or title
    # overrides an incorrect provider isRemote flag!
    onsite_patterns = [
        r"\bwork location\s*:\s*in person\b",
        r"\bwork location\s*:\s*on[\s-]?site\b",
        r"\bwork location\s*:\s*office\b",
        r"\bin person\b",
        r"\bon[\s-]?site\b",
        r"\bonsite\b",
        r"\bat the office\b",
        r"\bbased in office\b",
        r"\bwork from office\b",
        r"\bfully in office\b",
        r"\boffice based\b",
        r"\b100% in office\b",
        r"\bnot remote\b",
        r"\bno remote\b",
    ]

    hybrid_patterns = [
        r"\bhybrid\b",
        r"\bpartly remote\b",
        r"\bpartially remote\b",
        r"\bremote and office\b",
        r"\bremote/office\b",
        r"\bflexible remote\b",
        r"\bdays in office\b",
    ]

    remote_patterns = [
        r"\b100% remote\b",
        r"\bfully remote\b",
        r"\bremote[- ]first\b",
        r"\bwork from anywhere\b",
        r"\bwork-from-anywhere\b",
        r"\bwork from home\b",
        r"\bdistributed team\b",
        r"\bdistributed workforce\b",
        r"\bvirtual position\b",
        r"\bremote\b",
    ]

    # Check title first (highest precision)
    if "hybrid" in title:
        return "Hybrid"
    if "remote" in title or "work from home" in title or "wfh" in title:
        return "Remote"
    if "onsite" in title or "on-site" in title or "in person" in title:
        return "Onsite"

    # Check raw_mode
    if "hybrid" in raw_mode:
        return "Hybrid"
    if "onsite" in raw_mode or "on-site" in raw_mode or "in person" in raw_mode:
        return "Onsite"
    if "remote" in raw_mode:
        for pattern in onsite_patterns:
            if re.search(pattern, description, flags=re.I):
                return "Onsite"
        return "Remote"

    # Check location field
    if "remote" in location or "anywhere" in location or "telecommute" in location:
        return "Remote"

    # Check description for explicit onsite vs hybrid vs remote
    has_onsite = any(re.search(p, description, flags=re.I) for p in onsite_patterns)
    has_hybrid = any(re.search(p, description, flags=re.I) for p in hybrid_patterns)
    has_remote = any(re.search(p, description, flags=re.I) for p in remote_patterns)

    # Explicit onsite in description beats provider isRemote
    if has_onsite and not has_remote and not has_hybrid:
        return "Onsite"
    if has_hybrid:
        return "Hybrid"
    if has_remote:
        return "Remote"

    # Fallback to provider flag
    if is_remote_flag:
        if has_onsite:
            return "Onsite"
        return "Remote"

    return ""


def apply_work_mode(
    job: Dict[str, Any],
) -> Dict[str, Any]:
    item = dict(job)

    mode = infer_work_mode(
        item
    )

    if mode:
        item["workMode"] = mode
        item["isRemote"] = (
            mode == "Remote"
        )
    else:
        item.setdefault(
            "workMode",
            "",
        )

    return item


def canonical_work_mode(
    value: Any,
) -> str:
    text = clean_text(
        value
    ).lower()

    if not text:
        return ""

    if "hybrid" in text:
        return "Hybrid"

    if "remote" in text:
        return "Remote"

    if (
        "onsite" in text
        or "on-site" in text
        or "on site" in text
        or "in person" in text
    ):
        return "Onsite"

    return clean_text(value)


def work_mode_match(
    job: Dict[str, Any],
    requested: str,
) -> bool:
    if normalize_location_text(requested) in {"both", "any", "all"}:
        return True

    requested_mode = canonical_work_mode(
        requested
    )

    if not requested_mode:
        return True

    actual_mode = infer_work_mode(
        job
    )

    if not actual_mode:
        actual_mode = canonical_work_mode(
            job.get("workMode")
        )

    if not actual_mode:
        return True

    return (
        actual_mode.lower()
        == requested_mode.lower()
    )


# ============================================================
# JOB TYPE
# ============================================================

def infer_job_type(
    job: Dict[str, Any],
) -> str:
    title = clean_text(
        job.get("title")
    ).lower()

    description = clean_text(
        job.get("description")
    ).lower()

    provider_type = clean_text(
        job.get("jobType")
        or job.get("employmentType")
    ).lower()

    # Title is authoritative for an internship.
    # Matches "intern", "internship", "interns", "co-op", "coop", "trainee", "apprentice"
    intern_title_pattern = r"\b(intern(ship|s)?|co[- ]?op|trainee|apprentice)\b"
    is_intern_title = bool(
        re.search(
            intern_title_pattern,
            title,
            flags=re.I,
        )
    )

    if is_intern_title:
        return "Internship"

    if re.search(r"\bpart[- ]time\b", title, flags=re.I):
        return "Part-Time"

    if re.search(r"\bcontract(or)?\b|\btemporary\b", title, flags=re.I):
        return "Contract"

    # Prefer explicit provider employment metadata over assumptions from a
    # conventional job title.
    if provider_type:
        normalized = (
            provider_type
            .replace("_", " ")
            .replace("-", " ")
        )

        if "intern" in normalized:
            return "Internship"

        if (
            "full time" in normalized
            or "fulltime" in normalized
        ):
            return "Full-Time"

        if (
            "part time" in normalized
            or "parttime" in normalized
        ):
            return "Part-Time"

        if (
            "contract" in normalized
            or "temporary" in normalized
            or "temp" in normalized
        ):
            return "Contract"

    # Check structural description headers (e.g. "Employment Type: Internship")
    if re.search(
        r"(?:job|employment)\s*type\s*[:\-]\s*(?:.*?\b)?intern(ship)?\b",
        description,
        flags=re.I,
    ):
        return "Internship"

    if re.search(
        r"(?:job|employment)\s*type\s*[:\-]\s*(?:.*?\b)?part[- ]time\b",
        description,
        flags=re.I,
    ):
        return "Part-Time"

    if re.search(
        r"(?:job|employment)\s*type\s*[:\-]\s*(?:.*?\b)?contract\b",
        description,
        flags=re.I,
    ):
        return "Contract"

    if re.search(r"\bfull[- ]?time\b", title, flags=re.I):
        return "Full-Time"

    if re.search(
        r"(?:job|employment)\s*type\s*[:\-]\s*full[- ]?time\b"
        r"|\bfull[- ]?time\s+(?:position|role|opportunity|employment|schedule)\b",
        description,
        flags=re.I,
    ):
        return "Full-Time"

    return canonical_job_type(
        job.get("jobType")
        or job.get("employmentType")
    )


def canonical_job_type(
    value: Any,
) -> str:
    text = clean_text(
        value
    ).lower()

    if not text:
        return ""

    text = (
        text
        .replace(
            "_",
            " ",
        )
        .replace(
            "-",
            " ",
        )
    )

    text = re.sub(
        r"\s+",
        " ",
        text,
    ).strip()

    if (
        "intern" in text
        or "internship" in text
    ):
        return "Internship"

    if (
        "full time" in text
        or "fulltime" in text
    ):
        return "Full-Time"

    if (
        "part time" in text
        or "parttime" in text
    ):
        return "Part-Time"

    if (
        "contract" in text
        or "contractor" in text
    ):
        return "Contract"

    if (
        "temporary" in text
        or text == "temp"
    ):
        return "Temporary"

    return clean_text(value)


def job_type_match(
    job: Dict[str, Any],
    requested: str,
) -> bool:
    if normalize_location_text(requested) in {"both", "any", "all"}:
        return True

    requested_type = canonical_job_type(
        requested
    )

    if not requested_type:
        return True

    # Re-infer from title and description.
    # Provider metadata is not trusted blindly.
    actual_type = infer_job_type(
        job
    )

    if not actual_type:
        actual_type = canonical_job_type(
            job.get("jobType")
        )

    if not actual_type:
        return True

    return (
        actual_type.lower()
        == requested_type.lower()
    )


# ============================================================
# LOCATION
# ============================================================

def normalize_location_text(
    value: Any,
) -> str:
    text = clean_text(
        value
    ).lower()

    text = re.sub(
        r"[^a-z0-9]+",
        " ",
        text,
    )

    return re.sub(
        r"\s+",
        " ",
        text,
    ).strip()


def location_match(
    job: Dict[str, Any],
    requested_location: str,
    requested_work_mode: str,
) -> bool:
    requested_location = normalize_location_text(
        requested_location
    )

    requested_work_mode = canonical_work_mode(
        requested_work_mode
    )

    if not requested_location:
        return True

    actual_mode = infer_work_mode(job)
    if not actual_mode:
        actual_mode = canonical_work_mode(
            job.get("workMode")
        )

    # Remote + Mumbai means remote jobs anywhere are valid.
    if requested_work_mode == "Remote":
        return actual_mode == "Remote"

    job_location = normalize_location_text(
        job.get("location")
    )
    if job_location in {
        "",
        "not specified",
        "not available",
        "unknown",
        "unspecified",
        "n a",
        "na",
    }:
        job_location = normalize_location_text(
            job.get("sourceSearchLocation")
        )

    def city_matches(needle: str, haystack: str) -> bool:
        if needle in haystack or haystack in needle:
            return True
        if needle == "mumbai" and ("bombay" in haystack or "navi mumbai" in haystack or "thane" in haystack):
            return True
        return False

    def provider_search_confirms_mumbai_region() -> bool:
        source_location = normalize_location_text(
            job.get("sourceSearchLocation")
        )
        return (
            requested_location in {"mumbai", "bombay", "thane"}
            and city_matches(requested_location, source_location)
            and job_location in {
                "mh in",
                "maharashtra",
                "maharashtra india",
            }
        )

    # Hybrid + Mumbai means hybrid jobs in Mumbai only.
    if requested_work_mode == "Hybrid":
        if actual_mode and actual_mode != "Hybrid":
            return False
        if not job_location:
            return False
        return (
            city_matches(requested_location, job_location)
            or provider_search_confirms_mumbai_region()
        )

    # On-site + Mumbai means on-site jobs in Mumbai only.
    if requested_work_mode in {"Onsite", "On-site"}:
        if actual_mode and actual_mode not in {"Onsite", "On-site"}:
            return False
        if not job_location:
            return False
        return (
            city_matches(requested_location, job_location)
            or provider_search_confirms_mumbai_region()
        )

    # Location-only filter: job matches city, or is Remote if no mode requested.
    if not job_location:
        return (
            actual_mode == "Remote"
            or city_matches(
                requested_location,
                normalize_location_text(job.get("sourceSearchLocation")),
            )
        )

    return (
        city_matches(requested_location, job_location)
        or actual_mode == "Remote"
        or city_matches(
            requested_location,
            normalize_location_text(job.get("sourceSearchLocation")),
        )
    )


# ============================================================
# SOURCE FILTER
# ============================================================

def source_allowed(
    source: str,
    sites: Optional[List[str] | str],
) -> bool:
    if not sites:
        return True

    requested = clean_array(
        sites
    )

    if not requested:
        return True

    source = clean_text(
        source
    ).lower()

    return any(
        token.lower() in source
        or source in token.lower()
        for token in requested
    )


# ============================================================
# NORMALIZATION
# ============================================================

def normalize_job(
    job: Dict[str, Any],
) -> Dict[str, Any]:

    item = dict(job)

    item["title"] = clean_text(
        item.get("title")
    )

    item["company"] = clean_text(
        item.get("company")
    )
    if item["company"].casefold() in {"nan", "none", "null"}:
        item["company"] = "Unknown Company"

    item["location"] = clean_text(
        item.get("location")
    )

    item["description"] = clean_text(
        item.get("description")
    )

    item["source"] = clean_text(
        item.get("source")
    )

    item["jobUrl"] = clean_text(
        item.get("jobUrl")
        or item.get("jobUrlDirect")
        or item.get("applicationUrl")
    )

    item["applicationUrl"] = clean_text(
        item.get("applicationUrl")
        or item.get("jobUrl")
        or item.get("jobUrlDirect")
    )

    item["sourceUrl"] = clean_text(
        item.get("sourceUrl")
    )

    item["skills"] = clean_array(
        item.get("skills")
    )

    item["detectedJobSkills"] = clean_array(
        item.get("detectedJobSkills")
    )

    item["experience"] = clean_text(
        item.get("experience")
        or item.get("experienceLevel")
        or item.get("requiredExperience")
    )

    inferred_type = infer_job_type(
        item
    )

    if inferred_type:
        item["jobType"] = canonical_job_type(
            inferred_type
        )
    else:
        item["jobType"] = clean_text(
            item.get("jobType")
            or item.get("employmentType")
        )

    item = apply_work_mode(
        item
    )

    raw_posted_date = (
        item.get("postedDate")
        or item.get("created")
        or item.get("createdAt")
    )

    if raw_posted_date:
        parsed_posted = parse_datetime(
            raw_posted_date
        )

        if parsed_posted:
            item["postedDate"] = (
                parsed_posted.isoformat()
            )
        else:
            item["postedDate"] = clean_text(
                raw_posted_date
            )
    else:
        item["postedDate"] = None

    # Salary
    try:
        minimum = float(
            item.get("minSalary")
        )

        maximum = float(
            item.get("maxSalary")
        )

        has_salary = (
            minimum > 0
            and maximum >= minimum
        )

    except (
        TypeError,
        ValueError,
    ):
        has_salary = False

    if not has_salary:
        salary = extract_salary(
            item["description"]
        )

        if salary:
            item.update(
                salary
            )
        else:
            item.setdefault(
                "salary",
                "",
            )

            item.setdefault(
                "minSalary",
                0,
            )

            item.setdefault(
                "maxSalary",
                0,
            )

            item.setdefault(
                "salaryCurrency",
                "",
            )

            item.setdefault(
                "salaryPeriod",
                "",
            )

            item.setdefault(
                "salarySource",
                "",
            )

    return item


# ============================================================
# DEDUPLICATION
# ============================================================

def unique_jobs(
    jobs: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:

    seen_urls = set()
    seen_job_details = set()
    output = []

    for job in jobs:
        url_identity = clean_text(
            job.get("jobUrl")
            or job.get("jobUrlDirect")
            or job.get("applicationUrl")
            or job.get("sourceUrl")
        )

        title = " ".join(
            clean_text(job.get("title")).casefold().split()
        )
        company = " ".join(
            clean_text(job.get("company")).casefold().split()
        )
        location = " ".join(
            clean_text(job.get("location")).casefold().split()
        )
        detail_identity = (
            f"{title}|{company}|{location}"
            if title and company and location
            else ""
        )

        if (
            (url_identity and url_identity.casefold() in seen_urls)
            or (detail_identity and detail_identity in seen_job_details)
        ):
            continue

        if url_identity:
            seen_urls.add(url_identity.casefold())
        if detail_identity:
            seen_job_details.add(detail_identity)
        output.append(job)

    return output


# ============================================================
# FLATTEN PROVIDER RESULTS
# ============================================================

def flatten(
    result: Any,
) -> List[Dict[str, Any]]:

    if isinstance(
        result,
        dict,
    ):
        jobs = result.get(
            "jobs",
            [],
        )

        return [
            job
            for job in jobs
            if isinstance(
                job,
                dict,
            )
        ]

    if not isinstance(
        result,
        list,
    ):
        return []

    grouped = any(
        isinstance(
            item,
            dict,
        )
        and "jobs" in item
        for item in result
    )

    if not grouped:
        return [
            item
            for item in result
            if isinstance(
                item,
                dict,
            )
        ]

    provider_jobs = []

    for provider in result:
        if not isinstance(
            provider,
            dict,
        ):
            continue

        jobs = [
            job
            for job in provider.get(
                "jobs",
                [],
            )
            if isinstance(
                job,
                dict,
            )
        ]

        if jobs:
            provider_jobs.append(
                jobs
            )

    flattened = []

    index = 0

    while True:
        added = False

        for jobs in provider_jobs:
            if index < len(jobs):
                flattened.append(
                    jobs[index]
                )
                added = True

        if not added:
            break

        index += 1

    return flattened


# ============================================================
# EXTERNAL SOURCES
# ============================================================

async def call_external_sources(
    search_term: str = "",
    location: str = "",
    job_type: str = "",
    work_mode: str = "",
    results_wanted: int = DEFAULT_RESULTS,
    hours_old: Optional[int] = None,
    profile: Optional[Dict[str, Any]] = None,
    sites: Optional[List[str] | str] = None,
) -> Any:
    """
    Wide retrieval.

    No hardcoded role.
    No hardcoded occupation.
    No hardcoded technology.
    No hardcoded country.
    No hardcoded company.
    """

    result = (
        external_sources.fetch_external_sources(
            search_term=search_term,
            location=location,
            job_type=job_type,
            work_mode=work_mode,
            results_wanted=results_wanted,
            hours_old=hours_old,
            profile=profile,
            sites=sites,
        )
    )

    if hasattr(
        result,
        "__await__",
    ):
        result = await result

    return result


# ============================================================
# FILTER PIPELINE
# ============================================================

def normalize_and_filter(
    jobs: List[Dict[str, Any]],
    request: SearchRequest | RefreshRequest | RankRequest,
    *,
    apply_hard_filters: bool = True,
    apply_search_filter: bool = False,
    apply_date_filter: bool = True,
) -> List[Dict[str, Any]]:

    output = []

    for raw_job in jobs:

        if not isinstance(
            raw_job,
            dict,
        ):
            continue

        job = normalize_job(
            raw_job
        )

        # ----------------------------------------------------
        # DATE
        # ----------------------------------------------------

        hours_old = getattr(
            request,
            "hours_old",
            None,
        )

        if apply_date_filter and not recent_enough(job, hours_old):
            continue

        # ----------------------------------------------------
        # SOURCE
        # ----------------------------------------------------

        sites = getattr(
            request,
            "sites",
            None,
        )

        if not source_allowed(
            job.get(
                "source",
                "",
            ),
            sites,
        ):
            continue

        # ----------------------------------------------------
        # SEARCH FILTER
        # ----------------------------------------------------
        #
        # Disabled during normal search.
        # matcher.py handles relevance.
        #

        if (
            apply_search_filter
            and request.search_term.strip()
        ):
            searchable = " ".join(
                [
                    job.get(
                        "title",
                        "",
                    ),
                    job.get(
                        "company",
                        "",
                    ),
                    job.get(
                        "description",
                        "",
                    ),
                ]
            ).lower()

            query_tokens = [
                token.lower()
                for token in request.search_term.split()
                if len(token.strip()) >= 2
            ]

            if query_tokens:
                matched = sum(
                    token in searchable
                    for token in query_tokens
                )

                if (
                    matched
                    / len(query_tokens)
                    < 0.5
                ):
                    continue

        # ----------------------------------------------------
        # HARD FILTERS
        # ----------------------------------------------------

        if apply_hard_filters:

            requested_job_type = getattr(
                request,
                "job_type",
                "",
            )

            if (
                requested_job_type.strip()
                and not job_type_match(
                    job,
                    requested_job_type,
                )
            ):
                continue

            requested_work_mode = getattr(
                request,
                "work_mode",
                "",
            )

            if (
                requested_work_mode.strip()
                and not work_mode_match(
                    job,
                    requested_work_mode,
                )
            ):
                continue

            requested_location = getattr(
                request,
                "location",
                "",
            )

            if (
                requested_location.strip()
                and not location_match(
                    job,
                    requested_location,
                    requested_work_mode,
                )
            ):
                continue

        output.append(
            job
        )

    return unique_jobs(
        output
    )


# ============================================================
# SEARCH RETRIEVAL
# ============================================================

async def get_search_jobs(
    request: SearchRequest,
) -> List[Dict[str, Any]]:
    """
    Retrieve broadly first.

    User search term is NOT used to narrow provider retrieval.

    Hard filters are applied afterwards.
    """

    logger.info(
        "Starting WIDE search retrieval."
    )

    raw_result = await call_external_sources(
        search_term=request.search_term,
        location=request.location,
        job_type=request.job_type,
        work_mode=request.work_mode,
        results_wanted=request.results_wanted,
        hours_old=request.hours_old or MAX_JOB_AGE_DAYS * 24,
        profile=request.profile,
        sites=request.sites,
    )

    raw_jobs = flatten(
        raw_result
    )

    raw_jobs = unique_jobs(
        raw_jobs
    )

    logger.info(
        "Raw wide jobs retrieved: %d",
        len(raw_jobs),
    )

    filtered = normalize_and_filter(
        raw_jobs,
        request,
        apply_hard_filters=True,
        apply_search_filter=False,
    )

    logger.info(
        "Jobs after hard filters: %d",
        len(filtered),
    )

    logger.info(
        "Source summary: %s",
        source_summary(filtered),
    )

    return filtered


# ============================================================
# REFRESH
# ============================================================

async def get_refresh_jobs(
    request: RefreshRequest,
) -> tuple[List[Dict[str, Any]], Dict[str, Any]]:

    logger.info(
        "Starting WIDE refresh."
    )

    raw_result = await call_external_sources(
        search_term=request.search_term,
        location=request.location,
        job_type=request.job_type,
        work_mode=request.work_mode,
        results_wanted=request.results_wanted,
        hours_old=request.hours_old or MAX_JOB_AGE_DAYS * 24,
        profile=request.profile,
        sites=request.sites,
    )

    raw_jobs = flatten(
        raw_result
    )

    raw_jobs = unique_jobs(
        raw_jobs
    )

    logger.info(
        "Raw refresh jobs: %d",
        len(raw_jobs),
    )

    filtered = normalize_and_filter(
        raw_jobs,
        request,
        apply_hard_filters=False,
        apply_search_filter=False,
        apply_date_filter=False,
    )

    providers = raw_result.get("providers", []) if isinstance(raw_result, dict) else []
    provider_summary = {
        item.get("source", "Unknown"): {
            "success": bool(item.get("success")),
            "count": len(item.get("jobs", [])),
            "error": item.get("error"),
        }
        for item in providers
    }

    logger.info(
        "Refresh jobs after source filters: %d",
        len(filtered),
    )

    return filtered, provider_summary


# ============================================================
# SOURCE SUMMARY
# ============================================================

def source_summary(
    jobs: List[Dict[str, Any]],
) -> Dict[str, int]:

    summary = {}

    for job in jobs:
        source = (
            clean_text(
                job.get("source")
            )
            or "Unknown"
        )

        summary[source] = (
            summary.get(
                source,
                0,
            )
            + 1
        )

    return summary


# ============================================================
# SERIALIZATION
# ============================================================

def serialize_job(
    job: Dict[str, Any],
) -> Dict[str, Any]:

    result = dict(
        job
    )

    numeric_fields = (
        "matchScore",
        "searchMatchPercentage",
        "finalRankingScore",
        "semanticProfilePercentage",
        "roleMatchPercentage",
        "skillMatchPercentage",
        "jobRequirementCoverage",
        "experienceMatchPercentage",
        "otherFitPercentage",
        "profileMatchPercentage",
    )

    for field in numeric_fields:
        if (
            field not in result
            or result[field] is None
        ):
            continue

        try:
            result[field] = float(
                result[field]
            )
        except Exception:
            result[field] = None

    for field in (
        "skills",
        "matchedSkills",
        "missingSkills",
        "matchReasons",
        "detectedJobSkills",
    ):
        result[field] = clean_array(
            result.get(field)
        )

    return json_safe(result)


def json_safe(value: Any) -> Any:
    """Convert scraped/provider values into strict JSON-safe primitives."""
    if value is None or isinstance(value, (str, bool, int)):
        return value

    if isinstance(value, float):
        return value if math.isfinite(value) else None

    # Convert numpy and pandas scalar values (including numpy NaN) without
    # making those libraries mandatory for the API layer.
    item = getattr(value, "item", None)
    if callable(item):
        try:
            return json_safe(item())
        except (TypeError, ValueError):
            pass

    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}

    if isinstance(value, (list, tuple, set)):
        return [json_safe(item) for item in value]

    isoformat = getattr(value, "isoformat", None)
    if callable(isoformat):
        try:
            return isoformat()
        except (TypeError, ValueError):
            pass

    return str(value)


# ============================================================
# PREPARE RANK JOBS
# ============================================================


def prepare_rank_jobs(
    jobs: List[Dict[str, Any]],
    request: RankRequest,
    diagnostics: Optional[Dict[str, int]] = None,
) -> List[Dict[str, Any]]:

    normalized = []
    counts = diagnostics if diagnostics is not None else {}
    counts.update({
        "incoming": len(jobs),
        "invalid": 0,
        "too_old": 0,
        "job_type": 0,
        "work_mode": 0,
        "location": 0,
        "experience": 0,
    })
    requested_job_type = request.job_type or ProfileReader.looking_for(
        request.profile
    )
    requested_work_mode = request.work_mode or ProfileReader.work_mode(
        request.profile
    )
    requested_location = request.location or ProfileReader.location(
        request.profile
    )

    for raw_job in jobs:

        if not isinstance(
            raw_job,
            dict,
        ):
            counts["invalid"] += 1
            continue

        job = normalize_job(
            raw_job
        )

        # Date
        if not recent_enough(job):
            counts["too_old"] += 1
            continue

        # Job type
        if (
            requested_job_type.strip()
            and not job_type_match(
                job,
                requested_job_type,
            )
        ):
            counts["job_type"] += 1
            continue

        # Work mode
        if (
            requested_work_mode.strip()
            and not work_mode_match(
                job,
                requested_work_mode,
            )
        ):
            counts["work_mode"] += 1
            continue

        # Location
        if (
            requested_location.strip()
            and not location_match(
                job,
                requested_location,
                requested_work_mode,
            )
        ):
            counts["location"] += 1
            continue

        if not experience_within_tolerance(request.profile, job):
            counts["experience"] += 1
            continue

        job["detectedJobSkills"] = clean_array(
            [
                *job.get("detectedJobSkills", []),
                *detect_job_skills(job),
            ]
        )

        normalized.append(
            job
        )

    result = unique_jobs(
        normalized
    )
    counts["after_hard_filters"] = len(result)
    return result


# ============================================================
# ROOT
# ============================================================

@app.get("/")
async def root():

    return {
        "service":
            "JobPulse AI Python Service",

        "status":
            "running",

        "version":
            "5.0.0",

        "retrieval":
            "wide",

        "hardcoded_job_scope":
            False,

        "hard_filters": {
            "job_type":
                True,

            "work_mode":
                True,

            "location":
                True,

            "max_age_days":
                MAX_JOB_AGE_DAYS,
        },

        "search_term_hard_filter":
            False,

        "candidate_pool_size":
            CANDIDATE_POOL_SIZE,

        "ranking_weights": {
            "experience":
                35,

            "role_title":
                35,

            "skills":
                25,

            "other_fit":
                5,
        },
    }


# ============================================================
# HEALTH
# ============================================================

@app.get("/health")
async def health():

    return {
        "status":
            "ok",

        "service":
            "jobpulse-python",

        "timestamp":
            datetime.now(
                timezone.utc
            ).isoformat(),
    }


# ============================================================
# CONFIG DEBUG
# ============================================================

@app.get("/debug/config")
async def debug_config():

    return {
        "version":
            "5.0.0",

        "host":
            HOST,

        "port":
            PORT,

        "default_results":
            DEFAULT_RESULTS,

        "max_job_age_days":
            MAX_JOB_AGE_DAYS,

        "candidate_pool_size":
            CANDIDATE_POOL_SIZE,

        "retrieval":
            "wide",

        "provider_search_enabled":
            False,

        "multi_query_retrieval":
            False,

        "search_term_hard_filter":
            False,

        "hard_filters": {
            "job_type":
                True,

            "work_mode":
                True,

            "location":
                True,

            "date":
                True,
        },

        "ranking_weights": {
            "experience":
                35,

            "role_title":
                35,

            "skills":
                25,

            "other_fit":
                5,
        },

        "hardcoded_scope":
            False,
    }


# ============================================================
# SEARCH GET
# ============================================================

@app.get("/search")
async def search_get(
    search_term: str = "",
    location: str = "",
    job_type: str = "",
    work_mode: str = "",
    results_wanted: int = DEFAULT_RESULTS,
):

    request = SearchRequest(
        search_term=search_term,
        location=location,
        job_type=job_type,
        work_mode=work_mode,
        results_wanted=max(
            1,
            results_wanted,
        ),
    )

    return await search_jobs(
        request
    )


# ============================================================
# SEARCH POST
# ============================================================

@app.post("/search")
async def search_jobs(
    request: SearchRequest,
):

    logger.info(
        "================ SEARCH ================"
    )

    logger.info(
        "search_term=%s",
        request.search_term,
    )

    logger.info(
        "location=%s",
        request.location,
    )

    logger.info(
        "job_type=%s",
        request.job_type,
    )

    logger.info(
        "work_mode=%s",
        request.work_mode,
    )

    logger.info(
        "results_wanted=%d",
        request.results_wanted,
    )

    jobs = await get_search_jobs(
        request
    )

    logger.info(
        "Candidates before matcher: %d",
        len(jobs),
    )

    if not jobs:
        return {
            "success": True,
            "count": 0,
            "jobs": [],
            "search_term":
                request.search_term,
            "sourceSummary": {},
        }

    # ========================================================
    # AI MATCHING
    # ========================================================

    ranked = matcher.rank_jobs(
        jobs,
        profile=request.profile,
        search_term=request.search_term,
    )

    ranked = [
        serialize_job(job)
        for job in ranked[
            :request.results_wanted
        ]
    ]

    logger.info(
        "Final ranked jobs: %d",
        len(ranked),
    )

    return {
        "success": True,
        "count": len(ranked),
        "jobs": ranked,
        "search_term":
            request.search_term,
        "sourceSummary":
            source_summary(ranked),
        "retrieval":
            "wide",
    }


# ============================================================
# RANK
# ============================================================

@app.post("/rank")
async def rank_jobs(
    request: RankRequest,
):

    logger.info(
        "================ RANK ================"
    )

    logger.info(
        "Incoming jobs: %d",
        len(request.jobs),
    )

    filter_diagnostics: Dict[str, int] = {}
    normalized = prepare_rank_jobs(
        request.jobs,
        request,
        diagnostics=filter_diagnostics,
    )

    logger.info(
        "Jobs after hard filters: %d",
        len(normalized),
    )

    if not normalized:
        return {
            "success":
                True,

            "count":
                0,

            "jobs":
                [],

            "search_term":
                request.search_term,

            "sourceSummary":
                {},

            "rankingDiagnostics": {
                "hardFilters": filter_diagnostics,
                "after_profile_matching": 0,
            },
        }

    ranked = matcher.rank_jobs(
        normalized,
        profile=request.profile,
        search_term=request.search_term,
    )
    logger.info(
        "Ranking result: %d of %d hard-filtered candidates; hard filters=%s",
        len(ranked),
        len(normalized),
        filter_diagnostics,
    )

    serialized = [
        serialize_job(job)
        for job in ranked
    ]

    return {
        "success":
            True,

        "count":
            len(serialized),

        "jobs":
            serialized,

        "search_term":
            request.search_term,

        "sourceSummary":
            source_summary(
                serialized
            ),

        "rankingDiagnostics": {
            "hardFilters": filter_diagnostics,
            "after_profile_matching": len(ranked),
        },
    }


# ============================================================
# REFRESH
# ============================================================

@app.post("/refresh")
async def refresh_jobs(
    request: RefreshRequest,
):

    logger.info(
        "================ REFRESH ================"
    )

    jobs, provider_summary = await get_refresh_jobs(
        request
    )

    serialized = [
        serialize_job(job)
        for job in jobs
    ]

    logger.info(
        "Refresh result: %d",
        len(serialized),
    )

    return {
        "success":
            True,

        "count":
            len(serialized),

        "jobs":
            serialized,

        "search_term":
            request.search_term,

        "sourceSummary":
            source_summary(
                serialized
            ),

        "providerSummary": provider_summary,

        "refreshed_at":
            datetime.now(
                timezone.utc
            ).isoformat(),

        "hard_filters_applied":
            False,

        "hard_filter_order": [
            "source",
        ],

        "skill_matching":
            "applied during /rank after collection and hard filtering",

        "retrieval":
            "wide",
    }


# ============================================================
# JOBS
# ============================================================

@app.get("/jobs")
async def jobs_endpoint(
    search_term: str = "",
    location: str = "",
    job_type: str = "",
    work_mode: str = "",
    results_wanted: int = DEFAULT_RESULTS,
):

    request = SearchRequest(
        search_term=search_term,
        location=location,
        job_type=job_type,
        work_mode=work_mode,
        results_wanted=max(
            1,
            results_wanted,
        ),
    )

    return await search_jobs(
        request
    )


# ============================================================
# DEBUG FILTERS
# ============================================================

@app.post("/debug/filters")
async def debug_filters(
    request: RankRequest,
):

    results = []

    for raw_job in request.jobs:

        if not isinstance(
            raw_job,
            dict,
        ):
            continue

        job = normalize_job(
            raw_job
        )

        recent = recent_enough(
            job
        )

        job_type_ok = (
            job_type_match(
                job,
                request.job_type,
            )
            if request.job_type.strip()
            else True
        )

        work_mode_ok = (
            work_mode_match(
                job,
                request.work_mode,
            )
            if request.work_mode.strip()
            else True
        )

        location_ok = (
            location_match(
                job,
                request.location,
                request.work_mode,
            )
            if request.location.strip()
            else True
        )

        results.append(
            {
                "title":
                    job.get("title"),

                "company":
                    job.get("company"),

                "location":
                    job.get("location"),

                "jobType":
                    job.get("jobType"),

                "inferredJobType":
                    infer_job_type(
                        job
                    ),

                "workMode":
                    job.get("workMode"),

                "inferredWorkMode":
                    infer_work_mode(
                        job
                    ),

                "isRemote":
                    job.get("isRemote"),

                "postedDate":
                    job.get("postedDate"),

                "recentEnough":
                    recent,

                "jobTypeMatch":
                    job_type_ok,

                "workModeMatch":
                    work_mode_ok,

                "locationMatch":
                    location_ok,

                "passesAll":
                    all(
                        [
                            recent,
                            job_type_ok,
                            work_mode_ok,
                            location_ok,
                        ]
                    ),
            }
        )

    return {
        "success":
            True,

        "count":
            len(results),

        "jobs":
            results,
    }


# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":
    uvicorn.run(
        app,
        host=HOST,
        port=PORT,
        log_level="info",
    )
