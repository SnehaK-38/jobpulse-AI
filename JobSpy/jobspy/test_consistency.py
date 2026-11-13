from datetime import datetime, timedelta, timezone

from jobspy import matcher
import jobspy.server as server

from jobspy.matcher import (
    ProfileReader,
    _profile_years,
    experience_match,
    experience_within_tolerance,
    extract_experience_requirement,
    job_experience_requirement,
    job_skills,
    search_match,
    skill_match,
)
from jobspy.server import (
    RankRequest,
    infer_job_type,
    normalize_job,
    prepare_rank_jobs,
    recent_enough,
)

assert extract_experience_requirement("2 to 4 years of professional writing experience preferred")["min_years"] == 2.0
assert extract_experience_requirement("2 to 4 years of professional writing experience preferred")["max_years"] == 4.0
assert extract_experience_requirement("10+ years of enterprise full stack engineering experience")["min_years"] == 10.0
assert extract_experience_requirement("The company has over 20 years of experience")["min_years"] is None
assert extract_experience_requirement(
    "Requirements: Minimum of 3 years of relevant experience."
)["min_years"] == 3.0
assert extract_experience_requirement(
    "<p>Qualifications</p><ul><li>5+ years of software engineering experience</li></ul>"
)["min_years"] == 5.0
assert extract_experience_requirement(
    "We have served customers for 20 years. We require 4 years of engineering experience."
)["min_years"] == 4.0
assert extract_experience_requirement(
    "Our company has 20 years of experience serving customers."
)["min_years"] is None
assert extract_experience_requirement(
    "Requires 3.5 years of relevant experience."
)["min_years"] == 3.5
assert extract_experience_requirement(
    "No prior experience is required."
) == {"min_years": 0.0, "max_years": None}

# Overlapping employment intervals are counted once.
profile = {
    "experience": [
        {"startDate": "2024-01-01", "endDate": "2025-12-31"},
        {"startDate": "2025-01-01", "endDate": "2026-06-30"},
    ]
}
years = _profile_years(profile)
assert 2.4 < years < 2.6, years


def test_search_term_does_not_override_profile_role():
    profile = {
        "targetRole": "Full Stack Engineer",
        "lookingFor": "Internship",
        "preferredLocation": "Mumbai",
        "preferredWorkMode": "Remote",
        "skills": ["React", "Node", "Express", "MongoDB"],
        "experience": "Fresher",
    }

    job = {
        "title": "Machine Learning Engineer Intern",
        "description": "Build models and ship AI features in a remote internship.",
        "jobType": "Internship",
        "location": "Remote",
        "workMode": "Remote",
        "skills": ["Python", "Machine Learning", "TensorFlow"],
    }

    original_role_match = matcher.profile_role_match
    captured_roles = []

    def fake_profile_role_match(target_role, job_arg, embeddings):
        captured_roles.append(target_role)
        assert target_role == profile["targetRole"]
        return {
            "relevant": True,
            "score": 82.5,
            "titleScore": 82.5,
            "titleOverlap": 60.0,
            "semanticTitle": 0.0,
        }

    matcher.profile_role_match = fake_profile_role_match
    try:
        class MatchingEmbeddings:
            def similarity(self, _left, _right):
                return 100.0

        embeddings = MatchingEmbeddings()
        result = matcher.match_single_job(job, profile, "ml", embeddings)
        assert captured_roles and captured_roles[0] == profile["targetRole"]
        assert result["roleMatchPercentage"] == 82.5
        assert result["searchRelevant"] is True
    finally:
        matcher.profile_role_match = original_role_match


