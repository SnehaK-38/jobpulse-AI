import json
import time
import asyncio

from jobspy import external_sources
from jobspy.server import (
    MAX_JOB_AGE_DAYS,
    RankRequest,
    RefreshRequest,
    get_refresh_jobs,
    location_match,
    prepare_rank_jobs,
)


class FakeFrame:
    empty = False

    def iterrows(self):
        yield 0, {
            "title": "Software Engineer Intern",
            "company": "Example",
            "location": "Mumbai, India",
            "is_remote": False,
            "job_url": "https://example.test/job",
            "site": "naukri",
        }


def test_jobspy_source_uses_india_for_mumbai_and_normalizes_source(monkeypatch):
    call = {}

    def fake_scrape_jobs(**kwargs):
        call.update(kwargs)
        return FakeFrame()

    monkeypatch.setattr("jobspy.scrape_jobs", fake_scrape_jobs)
    monkeypatch.delenv("JOBPULSE_INDEED_COUNTRY", raising=False)

    result = external_sources.fetch_jobspy_source(
        "naukri",
        "software engineer",
        "Mumbai",
        "Internship",
        results_wanted=75,
        hours_old=168,
    )

    assert call["country_indeed"] == "india"
    assert call["site_name"] == ["naukri"]
    assert call["results_wanted"] == 75
    assert call["hours_old"] == 168
    assert result["jobs"][0]["source"] == "Naukri"
    assert result["source"] == "Naukri"
    assert result["jobs"][0]["sourceSearchLocation"] == "Mumbai"


def test_jobspy_source_does_not_render_nan_company_names(monkeypatch):
    class MissingCompanyFrame(FakeFrame):
        def iterrows(self):
            yield 0, {
                "title": "Software Engineer",
                "company": float("nan"),
                "location": "Mumbai, India",
                "is_remote": False,
                "job_url": "https://example.test/missing-company",
                "site": "indeed",
            }

    monkeypatch.setattr(
        "jobspy.scrape_jobs",
        lambda **_kwargs: MissingCompanyFrame(),
    )

    result = external_sources.fetch_jobspy_source(
        "indeed",
        "software engineer",
        "Mumbai",
        "Full-Time",
    )

    assert result["jobs"][0]["company"] == "Unknown Company"


def test_fetch_external_sources_includes_all_jobspy_boards(monkeypatch):
    calls = []
    adzuna_calls = []

    def fake_jobspy_source(site_name, *args):
        calls.append(site_name)
        return {
            "source": external_sources.JOBSPY_SOURCE_NAMES[site_name],
            "success": True,
            "jobs": [],
            "error": None,
        }

    def empty_provider(source, *_args):
        return {
            "source": source,
            "success": True,
            "jobs": [],
            "error": None,
        }

    def fake_adzuna(search_term, location):
        adzuna_calls.append((search_term, location))
        return empty_provider("Adzuna")

    monkeypatch.setattr(
        external_sources,
        "fetch_jobspy_source",
        fake_jobspy_source,
    )
    for provider, source in (
        ("fetch_remoteok", "RemoteOK"),
        ("fetch_arbeitnow", "Arbeitnow"),
        ("fetch_jobicy", "Jobicy"),
        ("fetch_remotive", "Remotive"),
        ("fetch_themuse", "The Muse"),
        ("fetch_greenhouse", "Greenhouse"),
        ("fetch_lever", "Lever"),
        ("fetch_gemini_search", "Gemini Search"),
    ):
        monkeypatch.setattr(
            external_sources,
            provider,
            lambda *args, source=source, **kwargs: empty_provider(source),
        )
    monkeypatch.setattr(
        external_sources,
        "fetch_adzuna",
        fake_adzuna,
    )

    external_sources.fetch_external_sources(
        search_term="software engineer",
        location="Mumbai",
        job_type="Internship",
    )

    assert set(calls) == set(external_sources.JOBSPY_SOURCE_NAMES)
    assert adzuna_calls == [("software engineer", "Mumbai")]