def test_location_filter_respects_work_mode_and_city():
    remote_job = {"location": "Bangalore", "workMode": "Remote", "jobType": "Internship"}
    onsite_job = {"location": "Mumbai", "workMode": "Onsite", "jobType": "Internship"}
    hybrid_job = {"location": "Mumbai", "workMode": "Hybrid", "jobType": "Internship"}
    navi_mumbai_job = {"location": "Navi Mumbai", "workMode": "Onsite"}
    thane_job = {"location": "Thane, Maharashtra", "workMode": "Onsite"}
    pune_job = {"location": "Pune", "workMode": "Onsite"}

    assert server.location_match(remote_job, "Mumbai", "Remote") is True
    assert server.location_match(onsite_job, "Mumbai", "Onsite") is True
    assert server.location_match(navi_mumbai_job, "Mumbai", "Onsite") is True
    assert server.location_match(thane_job, "Mumbai", "Onsite") is True
    assert server.location_match(pune_job, "Mumbai", "Onsite") is False
    assert server.location_match(onsite_job, "Mumbai", "Remote") is False
    assert server.location_match(hybrid_job, "Mumbai", "Hybrid") is True


def test_search_requires_role_evidence_not_description_mentions():
    class NoSemanticSimilarity:
        def similarity(self, _left, _right):
            return 0.0

    jobs = [
        {
            "title": "Compliance Engineer Intern",
            "description": "Finance company provides support services.",
        },
        {
            "title": "Finance/Investment Analyst-Intern",
            "description": "Remote finance internship.",
        },
        {
            "title": "Global Affiliate Business Development",
            "description": "Finance affiliate operations role.",
        },
    ]

    results = [
        search_match("finance", job, NoSemanticSimilarity())["relevant"]
        for job in jobs
    ]

    assert results == [False, True, False]


def test_experience_match_scores_out_of_range_years_below_full_match():
    profile = {"experience": "Fresher", "lookingFor": "Full-Time"}

    assert experience_match(
        "Fresher",
        {"title": "Analyst", "experience": "2 years experience required"},
        profile,
    ) == 50.0
    assert experience_match(
        "5 years",
        {"title": "Analyst", "experience": "3 years experience required"},
        {"experience": "5 years"},
    ) == 100.0


def test_experience_hard_filter_rejects_out_of_range_years():
    fresher = {"experience": "Fresher"}

    assert not experience_within_tolerance(
        fresher,
        {"experience": "2 years"},
    )
    assert not experience_within_tolerance(
        fresher,
        {"experience": "3 years experience required"},
    )
    assert experience_within_tolerance(
        {"experience": "5 years"},
        {"experience": "3 years experience required"},
    )
    assert experience_within_tolerance(
        {"experience": "6 years"},
        {"description": "Requires 3 to 5 years of relevant experience."},
    )
    assert not experience_within_tolerance(
        {"experience": "7 years"},
        {"description": "Requires 3 to 5 years of relevant experience."},
    )


def test_fresher_requirement_matches_zero_to_two_profile_years_only():
    job = {"description": "Freshers are welcome to apply."}

    assert job_experience_requirement(job)["min_years"] == 0
    assert job_experience_requirement(job)["max_years"] == 2
    for years in (0, 1, 2):
        assert experience_within_tolerance(
            {"yearsOfExperience": years},
            job,
        )
    assert not experience_within_tolerance(
        {"yearsOfExperience": 3},
        job,
    )


def test_rank_preparation_removes_jobs_outside_experience_tolerance():
    profile = {"yearsOfExperience": 1}
    jobs = [
        {
            "title": "Junior Developer",
            "description": "Requires 2+ years of experience.",
        },
        {
            "title": "Senior Developer",
            "description": "Requires 6+ years of experience.",
        },
        {
            "title": "Graduate Developer",
            "description": "Freshers are welcome to apply.",
        },
        {
            "title": "Graduate Manager",
            "description": "Requires 4 years of management experience.",
        },
    ]
    diagnostics = {}

    eligible = prepare_rank_jobs(
        jobs,
        RankRequest(
            profile=profile,
            jobs=jobs,
        ),
        diagnostics=diagnostics,
    )

    assert [job["title"] for job in eligible] == [
        "Junior Developer",
        "Graduate Developer",
    ]
    assert diagnostics["experience"] == 2