def test_gemini_search_requires_api_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    result = external_sources.fetch_gemini_search(
        "software engineer",
        "Mumbai",
        "Full-Time",
        "On-site",
    )

    assert result["success"] is False
    assert result["jobs"] == []
    assert "GEMINI_API_KEY" in result["error"]


def test_gemini_search_reports_quota_errors_without_provider_details(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-a-real-secret")

    def rate_limited(*_args, **_kwargs):
        raise external_sources.HTTPError(
            "https://generativelanguage.googleapis.com/v1beta/interactions",
            429,
            "rate limited",
            None,
            None,
        )

    monkeypatch.setattr(external_sources, "urlopen", rate_limited)

    result = external_sources.fetch_gemini_search(
        "software engineer",
        "Mumbai",
    )

    assert result["success"] is False
    assert result["jobs"] == []
    assert result["error"] == "Gemini API quota exceeded or rate limit reached"


def test_gemini_search_keeps_only_citation_backed_job_urls(monkeypatch):
    listing_url = "https://www.naukri.com/job-listings/software-engineer"
    response_body = {
        "output": [
            {
                "type": "model_output",
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps(
                            {
                                "jobs": [
                                    {
                                        "title": "Software Engineer",
                                        "company": "Example",
                                        "location": "Mumbai",
                                        "job_type": "Full-Time",
                                        "work_mode": "On-site",
                                        "experience": "3+ years",
                                        "posted_date": "2026-11-12",
                                        "job_url": listing_url,
                                        "description": "Requires 3+ years of experience.",
                                    },
                                    {
                                        "title": "Unverified Listing",
                                        "company": "Example",
                                        "location": "Mumbai",
                                        "job_url": "https://example.com/unverified",
                                    },
                                ]
                            }
                        ),
                        "annotations": [
                            {
                                "type": "url_citation",
                                "url": listing_url + "?utm_source=search",
                            }
                        ],
                    }
                ],
            }
        ]
    }

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return json.dumps(response_body).encode("utf-8")

    requests = []

    def fake_urlopen(request, timeout):
        requests.append((request, timeout))
        return FakeResponse()

    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-a-real-secret")
    monkeypatch.setattr(external_sources, "urlopen", fake_urlopen)

    result = external_sources.fetch_gemini_search(
        "software engineer",
        "Mumbai",
        "Full-Time",
        "On-site",
        results_wanted=10,
        hours_old=720,
    )

    assert result["success"] is True
    assert len(result["jobs"]) == 1
    job = result["jobs"][0]
    assert job["source"] == "Naukri"
    assert job["jobUrl"] == listing_url
    assert job["experience"] == "3+ years"
    assert len(requests) == 1
    request, timeout = requests[0]
    assert request.get_header("X-goog-api-key") == "test-key-not-a-real-secret"
    assert timeout == external_sources.GEMINI_SEARCH_TIMEOUT
    request_body = json.loads(request.data)
    assert request_body["tools"] == [{"type": "google_search"}]
    assert "Internshala" in request_body["input"]
    assert "Mumbai" in request_body["input"]


def test_adzuna_uses_dynamic_search_and_location(monkeypatch):
    requests = []
    monkeypatch.setenv("ADZUNA_APP_ID", "test-app-id")
    monkeypatch.setenv("ADZUNA_APP_KEY", "test-app-key")
    monkeypatch.setenv("ADZUNA_COUNTRIES", "in")
    monkeypatch.setattr(external_sources, "MAX_ADZUNA_PAGES", 1)

    def fake_fetch_json(url, params):
        requests.append((url, params))
        return {"results": []}

    monkeypatch.setattr(
        external_sources,
        "fetch_json",
        fake_fetch_json,
    )

    result = external_sources.fetch_adzuna(
        "software engineer",
        "Mumbai",
    )

    assert result["success"] is True
    assert requests[0][0].endswith("/v1/api/jobs/in/search/1")
    assert requests[0][1]["what"] == "software engineer"
    assert requests[0][1]["where"] == "Mumbai"
    assert requests[0][1]["app_id"] == "test-app-id"
    assert requests[0][1]["app_key"] == "test-app-key"


def test_sde_internship_search_uses_multiple_role_queries():
    terms = external_sources.jobspy_search_terms(
        "software engineer",
        "Internship",
    )

    assert len(terms) == 4
    assert "full stack developer internship" in terms
    assert "web developer internship" in terms


def test_jobspy_query_results_merge_across_searches(monkeypatch):
    def fake_jobspy_source(site, search_term, *_args):
        return {
            "success": True,
            "jobs": [
                {
                    "title": "Software Engineer Intern",
                    "jobUrl": f"https://example.test/{search_term}",
                    "source": "LinkedIn",
                }
            ],
            "error": None,
        }

    monkeypatch.setattr(
        external_sources,
        "fetch_jobspy_source",
        fake_jobspy_source,
    )

    result = external_sources.fetch_jobspy_queries(
        "linkedin",
        ["software engineer intern", "backend developer internship"],
        "Mumbai",
        "Internship",
        "",
    )

    assert result["success"] is True
    assert len(result["jobs"]) == 2
    assert result["source"] == "LinkedIn"


def test_jobspy_query_fanout_splits_requested_result_budget(monkeypatch):
    requested = []
    locations = []

    def fake_jobspy_source(
        site,
        search_term,
        location,
        _job_type,
        _work_mode,
        results_wanted,
        _hours_old=None,
    ):
        requested.append(results_wanted)
        locations.append(location)
        return {
            "success": True,
            "jobs": [
                {
                    "title": f"{search_term} result {index} in {location}",
                    "jobUrl": f"https://example.test/{search_term}/{location}/{index}",
                }
                for index in range(results_wanted + 2)
            ],
            "error": None,
        }

    monkeypatch.setattr(
        external_sources,
        "fetch_jobspy_source",
        fake_jobspy_source,
    )

    result = external_sources.fetch_jobspy_queries(
        "linkedin",
        ["query one", "query two", "query three", "query four"],
        "Pune",
        "Internship",
        "",
        results_wanted=40,
    )

    assert requested == [10, 10, 10, 10]
    assert len(result["jobs"]) == 40
    assert locations == ["Pune"] * 4


def test_jobspy_search_expands_mumbai_to_nearby_locations(monkeypatch):
    requested_locations = []

    def fake_jobspy_source(
        _site,
        search_term,
        location,
        _job_type,
        _work_mode,
        _results_wanted,
        _hours_old=None,
    ):
        requested_locations.append(location)
        return {
            "success": True,
            "jobs": [
                {
                    "title": f"Software Engineer in {location}",
                    "location": location,
                    "jobUrl": f"https://example.test/{location.replace(' ', '-')}",
                }
            ],
            "error": None,
        }

    monkeypatch.setattr(
        external_sources,
        "fetch_jobspy_source",
        fake_jobspy_source,
    )

    result = external_sources.fetch_jobspy_queries(
        "linkedin",
        ["software engineer"],
        "Mumbai",
        "Full-Time",
        "On-site",
        results_wanted=30,
    )

    assert set(requested_locations) == {"Mumbai", "Navi Mumbai", "Thane"}
    assert {job["location"] for job in result["jobs"]} == {
        "Mumbai",
        "Navi Mumbai",
        "Thane",
    }


def test_jobspy_search_does_not_expand_unrelated_locations():
    assert external_sources.jobspy_search_locations("Pune") == ["Pune"]


def test_jobspy_query_budget_is_capped_per_source(monkeypatch):
    requested = []

    def fake_jobspy_source(
        _site,
        _search_term,
        _location,
        _job_type,
        _work_mode,
        results_wanted,
        _hours_old=None,
    ):
        requested.append(results_wanted)
        return {"success": True, "jobs": [], "error": None}

    monkeypatch.setattr(
        external_sources,
        "fetch_jobspy_source",
        fake_jobspy_source,
    )

    external_sources.fetch_jobspy_queries(
        "indeed",
        ["software engineer", "full stack developer"],
        "Mumbai",
        "Full-Time",
        "On-site",
        results_wanted=500,
    )

    assert len(requested) == 6
    assert sum(requested) == external_sources.MAX_PROVIDER_JOBS