def test_experience_requirement_is_parsed_from_description_for_hard_filter():
    fresher = {"experience": "Fresher"}
    job = {
        "title": "Software Engineer",
        "description": (
            "<p>Requirements:</p><ul>"
            "<li>Minimum of 3 years of relevant experience.</li>"
            "</ul>"
        ),
    }

    assert job_experience_requirement(job) == {
        "min_years": 3.0,
        "max_years": None,
        "source": "job description",
    }
    assert not experience_within_tolerance(fresher, job)
    assert experience_within_tolerance(
        {"experience": "5 years"},
        job,
    )


def test_experience_description_parser_ignores_company_tenure():
    job = {
        "title": "Software Engineer",
        "description": "Our company has over 20 years of experience serving customers.",
    }

    assert job_experience_requirement(job)["min_years"] is None
    assert experience_within_tolerance({"experience": "Fresher"}, job)


def test_experience_parser_handles_upper_bounds_and_spelled_out_numbers():
    assert extract_experience_requirement(
        "Up to 5 years of relevant experience."
    ) == {"min_years": None, "max_years": 5.0}
    assert extract_experience_requirement(
        "At least three years of professional experience."
    ) == {"min_years": 3.0, "max_years": None}
    assert extract_experience_requirement(
        "Requires three to five years of relevant experience."
    ) == {"min_years": 3.0, "max_years": 5.0}
    assert extract_experience_requirement(
        "The company was founded in 2015 and has no experience requirement."
    ) == {"min_years": None, "max_years": None}
    assert extract_experience_requirement(
        "Our organization has twenty years of experience serving customers."
    ) == {"min_years": None, "max_years": None}
    profile = {"yearsOfExperience": 3}
    assert experience_within_tolerance(
        profile,
        {"description": "Up to 5 years of relevant experience."},
    )
    assert experience_within_tolerance(
        profile,
        {"description": "Up to 2 years of relevant experience."},
    )


def test_resume_employment_dates_supply_profile_experience_years():
    profile = {
        "experience": [],
        "resumeText": (
            "EDUCATION\n2017 - 2020\n"
            "WORK EXPERIENCE\nSoftware Engineer | Jan 2021 - Dec 2023\n"
            "SKILLS\n2024 - 2026"
        ),
    }

    assert 2.8 < _profile_years(profile) < 3.0
    assert experience_within_tolerance(
        profile,
        {"description": "Requires 2 to 4 years of engineering experience."},
    )
    assert experience_within_tolerance(
        profile,
        {"description": "Requires 4+ years of engineering experience."},
    )


def test_resume_without_work_experience_section_does_not_infer_dates():
    profile = {
        "experience": [],
        "resumeText": "EDUCATION\n2017 - 2020\nSKILLS\n2021 - 2023",
    }

    assert _profile_years(profile) is None


def test_resume_experience_heading_alias_and_explicit_zero_years():
    profile = {
        "experience": [],
        "resumeText": (
            "EDUCATION\n2017 - 2020\n"
            "PROFESSIONAL BACKGROUND\nDeveloper | 2021 - 2023\n"
            "CERTIFICATIONS\n2024 - 2025"
        ),
    }

    assert 1.9 < _profile_years(profile) < 2.1
    assert _profile_years({"yearsOfExperience": 0}) == 0


def test_experience_match_reports_parsed_description_requirement():
    profile = {
        "targetRole": "Software Engineer",
        "experience": "3 years",
    }
    job = {
        "title": "Software Engineer",
        "description": "You must have 2 to 4 years of relevant experience.",
    }
    embeddings = matcher.EmbeddingEngine()
    embeddings.model = None

    result = matcher.match_single_job(job, profile, "", embeddings)

    assert result["experienceMatchPercentage"] == 100.0
    assert result["experienceMatch"] == {
        "requiredMinYears": 2.0,
        "requiredMaxYears": 4.0,
        "requiredLabel": "2 - 4 years",
        "profileYears": 3.0,
        "source": "job description",
        "matched": True,
    }