def test_external_sources_propagate_scrape_budget_and_age_to_jobspy_boards(monkeypatch):
    requested = {}

    def fake_jobspy_source(site_name, *args):
        requested[site_name] = {
            "results_wanted": args[-2],
            "hours_old": args[-1],
        }
        return {
            "source": external_sources.JOBSPY_SOURCE_NAMES[site_name],
            "success": True,
            "jobs": [],
            "error": None,
        }

    def empty_provider(source, *_args):
        return {
            "source": source,
            "success": True,
            "jobs": [],
            "error": None,
        }

    monkeypatch.setattr(
        external_sources,
        "fetch_jobspy_source",
        fake_jobspy_source,
    )
    for provider, source in (
        ("fetch_remoteok", "RemoteOK"),
        ("fetch_arbeitnow", "Arbeitnow"),
        ("fetch_jobicy", "Jobicy"),
        ("fetch_remotive", "Remotive"),
        ("fetch_themuse", "The Muse"),
        ("fetch_adzuna", "Adzuna"),
        ("fetch_greenhouse", "Greenhouse"),
        ("fetch_lever", "Lever"),
        ("fetch_gemini_search", "Gemini Search"),
    ):
        monkeypatch.setattr(
            external_sources,
            provider,
            lambda *args, source=source, **kwargs: empty_provider(source),
        )

    external_sources.fetch_external_sources(
        search_term="software engineer",
        location="Pune",
        job_type="Full-Time",
        results_wanted=75,
        hours_old=720,
    )

    assert set(requested) == set(external_sources.JOBSPY_SOURCE_NAMES)
    assert all(
        values == {"results_wanted": 75, "hours_old": 720}
        for values in requested.values()
    )


def test_refresh_provider_summary_reports_provider_status(monkeypatch):
    received = {}
    providers = [
        {
            "source": "LinkedIn",
            "success": True,
            "jobs": [{"title": "Matched", "source": "LinkedIn"}],
            "error": None,
        },
        {
            "source": "Indeed",
            "success": True,
            "jobs": [
                {"title": "Eligible", "source": "Indeed"},
                {"title": "Filtered out", "source": "Indeed", "postedDate": "2000-01-01"},
            ],
            "error": None,
        },
        {
            "source": "Naukri",
            "success": False,
            "jobs": [],
            "error": "provider timed out",
        },
    ]

    async def fake_call_external_sources(**_kwargs):
        received.update(_kwargs)
        return {
            "jobs": [
                job
                for provider in providers
                for job in provider["jobs"]
            ],
            "providers": providers,
        }

    monkeypatch.setattr(
        "jobspy.server.call_external_sources",
        fake_call_external_sources,
    )

    jobs, summary = asyncio.run(
        get_refresh_jobs(
            RefreshRequest(
                location="Mumbai",
                job_type="Full-Time",
                work_mode="On-site",
                results_wanted=20,
            )
        )
    )

    assert received["hours_old"] == MAX_JOB_AGE_DAYS * 24
    assert len(jobs) == 3
    assert summary["LinkedIn"]["count"] == 1
    assert summary["LinkedIn"]["success"] is True
    assert summary["Indeed"]["count"] == 2
    assert summary["Indeed"]["success"] is True
    assert summary["Naukri"]["success"] is False


def test_location_filter_uses_provider_search_city_for_state_only_result():
    job = {
        "location": "MH, IN",
        "sourceSearchLocation": "Mumbai",
        "workMode": "",
    }

    assert location_match(job, "Mumbai", "") is True
    assert location_match(job, "Mumbai", "On-site") is True


def test_location_filter_does_not_apply_mumbai_search_to_other_states():
    job = {
        "location": "KA, IN",
        "sourceSearchLocation": "Mumbai",
        "workMode": "Onsite",
    }

    assert location_match(job, "Mumbai", "On-site") is False


def test_location_filter_uses_provider_search_city_when_job_location_is_unspecified():
    job = {
        "title": "Software Engineer",
        "location": "Not specified",
        "sourceSearchLocation": "Mumbai",
        "jobType": "Full-Time",
        "workMode": "Onsite",
    }

    assert location_match(job, "Mumbai", "On-site") is True


def test_rank_hard_filters_keep_onsite_jobs_with_unspecified_location():
    diagnostics = {}
    jobs = prepare_rank_jobs(
        [
            {
                "title": "Software Engineer",
                "location": "Not specified",
                "sourceSearchLocation": "Mumbai",
                "jobType": "Full-Time",
                "workMode": "Onsite",
            }
        ],
        RankRequest(
            location="Mumbai",
            job_type="Full-Time",
            work_mode="On-site",
        ),
        diagnostics,
    )

    assert len(jobs) == 1
    assert diagnostics["after_hard_filters"] == 1


def test_jobspy_query_results_keep_completed_searches_on_timeout(monkeypatch):
    monkeypatch.setattr(external_sources, "JOBSPY_QUERY_TIMEOUT", 0.01)

    def fake_jobspy_source(_site, search_term, *_args):
        if search_term == "slow":
            time.sleep(0.1)
        return {
            "success": True,
            "jobs": [
                {
                    "title": search_term,
                    "jobUrl": f"https://example.test/{search_term}",
                }
            ],
            "error": None,
        }

    monkeypatch.setattr(
        external_sources,
        "fetch_jobspy_source",
        fake_jobspy_source,
    )

    result = external_sources.fetch_jobspy_queries(
        "linkedin",
        ["fast", "slow"],
        "Mumbai",
        "Internship",
        "",
    )

    assert result["success"] is True
    assert [job["title"] for job in result["jobs"]] == ["fast"]
    assert "slow" in str(result["error"])


def test_gemini_search_uses_all_profile_data_in_prompts(monkeypatch):
    profile = {
        "targetRole": "Full Stack Engineer",
        "skills": ["React", "Node.js", "MongoDB", "FastAPI"],
        "resumeSkills": ["TypeScript", "Docker"],
        "yearsOfExperience": 0,
        "education": [{"degree": "B.Tech", "field": "Computer Science", "institution": "IIT Bombay"}],
        "projects": ["JobPortal with AI matching", "E-Commerce Microservice"],
        "certifications": ["AWS Certified Cloud Practitioner"],
        "lookingFor": "Internship",
        "preferredLocation": "Bengaluru",
        "preferredWorkMode": "Remote",
        "preferredCompanies": ["Google", "Microsoft"],
        "bio": "Passionate developer seeking software engineering internships.",
    }

    requests = []

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return json.dumps({
                "output": [
                    {
                        "type": "model_output",
                        "content": [
                            {
                                "type": "text",
                                "text": json.dumps({"jobs": []}),
                            }
                        ],
                    }
                ]
            }).encode("utf-8")

    def fake_urlopen(request, timeout):
        requests.append((request, timeout))
        return FakeResponse()

    monkeypatch.setenv("GEMINI_API_KEY", "test-api-key")
    monkeypatch.setattr(external_sources, "urlopen", fake_urlopen)

    result = external_sources.fetch_gemini_search(
        search_term="",
        location="",
        results_wanted=30,
        profile=profile,
    )

    assert result["success"] is True
    assert len(requests) >= 2  # Targets Naukri, Internshala, and Tech Portals

    prompts = [json.loads(req.data)["input"] for req, _ in requests]
    combined_prompt_text = " ".join(prompts)

    # Check that candidate profile data is fully reflected in Gemini prompts
    assert "Full Stack Engineer" in combined_prompt_text
    assert "React" in combined_prompt_text
    assert "Node.js" in combined_prompt_text
    assert "TypeScript" in combined_prompt_text
    assert "IIT Bombay" in combined_prompt_text
    assert "JobPortal with AI matching" in combined_prompt_text
    assert "AWS Certified Cloud Practitioner" in combined_prompt_text
    assert "Bengaluru" in combined_prompt_text
    assert "Internship" in combined_prompt_text
    assert "naukri.com" in combined_prompt_text
    assert "internshala.com" in combined_prompt_text