def test_missing_profile_experience_does_not_pass_explicit_requirements():
    profile = {
        "experience": [],
        "lookingFor": "Full-Time",
        "targetRole": "Analyst",
    }
    job = {
        "title": "Senior Analyst",
        "experience": "8 years experience required",
    }

    assert ProfileReader.experience(profile) == ""
    assert _profile_years(profile) is None
    assert experience_match("", job, profile) == 50.0
    assert not experience_within_tolerance(profile, job)
    assert experience_within_tolerance(
        profile,
        {"title": "Analyst", "description": "Strong communication skills."},
    )


def test_dated_experience_is_used_even_for_internship_preferences():
    profile = {
        "experience": [
            {"startDate": "2021-01-01", "endDate": "2024-01-01"},
        ],
        "lookingFor": "Internship",
    }

    assert 2.9 < _profile_years(profile) < 3.1
    assert experience_match(
        ProfileReader.experience(profile),
        {"title": "Developer Intern", "experience": "2 years"},
        profile,
    ) == 100.0


def test_experience_text_entries_are_used_for_experience_filtering():
    profile = {"experience": ["Software Developer - 5 years"]}

    assert _profile_years(profile) == 5.0
    assert experience_within_tolerance(
        profile,
        {"experience": "3 years experience required"},
    )
    assert not experience_within_tolerance(
        profile,
        {"experience": "8 years experience required"},
    )


def test_experience_uses_legacy_numeric_and_resume_year_fields():
    legacy_profile = {"yearsOfExperience": 5}
    resume_profile = {
        "resumeText": "Software engineer with 4 years of professional experience."
    }

    assert _profile_years(legacy_profile) == 5
    assert _profile_years({"yearsOfExperience": "3.5"}) == 3.5
    assert _profile_years(resume_profile) == 4
    assert experience_match(
        ProfileReader.experience(legacy_profile),
        {"title": "Software Engineer", "experience": "3 years"},
        legacy_profile,
    ) == 100.0
    assert experience_within_tolerance(
        legacy_profile,
        {"experience": "3 years"},
    )
    assert experience_within_tolerance(
        resume_profile,
        {"experience": "5 years"},
    )
    assert not experience_within_tolerance(
        resume_profile,
        {"experience": "8 years"},
    )


def test_skill_requirements_are_detected_from_job_description():
    job = {
        "title": "Backend Engineer",
        "description": (
            "Requirements: Java, Python, SQL, Docker, and Go experience. "
            "Must be able to go to the office."
        ),
    }

    detected = job_skills(job)
    comparison = skill_match(["Python", "Docker"], job)

    assert {"Java", "Python", "SQL", "Docker", "Go"}.issubset(set(detected))
    assert "office" not in detected
    assert comparison["matched"] == ["Python", "Docker"]
    assert {"Java", "SQL", "Go"}.issubset(set(comparison["missing"]))

    incidental_mention = job_skills({
        "description": "Our team uses React, but this role manages office operations."
    })
    assert incidental_mention == []


def test_job_skill_requirements_are_still_shown_without_profile_skills():
    comparison = skill_match(
        [],
        {"description": "Required: Python and PostgreSQL."},
    )

    assert comparison["profileAvailable"] is False
    assert comparison["available"] is True
    assert set(comparison["missing"]) == {"Python", "PostgreSQL"}


def test_missing_profile_experience_does_not_reduce_match_score():
    profile = {
        "targetRole": "Backend Developer",
        "skills": ["Python"],
        "experience": [],
    }
    job = {
        "title": "Backend Developer",
        "skills": ["Python"],
        "experience": "5 years",
    }
    embeddings = matcher.EmbeddingEngine()
    embeddings.model = None

    result = matcher.match_single_job(job, profile, "", embeddings)

    assert result["experienceDataAvailable"] is False
    assert result["experienceMatchPercentage"] == 50.0
    assert abs(result["finalRankingScore"] - (55 / 0.65)) < 0.01