def test_gemini_search_tags_naukri_and_internshala_sources_correctly(monkeypatch):
    naukri_url = "https://www.naukri.com/job-listings-full-stack-developer-12345"
    internshala_url = "https://internshala.com/internship/detail/full-stack-web-dev-internship-67890"

    response_payload = {
        "output": [
            {
                "type": "model_output",
                "content": [
                    {
                        "type": "text",
                        "text": json.dumps({
                            "jobs": [
                                {
                                    "title": "Full Stack Developer",
                                    "company": "Tech Innovations Pvt Ltd",
                                    "location": "Bengaluru",
                                    "job_type": "Full-Time",
                                    "work_mode": "Hybrid",
                                    "experience": "0-1 years",
                                    "skills": ["React", "Node.js"],
                                    "salary": "₹8-12 LPA",
                                    "posted_date": "2026-11-12",
                                    "job_url": naukri_url,
                                    "description": "Full stack developer required with React and Node skills.",
                                },
                                {
                                    "title": "Software Development Intern",
                                    "company": "Fintech Startup",
                                    "location": "Work From Home",
                                    "job_type": "Internship",
                                    "work_mode": "Remote",
                                    "experience": "Fresher",
                                    "skills": ["Python", "FastAPI"],
                                    "salary": "₹25,000 /month",
                                    "posted_date": "2026-11-13",
                                    "job_url": internshala_url,
                                    "description": "Exciting 6-month internship building scalable APIs.",
                                },
                            ]
                        }),
                        "annotations": [
                            {"type": "url_citation", "url": naukri_url},
                            {"type": "url_citation", "url": internshala_url},
                        ],
                    }
                ],
            }
        ]
    }

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return json.dumps(response_payload).encode("utf-8")

    monkeypatch.setenv("GEMINI_API_KEY", "test-api-key")
    monkeypatch.setattr(external_sources, "urlopen", lambda req, timeout: FakeResponse())

    result = external_sources.fetch_gemini_search(
        search_term="software engineer",
        location="India",
        results_wanted=10,
    )

    assert result["success"] is True
    assert len(result["jobs"]) == 2

    naukri_job = next(j for j in result["jobs"] if j["jobUrl"] == naukri_url)
    internshala_job = next(j for j in result["jobs"] if j["jobUrl"] == internshala_url)

    assert naukri_job["source"] == "Naukri"
    assert naukri_job["company"] == "Tech Innovations Pvt Ltd"
    assert naukri_job["salary"] == "₹8-12 LPA"
    assert "React" in naukri_job["skills"]

    assert internshala_job["source"] == "Internshala"
    assert internshala_job["company"] == "Fintech Startup"
    assert internshala_job["salary"] == "₹25,000 /month"
    assert internshala_job["isRemote"] is True
    assert internshala_job["jobType"] == "Internship"


def test_gemini_search_with_sites_filter_targets_specific_board(monkeypatch):
    requests = []

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return json.dumps({
                "output": [
                    {
                        "type": "model_output",
                        "content": [{"type": "text", "text": json.dumps({"jobs": []})}],
                    }
                ]
            }).encode("utf-8")

    def fake_urlopen(request, timeout):
        requests.append(request)
        return FakeResponse()

    monkeypatch.setenv("GEMINI_API_KEY", "test-api-key")
    monkeypatch.setattr(external_sources, "urlopen", fake_urlopen)

    # Test Internshala filter
    external_sources.fetch_gemini_search(
        search_term="web developer",
        location="Delhi",
        results_wanted=20,
        sites="internshala",
        profile={"targetRole": "Web Developer", "skills": ["HTML", "CSS"]},
    )

    assert len(requests) == 1
    req_body = json.loads(requests[0].data)
    assert "internshala.com" in req_body["input"]
    assert "naukri.com" not in req_body["input"]

    requests.clear()

    # Test Naukri filter
    external_sources.fetch_gemini_search(
        search_term="backend developer",
        location="Pune",
        results_wanted=20,
        sites="naukri",
        profile={"targetRole": "Backend Developer", "skills": ["Python", "Django"]},
    )

    assert len(requests) == 1
    req_body = json.loads(requests[0].data)
    assert "naukri.com" in req_body["input"]
    assert "internshala.com" not in req_body["input"]