def test_profile_preferences_are_hard_filters_for_typed_searches():
    profile = {
        "lookingFor": "Internship",
        "preferredLocation": "Mumbai",
        "preferredWorkMode": "Hybrid",
        "experience": "Fresher",
    }
    jobs = [
        {
            "title": "Analyst Intern",
            "jobType": "Internship",
            "location": "Mumbai",
            "workMode": "Hybrid",
            "experience": "0 years",
        },
        {
            "title": "Analyst Intern",
            "jobType": "Internship",
            "location": "Bangalore",
            "workMode": "Remote",
            "experience": "2 years",
        },
        {
            "title": "Analyst",
            "jobType": "Full-Time",
            "location": "Mumbai",
            "workMode": "Hybrid",
            "experience": "2 years",
        },
        {
            "title": "Analyst Intern",
            "jobType": "Internship",
            "location": "Mumbai",
            "workMode": "Hybrid",
            "experience": "3 years experience required",
        },
    ]
    request = server.RankRequest(
        search_term="analyst",
        profile=profile,
        jobs=jobs,
    )

    eligible = server.prepare_rank_jobs(jobs, request)

    assert [job["experience"] for job in eligible] == ["0 years"]


def test_full_time_filter_rejects_explicitly_incompatible_types_only():
    jobs = [
        {
            "title": "Senior Data Analyst",
            "description": "Requires three years of relevant experience.",
        },
        {
            "title": "Software Engineer",
            "jobType": "Full-Time",
        },
        {
            "title": "Full-Time Product Analyst",
        },
        {
            "title": "Marketing Specialist",
            "description": "Employment Type: Full-Time",
        },
        {
            "title": "Product Engineer Intern",
            "jobType": "Full-Time",
        },
        {
            "title": "Contract Data Engineer",
            "jobType": "Full-Time",
        },
    ]

    assert infer_job_type(jobs[0]) == ""
    assert infer_job_type(jobs[1]) == "Full-Time"
    assert infer_job_type(jobs[2]) == "Full-Time"
    assert infer_job_type(jobs[3]) == "Full-Time"
    assert infer_job_type(jobs[4]) == "Internship"
    assert infer_job_type(jobs[5]) == "Contract"

    eligible = prepare_rank_jobs(
        jobs,
        RankRequest(
            job_type="Full-Time",
            profile={"yearsOfExperience": 3},
        ),
    )

    assert [job["title"] for job in eligible] == [
        "Senior Data Analyst",
        "Software Engineer",
        "Full-Time Product Analyst",
        "Marketing Specialist",
    ]


def test_unknown_work_mode_is_not_assumed_to_be_onsite_or_discarded():
    job = {"title": "Software Engineer", "location": "Mumbai"}

    assert server.infer_work_mode(job) == ""
    assert server.work_mode_match(job, "Onsite")
    assert server.location_match(job, "Mumbai", "Onsite")
    assert not server.location_match(job, "Mumbai", "Remote")


def test_recently_scraped_listing_with_old_post_date_is_expired():
    job = {
        "postedDate": "2000-01-01",
        "scrapedAt": datetime.now(timezone.utc).isoformat(),
    }

    assert recent_enough(job) is False


def test_old_listing_not_seen_recently_is_expired():
    job = {
        "postedDate": "2000-01-01",
        "scrapedAt": (
            datetime.now(timezone.utc) - timedelta(days=31)
        ).isoformat(),
    }

    assert recent_enough(job) is False


def test_normalize_job_replaces_nan_company_placeholder():
    assert normalize_job({"title": "Engineer", "company": "nan"})["company"] == "Unknown Company"


def test_rank_rejects_old_post_date_when_listing_was_just_rescraped():
    job = {
        "title": "Software Engineer",
        "jobType": "Full-Time",
        "location": "Mumbai",
        "postedDate": "2000-01-01",
        "scrapedAt": datetime.now(timezone.utc).isoformat(),
    }

    eligible = prepare_rank_jobs(
        [job],
        RankRequest(job_type="Full-Time", location="Mumbai"),
    )

    assert eligible == []


print("consistency tests passed")
